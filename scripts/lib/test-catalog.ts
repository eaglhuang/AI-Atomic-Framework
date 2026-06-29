import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type TestCapability = 'validator' | 'integration-test';
export type TestTier = 'quick' | 'standard' | 'full';
export type TestScope = 'task-local' | 'global-advisory' | 'release-blocking' | 'diagnostic';

export interface TestCatalogEntry {
  key: string;
  capability: TestCapability;
  family: string;
  source: string;
  scope: TestScope;
  tiers: TestTier[];
  command?: string | null;
  validatorName?: string | null;
  entry?: string | null;
  tags?: string[];
  pathTriggers?: string[];
  dedupeKeys?: string[];
  costBudgetMs?: number | null;
  performanceGate?: 'advisory' | 'blocking' | null;
  metadata?: Record<string, unknown>;
}

export interface TestCatalog {
  schemaId: 'atm.testCatalog.v1';
  specVersion: string;
  entries: TestCatalogEntry[];
  sourcePath?: string | null;
}

export interface TaskTestCapabilityPlan {
  defaultTier?: TestTier;
  requiredKeys?: string[];
  requiredFamilies?: string[];
  allowedScopes?: TestScope[];
}

export interface TaskTestPlan {
  schemaId?: string;
  selectionMode?: string;
  validators?: TaskTestCapabilityPlan;
  integrationTests?: TaskTestCapabilityPlan;
}

export interface SelectTestEntriesOptions {
  catalog: TestCatalog;
  capability?: TestCapability;
  tier?: TestTier;
  taskPlan?: TaskTestPlan | null;
  changedFiles?: string[];
}

export interface TestEntrySelection {
  entries: TestCatalogEntry[];
  duplicateDedupeKeys: string[];
}

const tierRank: Record<TestTier, number> = {
  quick: 1,
  standard: 2,
  full: 3
};

