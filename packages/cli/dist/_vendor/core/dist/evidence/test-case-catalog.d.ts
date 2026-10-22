export type ValidatorResponsibility = 'task-required' | 'phase-suite' | 'advisory';
export declare const VALIDATOR_RESPONSIBILITIES: readonly ValidatorResponsibility[];
export type TestCaseIdKind = 'int' | 'task';
export interface TestCaseGroupCase {
    readonly caseId: string;
    readonly semanticKey: string;
    readonly command?: string | null;
    readonly responsibility?: ValidatorResponsibility;
    readonly coversAcceptance?: readonly string[];
    readonly coversImpactEdges?: readonly string[];
    readonly dependsOnCaseIds?: readonly string[];
}
/** The only shard schema the group loader can address. */
export declare const CASE_GROUP_SHARD_SCHEMA_ID = "atm.testCaseGroup.v1";
export interface TestCaseGroupShard {
    readonly schemaId: typeof CASE_GROUP_SHARD_SCHEMA_ID;
    readonly specVersion: string;
    readonly groupId: string;
    readonly theme: string;
    readonly resourceKey: string;
    readonly maintainers: readonly string[];
    readonly supportedSeams?: readonly string[];
    readonly dependencyEdges?: readonly string[];
    readonly cases: readonly TestCaseGroupCase[];
    readonly aliases?: readonly {
        readonly aliasId: string;
        readonly canonicalCaseId: string;
    }[];
    readonly lineage?: readonly {
        readonly caseId: string;
        readonly promotedTo: string;
    }[];
    readonly sourcePath?: string | null;
}
export interface TestCaseShardDiagnostic {
    readonly code: string;
    readonly severity: 'error' | 'warning';
    readonly message: string;
    readonly groupId?: string;
    readonly caseId?: string;
}
export interface GeneratedTestCaseCatalog {
    readonly schemaId: 'atm.generatedTestCaseCatalog.v1';
    readonly queryAuthorityOnly: true;
    readonly mutableRegistry: false;
    readonly generatedAt: string;
    readonly groups: readonly {
        readonly groupId: string;
        readonly theme: string;
        readonly resourceKey: string;
        readonly caseIds: readonly string[];
    }[];
    readonly cases: readonly {
        readonly caseId: string;
        readonly groupId: string;
        readonly semanticKey: string;
        readonly aliases: readonly string[];
        readonly promotedTo: string | null;
    }[];
    readonly diagnostics: readonly TestCaseShardDiagnostic[];
}
export declare function normalizeValidatorResponsibility(value: unknown): ValidatorResponsibility | null;
export declare function normalizeSemanticKey(value: string): string;
export declare function buildTestCaseId(input: {
    readonly kind: TestCaseIdKind;
    readonly namespace: string;
    readonly semanticKey: string;
}): string;
export declare function resolveCaseGroupShardsRoot(repositoryRoot: string): string;
export interface RawTestCaseShardFile {
    readonly raw: Record<string, unknown>;
    readonly sourcePath: string;
}
export declare function readRawShardFiles(repositoryRoot: string, groupsRoot?: string): RawTestCaseShardFile[];
/**
 * Why a shard cannot be loaded, or null when it can.
 *
 * Reachability was decided by a normalizer that answered null and said nothing.
 * A shard that failed any one of several conditions therefore left no trace, so
 * the catalog reported green over case ids it had never read. The conditions are
 * named here once and consulted by both the loader, which fails closed on them,
 * and the reachability report, which only describes them.
 */
export declare function describeShardUnreachability(raw: Record<string, unknown>, sourcePath: string): string | null;
/**
 * Load every shard, or refuse to load any.
 *
 * Dropping the unloadable ones is what made the blind spot invisible: the
 * validator could pass while a shard's case ids were never checked, which is
 * precisely the outcome a catalog validator exists to prevent. Every unreachable
 * shard is named with its file and schemaId in one message, so a repair does not
 * have to be discovered one failure at a time.
 */
export declare function loadTestCaseGroupShards(repositoryRoot: string, groupsRoot?: string): TestCaseGroupShard[];
export interface LegacyCaseAlias {
    readonly legacyCaseId: string;
    readonly canonicalCaseId: string;
    readonly groupId: string;
    readonly sourcePath: string;
}
export declare function loadLegacyCaseAliases(repositoryRoot: string, groupsRoot?: string): LegacyCaseAlias[];
export declare function loadAllShardCaseIds(repositoryRoot: string, groupsRoot?: string): string[];
export declare function resolveLegacyCaseId(legacyCaseId: string, aliases: readonly LegacyCaseAlias[]): string | null;
export declare function validateLegacyCaseAliases(aliases: readonly LegacyCaseAlias[], knownCaseIds: readonly string[]): TestCaseShardDiagnostic[];
export interface ShardReachabilityEntry {
    readonly sourcePath: string;
    readonly fileName: string;
    readonly groupId: string;
    readonly schemaId: string;
    readonly reachable: boolean;
    /** Null when reachable; otherwise why the loader refuses this file. */
    readonly unreachableReason: string | null;
    readonly caseIds: readonly string[];
    readonly caseIdShape: 'cases' | 'caseIds' | 'mixed' | 'none';
}
export declare function reportShardReachability(repositoryRoot: string, groupsRoot?: string): ShardReachabilityEntry[];
export declare function validateTestCaseGroupShards(shards: readonly TestCaseGroupShard[]): TestCaseShardDiagnostic[];
export declare function generateReadOnlyTestCaseCatalog(shards: readonly TestCaseGroupShard[], options?: {
    generatedAt?: string;
}): GeneratedTestCaseCatalog;
