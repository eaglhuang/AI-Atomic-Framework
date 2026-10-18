import type { AdapterCapabilityRequirement, SkillInvocationPolicy } from '../distribution/skill-catalog.js';
import { type SkillSourceUniverse, type SkillSourceUniverseFinding } from './skill-source-universe.js';
import { type SkillInstallProfileId, type SkillTier } from '../distribution/install-profile.js';
export { defaultSkillTemplateDirectory, sealSkillSourceUniverse, collectSkillSourceUniverseFindings } from './skill-source-universe.js';
export type { SkillSourceTrackingState, SkillSourceTrackingProbe, SkillSourceUniverse, SkillSourceUniverseEntry, SkillSourceUniverseFinding } from './skill-source-universe.js';
export { evaluateInstalledProjectionParity, collectProjectionMetadataFindings, resolveTargetedSkillProjectionRefresh } from './skill-projection-parity.js';
export type { ProjectionMetadataFinding, InstalledProjectionDisposition, InstalledProjectionDispositionRule, InstalledProjectionParityFinding, InstalledProjectionParityReport, TargetedSkillProjectionRefresh } from './skill-projection-parity.js';
export type SkillTemplateAdapterTarget = 'claude-code' | 'copilot' | 'cursor' | 'gemini' | 'codex';
export interface AtmSkillTemplateFrontmatter {
    readonly schemaId: 'atm.skillTemplate';
    readonly specVersion: '0.1.0';
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly command: string;
    readonly firstCommand: string;
    readonly 'charter-invariants-injected': boolean;
    readonly handoffs: string;
    readonly owner: string;
    readonly tier: SkillTier;
    readonly installProfiles: readonly SkillInstallProfileId[];
    readonly invocationPolicy: SkillInvocationPolicy;
    readonly companionFiles: readonly string[];
    readonly adapterCapabilityRequirements: readonly AdapterCapabilityRequirement[];
}
export interface SkillProviderProvenance {
    readonly providerId: string;
    readonly version: string;
    readonly provenance: {
        readonly upstreamUrl: string;
        readonly upstreamCommit: string;
        readonly sourceDigest: `sha256:${string}`;
    };
    readonly license: string;
}
export interface AtmSkillDefinitionVNext {
    readonly schemaId: 'atm.skillDefinition.vNext';
    readonly specVersion: '0.1.0';
    readonly provider: SkillProviderProvenance;
    readonly capabilities: readonly string[];
    readonly compatibility: {
        readonly atmContractVersions: readonly string[];
    };
    readonly fallbackPolicy: 'deny' | 'degrade-with-evidence' | 'legacy-compatible';
    readonly rollbackPolicy: 'provider-only' | 'manifest-only' | 'full-revert';
    readonly invocationModes?: readonly ('model' | 'user' | 'router')[];
    readonly progressiveDisclosure?: readonly SkillProgressiveDisclosureReference[];
    readonly completionCriteria?: readonly SkillCompletionCriterion[];
    readonly canaryMeasurements?: SkillCanaryMeasurements;
    readonly shadowRun?: boolean;
    readonly promotion?: 'manual-review' | 'measured-promotion' | 'disabled';
}
export interface SkillProgressiveDisclosureReference {
    readonly id: string;
    readonly path: string;
    readonly purpose: string;
    readonly maxTokens?: number;
}
export interface SkillCompletionCriterion {
    readonly id: string;
    readonly validator: string;
    readonly required: boolean;
}
export interface SkillCanaryMeasurements {
    readonly contextTokens: {
        readonly target: number;
        readonly max: number;
    };
    readonly falseInvocationRate: {
        readonly target: number;
        readonly max: number;
    };
}
export interface SkillCapabilityManifestInput {
    readonly provider: SkillProviderProvenance;
    readonly capabilities: readonly string[];
    readonly atmContractVersions: readonly string[];
    readonly fallbackPolicy?: AtmSkillDefinitionVNext['fallbackPolicy'];
    readonly rollbackPolicy?: AtmSkillDefinitionVNext['rollbackPolicy'];
    readonly invocationModes?: readonly ('model' | 'user' | 'router')[];
    readonly progressiveDisclosure?: readonly SkillProgressiveDisclosureReference[];
    readonly completionCriteria?: readonly SkillCompletionCriterion[];
    readonly canaryMeasurements?: SkillCanaryMeasurements;
    readonly shadowRun?: boolean;
    readonly promotion?: AtmSkillDefinitionVNext['promotion'];
}
export declare function createSkillDefinitionVNext(input: SkillCapabilityManifestInput): AtmSkillDefinitionVNext;
export declare function projectSkillDefinition(template: AtmSkillTemplate, manifest: SkillCapabilityManifestInput): AtmSkillDefinitionVNext & {
    readonly skillId: string;
    readonly legacyReadable: true;
};
export interface AtmSkillTemplate {
    readonly frontmatter: AtmSkillTemplateFrontmatter;
    readonly body: string;
    readonly sourcePath: string;
}
export interface CompileSkillTemplateOptions {
    readonly repositoryRoot?: string;
}
export interface SkillCorpusSourceFile {
    readonly id: string;
    readonly sourcePath: string;
    readonly content: string;
    readonly sourceDigest: `sha256:${string}`;
}
export interface SkillCorpusSourceSnapshot {
    readonly schemaId: 'atm.skillCorpusSourceSnapshot.v1';
    readonly compilerVersion: '0.1.0';
    readonly generatedAt: string;
    readonly sourceRoot: string;
    readonly templateCount: number;
    readonly templates: readonly AtmSkillTemplate[];
    readonly sourceFiles: readonly SkillCorpusSourceFile[];
    readonly sourceDigest: `sha256:${string}`;
    /**
     * Whether a source universe was sealed for this snapshot at audit time.
     * An unsealed snapshot is admissible only for in-memory fixture corpora,
     * where there is no version-control universe to seal in the first place.
     */
    readonly sourceUniverseSealed: boolean;
    readonly sourceUniverseDigest: `sha256:${string}` | null;
    readonly sourceUniverseFindings: readonly SkillSourceUniverseFinding[];
    readonly untrackedSourceTemplatePaths: readonly string[];
    readonly ignoredSourceTemplatePaths: readonly string[];
}
export interface SkillCorpusAdapterDescriptor<TProjectionFile = unknown> {
    readonly adapterId: SkillTemplateAdapterTarget;
    readonly manifestDigest?: `sha256:${string}`;
    readonly diagnostics?: readonly string[];
    readonly project: (input: {
        readonly adapterId: SkillTemplateAdapterTarget;
        readonly templates: readonly AtmSkillTemplate[];
        readonly sourceSnapshot: SkillCorpusSourceSnapshot;
    }) => readonly TProjectionFile[];
}
export interface SkillCorpusProjection<TProjectionFile = unknown> {
    readonly schemaId: 'atm.skillCorpusProjection.v1';
    readonly compilerVersion: '0.1.0';
    readonly adapterId: SkillTemplateAdapterTarget;
    readonly sourceDigest: `sha256:${string}`;
    /** Which sealed source universe this projection was allowed to compile from. */
    readonly sourceUniverseDigest: `sha256:${string}` | null;
    readonly manifestDigest: `sha256:${string}`;
    readonly degradationDiagnostics: readonly string[];
    readonly files: readonly TProjectionFile[];
}
export interface MinimumAtmEntrySkillDefinition {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly command: string;
}
export declare const minimumAtmEntrySkillDefinitions: readonly MinimumAtmEntrySkillDefinition[];
/**
 * Section marker that carries the ATM-only execution route warning into the
 * canonical entry skills. The policy itself lives in the core
 * RestrictedExecutionGateway; templates only project it, and the projection is
 * required so a compiled skill cannot silently drop the warning.
 */ export declare const atmOnlyExecutionRouteSectionMarker = "ATM-Only Execution Route";
