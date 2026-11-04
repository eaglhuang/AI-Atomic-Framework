export interface AtomRefSweepOptions {
    readonly repos: readonly string[];
    readonly apply: boolean;
    readonly generatedAt?: string;
}
export interface AtomRefSweepResult {
    readonly schemaId: 'atm.atomRefSweep';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly apply: boolean;
    readonly repos: readonly RepoReadabilityReport[];
}
export interface RepoReadabilityReport {
    readonly repoPath: string;
    readonly ok: boolean;
    readonly registryPath: string | null;
    readonly atomCount: number;
    readonly mapCount: number;
    readonly memberAtomCount: number;
    readonly callsiteCount: number;
    readonly violationCount: number;
    readonly generatedRefPaths: readonly string[];
    readonly reportPaths: readonly string[];
    readonly violations: readonly AtomCallsiteViolation[];
    readonly rewrittenCallsites: readonly AtomCallsiteRewrite[];
    readonly skipped: readonly string[];
}
export interface AtomCatalogEntry {
    readonly kind: 'atom' | 'map';
    readonly id: string;
    readonly refName: string;
    readonly logicalName: string;
    readonly purpose: string;
    readonly sourcePaths: readonly string[];
    readonly members: readonly string[];
    readonly entrypoints: readonly string[];
}
export interface RegistryLocationRecord {
    readonly codePaths?: unknown;
    readonly specPath?: unknown;
    readonly reportPath?: unknown;
}
export interface RegistrySelfVerificationRecord {
    readonly sourcePaths?: {
        readonly code?: unknown;
    };
}
export interface RegistryEntryRecord {
    readonly atomId?: unknown;
    readonly mapId?: unknown;
    readonly logicalName?: unknown;
    readonly purpose?: unknown;
    readonly location?: RegistryLocationRecord;
    readonly selfVerification?: RegistrySelfVerificationRecord;
}
export interface RegistryDocumentRecord {
    readonly entries?: unknown;
}
export interface MapSpecMemberRecord {
    readonly atomId?: unknown;
}
export interface MapSpecQualityTargetsRecord {
    readonly pilotName?: unknown;
    readonly equivalenceFixtures?: unknown;
}
export interface MapSpecReplacementRecord {
    readonly legacyUris?: unknown;
}
export interface MapSpecRecord {
    readonly description?: unknown;
    readonly logicalName?: unknown;
    readonly members?: unknown;
    readonly entrypoints?: unknown;
    readonly qualityTargets?: MapSpecQualityTargetsRecord;
    readonly replacement?: MapSpecReplacementRecord;
}
export interface AtomCallsite {
    readonly file: string;
    readonly line: number;
    readonly callee: 'runAtm' | 'runAtmMap';
    readonly firstArgument: string;
}
export interface AtomCallsiteViolation extends AtomCallsite {
    readonly code: string;
    readonly detail: string;
}
export interface AtomCallsiteRewrite extends AtomCallsite {
    readonly from: string;
    readonly to: string;
}
export declare function asRecord<T extends object>(value: unknown): T | null;
export declare const atomIdPattern: RegExp;
export declare const atomIdLikePattern: RegExp;
export declare const sourceExtensions: Set<string>;
export declare const ignoredDirectoryNames: Set<string>;
export declare function generatedPathsForRepo(repoPath: string): string[];
export declare function isFrameworkRepo(repoPath: string): boolean;
