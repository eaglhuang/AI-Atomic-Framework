import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const tierRank = {
    quick: 1,
    standard: 2,
    full: 3
};
export function readTestCatalog(repositoryRoot, options = {}) {
    const catalogPath = path.join(repositoryRoot, 'scripts', 'test-catalog.config.json');
    const baseCatalog = existsSync(catalogPath)
        ? JSON.parse(readFileSync(catalogPath, 'utf8'))
        : { schemaId: 'atm.testCatalog.v1', specVersion: '0.1.0', entries: [] };
    const configuredEntries = normalizeEntries(baseCatalog.entries ?? []);
    const projectedValidators = options.validatorsConfig
        ? projectValidatorsFromConfig(options.validatorsConfig)
        : [];
    return {
        schemaId: 'atm.testCatalog.v1',
        specVersion: String(baseCatalog.specVersion ?? '0.1.0'),
        sourcePath: existsSync(catalogPath) ? toPortablePath(catalogPath) : null,
        entries: dedupeByKey([...configuredEntries, ...projectedValidators])
    };
}
export function resolveTestPlanForTask(task, changedFiles = [], repoKind = 'framework-repository') {
    const taskRecord = isRecord(task) ? task : {};
    const explicitPlan = isRecord(taskRecord.testPlan) ? taskRecord.testPlan : {};
    const legacyValidators = Array.isArray(taskRecord.validators) ? taskRecord.validators.map(String) : [];
    const validatorsPlan = isRecord(explicitPlan.validators) ? explicitPlan.validators : {};
    const integrationTestsPlan = isRecord(explicitPlan.integrationTests) ? explicitPlan.integrationTests : {};
    const languageStaticRequired = changedFiles.some((filePath) => matchesAny(filePath, [
        '**/*.ts',
        '**/*.tsx',
        '**/*.js',
        '**/*.jsx',
        '**/*.py',
        '**/*.cs'
    ]));
    const validators = {
        defaultTier: normalizeTier(validatorsPlan.defaultTier) ?? 'quick',
        requiredKeys: normalizeStringList(validatorsPlan.requiredKeys),
        requiredFamilies: [
            ...normalizeStringList(validatorsPlan.requiredFamilies),
            ...(languageStaticRequired ? ['language-static'] : []),
            ...legacyValidators
        ],
        allowedScopes: normalizeScopes(validatorsPlan.allowedScopes, repoKind)
    };
    const integrationTests = {
        defaultTier: normalizeTier(integrationTestsPlan.defaultTier) ?? 'quick',
        requiredKeys: normalizeStringList(integrationTestsPlan.requiredKeys),
        requiredFamilies: normalizeStringList(integrationTestsPlan.requiredFamilies),
        allowedScopes: normalizeScopes(integrationTestsPlan.allowedScopes, repoKind)
    };
    return {
        schemaId: 'atm.taskTestPlan.v1',
        selectionMode: String(explicitPlan?.selectionMode ?? 'task-scoped'),
        validators,
        integrationTests
    };
}
export function selectTestEntries(options) {
    const capability = options.capability;
    const tier = options.tier ?? capabilityDefaultTier(capability, options.taskPlan);
    const normalizedChangedFiles = (options.changedFiles ?? []).map(normalizePath).filter(Boolean);
    const plan = capabilityPlan(options.taskPlan, capability);
    const requiredKeys = new Set(normalizeStringList(plan?.requiredKeys));
    const requiredFamilies = new Set(normalizeStringList(plan?.requiredFamilies));
    const allowedScopes = new Set(normalizeScopes(plan?.allowedScopes, 'framework-repository'));
    const candidates = options.catalog.entries.filter((entry) => {
        if (capability && entry.capability !== capability)
            return false;
        const required = requiredKeys.has(entry.key) || requiredFamilies.has(entry.family);
        if (!required && !entryTierEligible(entry, tier))
            return false;
        if (allowedScopes.size > 0 && !allowedScopes.has(entry.scope) && !required)
            return false;
        if (normalizedChangedFiles.length > 0 && !required) {
            const triggers = entry.pathTriggers ?? [];
            if (triggers.length === 0)
                return false;
            if (!triggers.some((pattern) => normalizedChangedFiles.some((filePath) => matchesPattern(pattern, filePath)))) {
                return false;
            }
        }
        return true;
    });
    const duplicateDedupeKeys = findDuplicateDedupeKeys(candidates);
    return {
        entries: dedupeByKeys(candidates),
        duplicateDedupeKeys
    };
}
export function dedupeByKeys(entries) {
    const selected = [];
    const seen = new Set();
    for (const entry of entries) {
        const key = firstDedupeKey(entry);
        if (seen.has(key))
            continue;
        seen.add(key);
        selected.push(entry);
    }
    return selected;
}
export function resolveLanguageStaticEntries(changedFiles, adapters) {
    const normalizedChangedFiles = changedFiles.map(normalizePath).filter(Boolean);
    return adapters.filter((entry) => {
        if (entry.family !== 'language-static')
            return false;
        const triggers = entry.pathTriggers ?? [];
        return triggers.some((pattern) => normalizedChangedFiles.some((filePath) => matchesPattern(pattern, filePath)));
    });
}
export function projectValidatorsFromConfig(config) {
    const validatorNamesByProfile = new Map();
    for (const profileName of ['quick', 'standard', 'full']) {
        validatorNamesByProfile.set(profileName, new Set(resolveProfileValidatorNamesFromConfig(config, profileName)));
    }
    const focusTriggersByValidator = collectFocusTriggersByValidator(config);
    return (config.validators ?? []).map((validator) => {
        const tags = normalizeStringList(validator.tags);
        const family = resolveFamilyForValidator(tags, config.selectionFamilies ?? []);
        const tiers = resolveValidatorTiers(String(validator.name), validatorNamesByProfile);
        const budgetMs = Number.isFinite(validator.performanceBudgetMs)
            ? Number(validator.performanceBudgetMs)
            : validator.slow === true
                ? Number(config.performanceDefaults?.slowValidatorBudgetMs ?? 90_000)
                : Number(config.performanceDefaults?.fastValidatorBudgetMs ?? 10_000);
        return {
            key: `validator.${slugify(String(validator.name))}`,
            capability: 'validator',
            family,
            source: 'validator-script',
            scope: tags.includes('release') ? 'release-blocking' : 'task-local',
            tiers,
            command: `node --strip-types ${toPortablePath(String(validator.entry ?? ''))}`,
            validatorName: String(validator.name),
            entry: String(validator.entry ?? ''),
            tags,
            pathTriggers: focusTriggersByValidator.get(String(validator.name)) ?? [],
            dedupeKeys: [`validator:${validator.name}`],
            costBudgetMs: budgetMs,
            performanceGate: 'advisory'
        };
    });
}
export function findDuplicateDedupeKeys(entries) {
    const seen = new Set();
    const duplicates = new Set();
    for (const entry of entries) {
        for (const key of entry.dedupeKeys?.length ? entry.dedupeKeys : [entry.key]) {
            if (seen.has(key))
                duplicates.add(key);
            seen.add(key);
        }
    }
    return [...duplicates].sort();
}
export function normalizeTier(value) {
    const text = String(value ?? '').toLowerCase();
    return text === 'quick' || text === 'standard' || text === 'full' ? text : null;
}
function capabilityDefaultTier(capability, plan) {
    const selectedPlan = capabilityPlan(plan, capability);
    return normalizeTier(selectedPlan?.defaultTier) ?? 'standard';
}
function capabilityPlan(plan, capability) {
    if (!plan)
        return null;
    if (capability === 'integration-test')
        return plan.integrationTests ?? null;
    return plan.validators ?? null;
}
function normalizeEntries(entries) {
    if (!Array.isArray(entries))
        return [];
    return entries.flatMap((entry) => normalizeEntry(entry));
}
function normalizeEntry(entry) {
    if (!isRecord(entry))
        return [];
    const tierValues = Array.isArray(entry.tiers) ? entry.tiers.map(normalizeTier).filter(Boolean) : [];
    const capability = entry.capability === 'integration-test' ? 'integration-test' : 'validator';
    const scope = normalizeScope(entry.scope) ?? 'task-local';
    if (!entry.key || !entry.family || tierValues.length === 0)
        return [];
    return [{
            key: String(entry.key),
            capability,
            family: String(entry.family),
            source: String(entry.source ?? 'catalog'),
            scope,
            tiers: tierValues,
            command: typeof entry.command === 'string' ? entry.command : null,
            validatorName: typeof entry.validatorName === 'string' ? entry.validatorName : null,
            entry: typeof entry.entry === 'string' ? entry.entry : null,
            tags: normalizeStringList(entry.tags),
            pathTriggers: normalizeStringList(entry.pathTriggers),
            dedupeKeys: normalizeStringList(entry.dedupeKeys),
            costBudgetMs: Number.isFinite(entry.costBudgetMs) ? Number(entry.costBudgetMs) : null,
            performanceGate: entry.performanceGate === 'blocking' ? 'blocking' : 'advisory',
            metadata: isRecord(entry.metadata) ? entry.metadata : undefined
        }];
}
function resolveValidatorTiers(name, namesByProfile) {
    if (namesByProfile.get('quick')?.has(name))
        return ['quick', 'standard', 'full'];
    if (namesByProfile.get('standard')?.has(name))
        return ['standard', 'full'];
    if (namesByProfile.get('full')?.has(name))
        return ['full'];
    return ['standard'];
}
function resolveProfileValidatorNamesFromConfig(config, profileName) {
    const profile = config.profiles?.[profileName];
    if (!profile)
        return [];
    const inherited = profile.extends ? resolveProfileValidatorNamesFromConfig(config, profile.extends) : [];
    const profileValidators = Array.isArray(profile.validators) ? profile.validators.map(String) : [];
    return [...new Set([...inherited, ...profileValidators])];
}
function collectFocusTriggersByValidator(config) {
    const result = new Map();
    for (const rule of config.focusRules ?? []) {
        const patterns = normalizeStringList(rule.patterns);
        for (const validatorName of normalizeStringList(rule.validators)) {
            result.set(validatorName, [...new Set([...(result.get(validatorName) ?? []), ...patterns])]);
        }
    }
    return result;
}
function resolveFamilyForValidator(tags, families) {
    for (const family of families) {
        const matchTags = normalizeStringList(family.matchTags).map((entry) => entry.toLowerCase());
        if (tags.some((tag) => matchTags.includes(tag.toLowerCase()))) {
            return String(family.id ?? 'uncategorized');
        }
    }
    return 'uncategorized';
}
function entryTierEligible(entry, requestedTier) {
    return entry.tiers.some((tier) => tierRank[tier] <= tierRank[requestedTier]);
}
function normalizeScopes(value, repoKind) {
    const scopes = Array.isArray(value) ? value.map(normalizeScope).filter(Boolean) : [];
    if (scopes.length > 0)
        return scopes;
    return repoKind === 'framework-repository'
        ? ['task-local', 'global-advisory', 'release-blocking']
        : ['task-local'];
}
function normalizeScope(value) {
    const text = String(value ?? '');
    if (text === 'task-local' || text === 'global-advisory' || text === 'release-blocking' || text === 'diagnostic') {
        return text;
    }
    return null;
}
function normalizeStringList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}
function dedupeByKey(entries) {
    const seen = new Set();
    const selected = [];
    for (const entry of entries) {
        if (seen.has(entry.key))
            continue;
        seen.add(entry.key);
        selected.push(entry);
    }
    return selected;
}
function firstDedupeKey(entry) {
    return entry.dedupeKeys?.[0] ?? entry.key;
}
function matchesAny(filePath, patterns) {
    const normalized = normalizePath(filePath);
    return patterns.some((pattern) => matchesPattern(pattern, normalized));
}
function matchesPattern(pattern, candidatePath) {
    const escaped = String(pattern || '')
        .replace(/\\/g, '/')
        .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
        .replace(/\*\*/g, '::DOUBLE_STAR::')
        .replace(/\*/g, '[^/]*')
        .replace(/::DOUBLE_STAR::/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(normalizePath(candidatePath));
}
function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}
function toPortablePath(value) {
    return String(value || '').replace(/\\/g, '/');
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