export declare const atmOnlyExecutionRouteTemplateIds: readonly string[];
export declare function assertAtmOnlyExecutionRouteProjection(templates: readonly AtmSkillTemplate[]): void;
export declare function parseSkillTemplate(content: string, sourcePath?: string): AtmSkillTemplate;
export declare function loadSkillTemplates(templateDirectory?: string): readonly AtmSkillTemplate[];
export declare function loadMinimumAtmSkillTemplates(templateDirectory?: string): readonly AtmSkillTemplate[];
export declare function loadSkillTemplatesForProfile(profileId: SkillInstallProfileId, templateDirectory?: string): readonly AtmSkillTemplate[];
export interface LoadSkillCorpusSourceSnapshotOptions {
    /**
     * The version-control universe sealed for this corpus at audit time. It is
     * the only channel through which tracking state may reach the compiler: the
     * compiler never asks the local repository what is tracked, ignored, or
     * excluded, so a projection cannot mean two different things on two
     * workstations that hold the same bytes.
     */
    readonly sourceUniverse?: SkillSourceUniverse;
}
export declare function loadSkillCorpusSourceSnapshot(templateDirectory?: string, options?: LoadSkillCorpusSourceSnapshotOptions): SkillCorpusSourceSnapshot;
/**
 * Why a discovered source file could not become a corpus member every adapter
 * can bake. These are the ways a file can exist on disk, look like a template,
 * and still reach no installation.
 */
export type SkillCorpusDiscoveryReason = 'unparsable-frontmatter' | 'missing-contract-fields' | 'no-install-profile';
export interface SkillCorpusDiscoveryFinding {
    readonly sourcePath: string;
    readonly reason: SkillCorpusDiscoveryReason;
    /** Contract fields that are absent or hold a value the contract does not allow. */
    readonly missingFields: readonly string[];
    readonly recovery: string;
}
/**
 * Report every discovered `*.skill.md` that cannot reach an adapter.
 *
 * Discovery is decided only by the declared contract, never by a known skill
 * id, filename, or workstation path. A source file that satisfies the contract
 * and belongs to at least one install profile produces no finding; anything
 * else must be reported here rather than disappearing between the corpus count
 * and the bake.
 */
export declare function collectSkillCorpusDiscoveryFindings(templateDirectory?: string): readonly SkillCorpusDiscoveryFinding[];
export declare function compileSkillCorpus<TProjectionFile>(input: {
    readonly sourceSnapshot: SkillCorpusSourceSnapshot;
    readonly adapterDescriptor: SkillCorpusAdapterDescriptor<TProjectionFile>;
}): SkillCorpusProjection<TProjectionFile>;
