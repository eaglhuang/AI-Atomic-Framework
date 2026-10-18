export declare const integrationsCoreRepoRoot: string;
export declare const defaultSkillTemplateDirectory: string;
/**
 * Returns the provenance root for a concrete template directory. Source-tree
 * callers hand us the framework corpus under the repository root; installed
 * packages hand us their bundled corpus. A fixture has no broader provenance
 * root, so its directory itself is the only stable relative base.
 */
export declare function resolveSkillSourceRoot(templateDirectory: string): string;
export declare function sha256Text(content: string): `sha256:${string}`;
export type SkillSourceTrackingState = 'tracked' | 'untracked' | 'ignored';
/**
 * Tracking state gathered by the audit/seal stage. Paths may be given relative
 * to the repository root or to the template directory; both are normalised
 * against the sealed source root.
 */
export interface SkillSourceTrackingProbe {
    readonly trackedPaths: readonly string[];
    readonly ignoredPaths: readonly string[];
}
export interface SkillSourceUniverseEntry {
    readonly sourcePath: string;
    readonly trackingState: SkillSourceTrackingState;
    readonly sourceDigest: `sha256:${string}`;
}
export interface SkillSourceUniverse {
    readonly schemaId: 'atm.skillSourceUniverse.v1';
    readonly specVersion: '0.1.0';
    readonly sealedAt: string;
    readonly sourceRoot: string;
    readonly entries: readonly SkillSourceUniverseEntry[];
    readonly universeDigest: `sha256:${string}`;
}
export interface SkillSourceUniverseFinding {
    readonly sourcePath: string;
    readonly trackingState: 'untracked' | 'ignored';
    readonly recovery: string;
}
export declare function sealSkillSourceUniverse(input: {
    readonly templateDirectory?: string;
    readonly probe: SkillSourceTrackingProbe;
    readonly sealedAt?: string;
}): SkillSourceUniverse;
/**
 * Every formal source template that is not under version control, paired with
 * the command that repairs it. These are hard findings: a corpus holding one
 * cannot be reproduced by anyone else, so it must not reach a projection.
 */
export declare function collectSkillSourceUniverseFindings(universe: SkillSourceUniverse): readonly SkillSourceUniverseFinding[];
