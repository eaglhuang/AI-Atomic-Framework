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
interface AtomCallsite {
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
export declare function sweepAtomRefReadability(options: AtomRefSweepOptions): AtomRefSweepResult;
export declare function validateAtomRefReadability(repoPath: string): RepoReadabilityReport;
export {};
