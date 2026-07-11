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
interface TestCatalogConfigProfile {
    extends?: string;
    validators?: unknown;
}
interface TestCatalogConfigFamily {
    id?: string;
    matchTags?: unknown;
}
interface TestCatalogConfigFocusRule {
    patterns?: unknown;
    validators?: unknown;
}
interface TestCatalogConfigValidator {
    name?: string;
    entry?: string;
    tags?: unknown;
    slow?: boolean;
    performanceBudgetMs?: number | null;
}
interface TestCatalogConfig {
    schemaId?: string;
    specVersion?: string;
    entries?: unknown;
    validators?: TestCatalogConfigValidator[];
    profiles?: Record<string, TestCatalogConfigProfile | undefined>;
    focusRules?: TestCatalogConfigFocusRule[];
    selectionFamilies?: TestCatalogConfigFamily[];
    performanceDefaults?: {
        slowValidatorBudgetMs?: number;
        fastValidatorBudgetMs?: number;
    };
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
export declare function readTestCatalog(repositoryRoot: string, options?: {
    validatorsConfig?: TestCatalogConfig;
}): TestCatalog;
export declare function resolveTestPlanForTask(task: unknown, changedFiles?: string[], repoKind?: string): TaskTestPlan;
export declare function selectTestEntries(options: SelectTestEntriesOptions): TestEntrySelection;
export declare function dedupeByKeys(entries: TestCatalogEntry[]): TestCatalogEntry[];
export declare function resolveLanguageStaticEntries(changedFiles: string[], adapters: TestCatalogEntry[]): TestCatalogEntry[];
export declare function projectValidatorsFromConfig(config: TestCatalogConfig): TestCatalogEntry[];
export declare function findDuplicateDedupeKeys(entries: TestCatalogEntry[]): string[];
export declare function normalizeTier(value: unknown): TestTier | null;
export {};
