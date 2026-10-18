export interface ProjectionMetadataFinding {
    readonly field: 'sourceDigest' | 'sourceUniverseDigest' | 'compilerVersion' | 'manifestDigest';
    readonly expected: string | null;
    readonly actual: string | null;
    readonly summary: string;
}
/**
 * Report the ways a projection can stop describing the snapshot it claims to
 * come from. A projection that keeps stale provenance is worse than one with
 * none, because downstream verification trusts the recorded fields.
 *
 * The parameters are structural on purpose: a compiled projection and its
 * sealed snapshot satisfy them, and so does any fixture, without this module
 * having to depend on the compiler it checks.
 */
export declare function collectProjectionMetadataFindings(projection: {
    readonly sourceDigest: string;
    readonly sourceUniverseDigest: string | null;
    readonly compilerVersion: string;
    readonly manifestDigest: string;
}, sourceSnapshot: {
    readonly sourceDigest: string;
    readonly sourceUniverseDigest: string | null;
    readonly compilerVersion: string;
}): readonly ProjectionMetadataFinding[];
export type InstalledProjectionDisposition = 'sync' | 'approved-baseline' | 'explicit-waiver' | 'fail-closed';
export interface InstalledProjectionDispositionRule {
    readonly templateId: string;
    readonly disposition: 'approved-baseline' | 'explicit-waiver';
    readonly reason: string;
    /** Every declared drift belongs to a governed card, which is what keeps the set finite. */
    readonly owningTaskId: string;
    /** Required for approved-baseline: the exact installed bytes the baseline covers. */
    readonly expectedInstalledDigest?: string;
}
export interface InstalledProjectionParityFinding {
    readonly templateId: string;
    readonly installedPath: string;
    readonly disposition: InstalledProjectionDisposition;
    readonly summary: string;
    readonly owningTaskId: string | null;
}
export interface InstalledProjectionParityReport {
    readonly findings: readonly InstalledProjectionParityFinding[];
    readonly failClosed: readonly InstalledProjectionParityFinding[];
}
/**
 * A targeted refresh is intentionally smaller than a corpus refresh.  It
 * selects exactly one compiled SKILL.md member, so a repair can update its
 * declared projections without treating unrelated installed copies as
 * incidental output.
 */
export interface TargetedSkillProjectionRefresh {
    readonly templateId: string;
    readonly projectionRelativePath: string;
    readonly content: string;
    readonly installedPaths: readonly string[];
}
export declare function resolveTargetedSkillProjectionRefresh(input: {
    readonly templateId: string;
    readonly compiledProjectionFiles: readonly {
        readonly relativePath: string;
        readonly content: string;
    }[];
    readonly installedPaths: readonly string[];
}): TargetedSkillProjectionRefresh;
export declare function evaluateInstalledProjectionParity(input: {
    readonly compiledProjectionFiles: readonly {
        readonly relativePath: string;
        readonly content: string;
    }[];
    readonly installedSkillRoot: string;
    readonly dispositions?: readonly InstalledProjectionDispositionRule[];
    readonly readFile?: (filePath: string) => string;
    readonly fileExists?: (filePath: string) => boolean;
}): InstalledProjectionParityReport;