export function readTestCatalog(repositoryRoot: string, options: { validatorsConfig?: any } = {}): TestCatalog {
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

export function resolveTestPlanForTask(task: any, changedFiles: string[] = [], repoKind = 'framework-repository'): TaskTestPlan {
  const explicitPlan = isRecord(task?.testPlan) ? task.testPlan : {};
  const legacyValidators = Array.isArray(task?.validators) ? task.validators.map(String) : [];
  const languageStaticRequired = changedFiles.some((filePath) => matchesAny(filePath, [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
    '**/*.cs'
  ]));
  const validators = {
    defaultTier: normalizeTier(explicitPlan?.validators?.defaultTier) ?? 'quick',
    requiredKeys: normalizeStringList(explicitPlan?.validators?.requiredKeys),
    requiredFamilies: [
      ...normalizeStringList(explicitPlan?.validators?.requiredFamilies),
      ...(languageStaticRequired ? ['language-static'] : []),
      ...legacyValidators
    ],
    allowedScopes: normalizeScopes(explicitPlan?.validators?.allowedScopes, repoKind)
  };
  const integrationTests = {
    defaultTier: normalizeTier(explicitPlan?.integrationTests?.defaultTier) ?? 'quick',
    requiredKeys: normalizeStringList(explicitPlan?.integrationTests?.requiredKeys),
    requiredFamilies: normalizeStringList(explicitPlan?.integrationTests?.requiredFamilies),
    allowedScopes: normalizeScopes(explicitPlan?.integrationTests?.allowedScopes, repoKind)
  };
  return {
    schemaId: 'atm.taskTestPlan.v1',
    selectionMode: String(explicitPlan?.selectionMode ?? 'task-scoped'),
    validators,
    integrationTests
  };
}

export function selectTestEntries(options: SelectTestEntriesOptions): TestEntrySelection {
  const capability = options.capability;
  const tier = options.tier ?? capabilityDefaultTier(capability, options.taskPlan);
  const normalizedChangedFiles = (options.changedFiles ?? []).map(normalizePath).filter(Boolean);
  const plan = capabilityPlan(options.taskPlan, capability);
  const requiredKeys = new Set(normalizeStringList(plan?.requiredKeys));
  const requiredFamilies = new Set(normalizeStringList(plan?.requiredFamilies));
  const allowedScopes = new Set(normalizeScopes(plan?.allowedScopes, 'framework-repository'));
  const candidates = options.catalog.entries.filter((entry) => {
    if (capability && entry.capability !== capability) return false;
    const required = requiredKeys.has(entry.key) || requiredFamilies.has(entry.family);
    if (!required && !entryTierEligible(entry, tier)) return false;
    if (allowedScopes.size > 0 && !allowedScopes.has(entry.scope) && !required) return false;
    if (normalizedChangedFiles.length > 0 && !required) {
      const triggers = entry.pathTriggers ?? [];
      if (triggers.length === 0) return false;
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

export function dedupeByKeys(entries: TestCatalogEntry[]): TestCatalogEntry[] {
  const selected: TestCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = firstDedupeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(entry);
  }
  return selected;
}

export function resolveLanguageStaticEntries(changedFiles: string[], adapters: TestCatalogEntry[]): TestCatalogEntry[] {
  const normalizedChangedFiles = changedFiles.map(normalizePath).filter(Boolean);
  return adapters.filter((entry) => {
    if (entry.family !== 'language-static') return false;
    const triggers = entry.pathTriggers ?? [];
    return triggers.some((pattern) => normalizedChangedFiles.some((filePath) => matchesPattern(pattern, filePath)));
  });
}

export function projectValidatorsFromConfig(config: any): TestCatalogEntry[] {
  const validatorNamesByProfile = new Map<string, Set<string>>();
  for (const profileName of ['quick', 'standard', 'full']) {
    validatorNamesByProfile.set(profileName, new Set(resolveProfileValidatorNamesFromConfig(config, profileName)));
  }
  const focusTriggersByValidator = collectFocusTriggersByValidator(config);
  return (config.validators ?? []).map((validator: any) => {
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
    } satisfies TestCatalogEntry;
  });
}

export function findDuplicateDedupeKeys(entries: TestCatalogEntry[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    for (const key of entry.dedupeKeys?.length ? entry.dedupeKeys : [entry.key]) {
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
  }
  return [...duplicates].sort();
}

export function normalizeTier(value: unknown): TestTier | null {
  const text = String(value ?? '').toLowerCase();
  return text === 'quick' || text === 'standard' || text === 'full' ? text : null;
}

function capabilityDefaultTier(capability: TestCapability | undefined, plan: TaskTestPlan | null | undefined): TestTier {
  const selectedPlan = capabilityPlan(plan, capability);
  return normalizeTier(selectedPlan?.defaultTier) ?? 'standard';
}

function capabilityPlan(plan: TaskTestPlan | null | undefined, capability: TestCapability | undefined): TaskTestCapabilityPlan | null {
  if (!plan) return null;
  if (capability === 'integration-test') return plan.integrationTests ?? null;
  return plan.validators ?? null;
}

function normalizeEntries(entries: unknown): TestCatalogEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => normalizeEntry(entry));
}

function normalizeEntry(entry: unknown): TestCatalogEntry[] {
  if (!isRecord(entry)) return [];
  const tierValues = Array.isArray(entry.tiers) ? entry.tiers.map(normalizeTier).filter(Boolean) : [];
  const capability = entry.capability === 'integration-test' ? 'integration-test' : 'validator';
  const scope = normalizeScope(entry.scope) ?? 'task-local';
  if (!entry.key || !entry.family || tierValues.length === 0) return [];
  return [{
    key: String(entry.key),
    capability,
    family: String(entry.family),
    source: String(entry.source ?? 'catalog'),
    scope,
    tiers: tierValues as TestTier[],
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

function resolveValidatorTiers(name: string, namesByProfile: Map<string, Set<string>>): TestTier[] {
  if (namesByProfile.get('quick')?.has(name)) return ['quick', 'standard', 'full'];
  if (namesByProfile.get('standard')?.has(name)) return ['standard', 'full'];
  if (namesByProfile.get('full')?.has(name)) return ['full'];
  return ['standard'];
}

function resolveProfileValidatorNamesFromConfig(config: any, profileName: string): string[] {
  const profile = config.profiles?.[profileName];
  if (!profile) return [];
  const inherited = profile.extends ? resolveProfileValidatorNamesFromConfig(config, profile.extends) : [];
  return [...new Set([...inherited, ...(profile.validators ?? []).map(String)])];
}

function collectFocusTriggersByValidator(config: any): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const rule of config.focusRules ?? []) {
    const patterns = normalizeStringList(rule.patterns);
    for (const validatorName of normalizeStringList(rule.validators)) {
      result.set(validatorName, [...new Set([...(result.get(validatorName) ?? []), ...patterns])]);
    }
  }
  return result;
}

function resolveFamilyForValidator(tags: string[], families: any[]): string {
  for (const family of families) {
    const matchTags = normalizeStringList(family.matchTags).map((entry) => entry.toLowerCase());
    if (tags.some((tag) => matchTags.includes(tag.toLowerCase()))) {
      return String(family.id ?? 'uncategorized');
    }
  }
  return 'uncategorized';
}

function entryTierEligible(entry: TestCatalogEntry, requestedTier: TestTier): boolean {
  return entry.tiers.some((tier) => tierRank[tier] <= tierRank[requestedTier]);
}

function normalizeScopes(value: unknown, repoKind: string): TestScope[] {
  const scopes = Array.isArray(value) ? value.map(normalizeScope).filter(Boolean) as TestScope[] : [];
  if (scopes.length > 0) return scopes;
  return repoKind === 'framework-repository'
    ? ['task-local', 'global-advisory', 'release-blocking']
    : ['task-local'];
}

function normalizeScope(value: unknown): TestScope | null {
  const text = String(value ?? '');
  if (text === 'task-local' || text === 'global-advisory' || text === 'release-blocking' || text === 'diagnostic') {
    return text;
  }
  return null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}

function dedupeByKey(entries: TestCatalogEntry[]): TestCatalogEntry[] {
  const seen = new Set<string>();
  const selected: TestCatalogEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    selected.push(entry);
  }
  return selected;
}

function firstDedupeKey(entry: TestCatalogEntry): string {
  return entry.dedupeKeys?.[0] ?? entry.key;
}

function matchesAny(filePath: string, patterns: string[]): boolean {
  const normalized = normalizePath(filePath);
  return patterns.some((pattern) => matchesPattern(pattern, normalized));
}

function matchesPattern(pattern: string, candidatePath: string): boolean {
  const escaped = String(pattern || '')
    .replace(/\\/g, '/')
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(normalizePath(candidatePath));
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}

function toPortablePath(value: string): string {
  return String(value || '').replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
