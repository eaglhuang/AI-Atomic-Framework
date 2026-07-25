import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
export const VALIDATOR_RESPONSIBILITIES = [
    'task-required',
    'phase-suite',
    'advisory'
];
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
export function normalizeValidatorResponsibility(value) {
    const text = String(value ?? '').trim().toLowerCase();
    return VALIDATOR_RESPONSIBILITIES.includes(text)
        ? text
        : null;
}
export function isBroadSuiteCommandOrKey(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/\\/g, '/');
    if (!normalized)
        return false;
    if (/^(npm run )?(typecheck|lint|validate:cli|validate:schemas|test|validate:all)\b/.test(normalized)) {
        return true;
    }
    if (/\.static\.all\b/.test(normalized) || /\btier[:=]full\b/.test(normalized)) {
        return true;
    }
    if (/^(language|integration)\.[a-z0-9_.-]+\.(all|full)$/.test(normalized)) {
        return true;
    }
    return false;
}
export function projectLegacyCommandValidators(commands) {
    return [...new Set(commands.map((entry) => String(entry ?? '').trim()).filter(Boolean))]
        .map((command) => ({
        schemaId: 'atm.validatorExecutionContract.v1',
        specVersion: '0.1.0',
        responsibility: 'advisory',
        caseId: `legacy_cmd_${slugify(command)}`,
        command,
        legacyProjection: true,
        acceptanceIds: [],
        impactEdges: []
    }));
}
export function catalogEntryResponsibility(entry) {
    const fromField = normalizeValidatorResponsibility(entry.responsibility);
    if (fromField)
        return fromField;
    const fromMeta = normalizeValidatorResponsibility(entry.metadata?.responsibility);
    if (fromMeta)
        return fromMeta;
    if (entry.scope === 'release-blocking' || entry.tiers.includes('full'))
        return 'phase-suite';
    if (entry.performanceGate === 'advisory' || entry.scope === 'global-advisory' || entry.scope === 'diagnostic') {
        return 'advisory';
    }
    return 'task-required';
}
export function normalizeSemanticKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}
export function buildTestCaseId(input) {
    const kind = input.kind === 'task' ? 'task' : 'int';
    const namespace = normalizeSemanticKey(input.namespace);
    const semanticKey = normalizeSemanticKey(input.semanticKey);
    if (!namespace || !semanticKey) {
        throw new Error('test case id requires non-empty namespace and semanticKey');
    }
    const digest8 = createHash('sha256')
        .update(`kind=${kind}\nnamespace=${namespace}\nsemanticKey=${semanticKey}`)
        .digest('hex')
        .slice(0, 8);
    return `test_${kind}_${namespace}_${semanticKey}_${digest8}`;
}
export function resolveCaseGroupShardsRoot(repositoryRoot) {
    const catalogPath = path.join(repositoryRoot, 'scripts', 'test-catalog.config.json');
    const configured = existsSync(catalogPath)
        ? JSON.parse(readFileSync(catalogPath, 'utf8')).caseGroupShards?.root
        : null;
    return path.join(repositoryRoot, configured || 'tests/catalog/groups');
}
export function loadTestCaseGroupShards(repositoryRoot, groupsRoot) {
    const root = groupsRoot ? path.resolve(groupsRoot) : resolveCaseGroupShardsRoot(repositoryRoot);
    if (!existsSync(root))
        return [];
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.shard.json'))
        .map((entry) => {
        const sourcePath = path.join(root, entry.name);
        const raw = JSON.parse(readFileSync(sourcePath, 'utf8'));
        return normalizeGroupShard(raw, toPortablePath(sourcePath));
    })
        .filter((shard) => Boolean(shard))
        .sort((left, right) => left.groupId.localeCompare(right.groupId));
}
export function validateTestCaseGroupShards(shards) {
    const diagnostics = [];
    const caseOwners = new Map();
    const allCaseIds = new Set();
    const semanticOwners = new Map();
    for (const shard of shards) {
        if (!shard.maintainers.length) {
            diagnostics.push({
                code: 'ATM_TEST_CASE_GROUP_MISSING_OWNER',
                severity: 'error',
                groupId: shard.groupId,
                message: `Group ${shard.groupId} has no maintainers/owners.`
            });
        }
        const localSemantic = new Map();
        for (const entry of shard.cases) {
            allCaseIds.add(entry.caseId);
            const priorGroup = caseOwners.get(entry.caseId);
            if (priorGroup && priorGroup !== shard.groupId) {
                diagnostics.push({
                    code: 'ATM_TEST_CASE_ID_NOT_UNIQUE',
                    severity: 'error',
                    groupId: shard.groupId,
                    caseId: entry.caseId,
                    message: `Case ${entry.caseId} appears in both ${priorGroup} and ${shard.groupId}.`
                });
            }
            else {
                caseOwners.set(entry.caseId, shard.groupId);
            }
            const priorSemantic = localSemantic.get(entry.semanticKey);
            if (priorSemantic && priorSemantic !== entry.caseId) {
                diagnostics.push({
                    code: 'ATM_TEST_CASE_SEMANTIC_DUPLICATE',
                    severity: 'error',
                    groupId: shard.groupId,
                    caseId: entry.caseId,
                    message: `Semantic key ${entry.semanticKey} maps to both ${priorSemantic} and ${entry.caseId} in ${shard.groupId}.`
                });
            }
            else {
                localSemantic.set(entry.semanticKey, entry.caseId);
            }
            const globalSemanticOwner = semanticOwners.get(`${shard.groupId}:${entry.semanticKey}`);
            if (!globalSemanticOwner)
                semanticOwners.set(`${shard.groupId}:${entry.semanticKey}`, entry.caseId);
        }
    }
    for (const shard of shards) {
        for (const alias of shard.aliases ?? []) {
            if (!allCaseIds.has(alias.canonicalCaseId) && !(shard.lineage ?? []).some((entry) => entry.caseId === alias.canonicalCaseId)) {
                diagnostics.push({
                    code: 'ATM_TEST_CASE_UNRESOLVED_ALIAS',
                    severity: 'error',
                    groupId: shard.groupId,
                    caseId: alias.aliasId,
                    message: `Alias ${alias.aliasId} points to unresolved canonical case ${alias.canonicalCaseId}.`
                });
            }
        }
        for (const entry of shard.cases) {
            for (const dep of entry.dependsOnCaseIds ?? []) {
                if (!allCaseIds.has(dep) && !(shard.aliases ?? []).some((alias) => alias.aliasId === dep)) {
                    diagnostics.push({
                        code: 'ATM_TEST_CASE_UNRESOLVED_REFERENCE',
                        severity: 'error',
                        groupId: shard.groupId,
                        caseId: entry.caseId,
                        message: `Case ${entry.caseId} depends on unresolved case ${dep}.`
                    });
                }
            }
        }
        for (const edge of shard.lineage ?? []) {
            if (!allCaseIds.has(edge.promotedTo) && !(shard.aliases ?? []).some((alias) => alias.aliasId === edge.promotedTo || alias.canonicalCaseId === edge.promotedTo)) {
                diagnostics.push({
                    code: 'ATM_TEST_CASE_ORPHAN_LINEAGE',
                    severity: 'error',
                    groupId: shard.groupId,
                    caseId: edge.caseId,
                    message: `Lineage for ${edge.caseId} promotes to unresolved case ${edge.promotedTo}.`
                });
            }
        }
        const cycle = detectLineageCycle(shard);
        if (cycle) {
            diagnostics.push({
                code: 'ATM_TEST_CASE_LINEAGE_CYCLE',
                severity: 'error',
                groupId: shard.groupId,
                message: `Lineage/alias cycle detected in ${shard.groupId}: ${cycle.join(' -> ')}.`
            });
        }
    }
    return diagnostics;
}
export function generateReadOnlyTestCaseCatalog(shards, options = {}) {
    const diagnostics = validateTestCaseGroupShards(shards);
    const aliasIndex = new Map();
    const promotedTo = new Map();
    for (const shard of shards) {
        for (const alias of shard.aliases ?? []) {
            const list = aliasIndex.get(alias.canonicalCaseId) ?? [];
            list.push(alias.aliasId);
            aliasIndex.set(alias.canonicalCaseId, list);
        }
        for (const edge of shard.lineage ?? []) {
            promotedTo.set(edge.caseId, edge.promotedTo);
        }
    }
    return {
        schemaId: 'atm.generatedTestCaseCatalog.v1',
        queryAuthorityOnly: true,
        mutableRegistry: false,
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        groups: shards.map((shard) => ({
            groupId: shard.groupId,
            theme: shard.theme,
            resourceKey: shard.resourceKey,
            caseIds: shard.cases.map((entry) => entry.caseId)
        })),
        cases: shards.flatMap((shard) => {
            const memberCases = shard.cases.map((entry) => ({
                caseId: entry.caseId,
                groupId: shard.groupId,
                semanticKey: entry.semanticKey,
                aliases: [...(aliasIndex.get(entry.caseId) ?? [])].sort(),
                promotedTo: promotedTo.get(entry.caseId) ?? null
            }));
            const historical = (shard.lineage ?? [])
                .filter((edge) => !shard.cases.some((entry) => entry.caseId === edge.caseId))
                .map((edge) => ({
                caseId: edge.caseId,
                groupId: shard.groupId,
                semanticKey: 'historical_lineage',
                aliases: [...(aliasIndex.get(edge.caseId) ?? [])].sort(),
                promotedTo: edge.promotedTo
            }));
            return [...memberCases, ...historical];
        }),
        diagnostics
    };
}
function normalizeGroupShard(raw, sourcePath) {
    const groupId = String(raw.groupId ?? '').trim();
    const theme = String(raw.theme ?? '').trim();
    const resourceKey = String(raw.resourceKey ?? '').trim();
    const maintainers = normalizeStringList(raw.maintainers);
    const casesRaw = Array.isArray(raw.cases) ? raw.cases : [];
    const cases = casesRaw.flatMap((entry) => {
        if (!isRecord(entry))
            return [];
        const caseId = String(entry.caseId ?? '').trim();
        const semanticKey = normalizeSemanticKey(String(entry.semanticKey ?? ''));
        if (!caseId || !semanticKey)
            return [];
        return [{
                caseId,
                semanticKey,
                command: typeof entry.command === 'string' ? entry.command : null,
                responsibility: normalizeValidatorResponsibility(entry.responsibility) ?? undefined,
                coversAcceptance: normalizeStringList(entry.coversAcceptance),
                coversImpactEdges: normalizeStringList(entry.coversImpactEdges),
                dependsOnCaseIds: normalizeStringList(entry.dependsOnCaseIds)
            }];
    });
    if (!groupId || !theme || !resourceKey || cases.length === 0)
        return null;
    return {
        schemaId: 'atm.testCaseGroup.v1',
        specVersion: String(raw.specVersion ?? '0.1.0'),
        groupId,
        theme,
        resourceKey,
        maintainers,
        supportedSeams: normalizeStringList(raw.supportedSeams),
        dependencyEdges: normalizeStringList(raw.dependencyEdges),
        cases,
        aliases: Array.isArray(raw.aliases)
            ? raw.aliases.flatMap((entry) => {
                if (!isRecord(entry))
                    return [];
                const aliasId = String(entry.aliasId ?? '').trim();
                const canonicalCaseId = String(entry.canonicalCaseId ?? '').trim();
                return aliasId && canonicalCaseId ? [{ aliasId, canonicalCaseId }] : [];
            })
            : [],
        lineage: Array.isArray(raw.lineage)
            ? raw.lineage.flatMap((entry) => {
                if (!isRecord(entry))
                    return [];
                const caseId = String(entry.caseId ?? '').trim();
                const next = String(entry.promotedTo ?? '').trim();
                return caseId && next ? [{ caseId, promotedTo: next }] : [];
            })
            : [],
        sourcePath
    };
}
function detectLineageCycle(shard) {
    const edges = new Map();
    for (const alias of shard.aliases ?? [])
        edges.set(alias.aliasId, alias.canonicalCaseId);
    for (const edge of shard.lineage ?? [])
        edges.set(edge.caseId, edge.promotedTo);
    for (const start of edges.keys()) {
        const seen = new Set();
        const pathIds = [];
        let current = start;
        while (current) {
            if (seen.has(current)) {
                const cycleStart = pathIds.indexOf(current);
                return [...pathIds.slice(cycleStart), current];
            }
            seen.add(current);
            pathIds.push(current);
            current = edges.get(current);
        }
    }
    return null;
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
            responsibility: normalizeValidatorResponsibility(entry.responsibility)
                ?? normalizeValidatorResponsibility(isRecord(entry.metadata) ? entry.metadata.responsibility : null),
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
