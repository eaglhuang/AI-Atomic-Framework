/**
 * integrations-core — public entry point
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * Re-export aggregator. All logic lives in the submodules below.
 * This file keeps the package identity constant, a few adapter-level
 * string constants, and re-exports every submodule symbol under the
 * original public names (I5: no field renames, no reordering).
 */
export declare const integrationsCorePackage: {
    readonly packageName: "@ai-atomic-framework/integrations-core";
    readonly packageRole: "integration-adapter-contracts";
    readonly packageVersion: "0.0.0";
};
export declare const atmFirstCommand = "node atm.mjs next --prompt \"$ARGUMENTS\" --json";
export declare const atmPromptScopedFirstCommand = "node atm.mjs next --prompt \"$ARGUMENTS\" --json";
export declare const atmIntentScopedFirstCommand = "node atm.mjs next --intent .atm/runtime/task-intent.json --json";
export declare const charterInvariantsPlaceholder = "{{CHARTER_INVARIANTS}}";
export type { SkillTemplateAdapterTarget, AtmSkillTemplateFrontmatter, AtmSkillTemplate, CompileSkillTemplateOptions, SkillCorpusSourceFile, SkillCorpusSourceSnapshot, SkillCorpusAdapterDescriptor, SkillCorpusProjection, SkillCorpusDiscoveryReason, SkillCorpusDiscoveryFinding, LoadSkillCorpusSourceSnapshotOptions, SkillSourceTrackingState, SkillSourceTrackingProbe, SkillSourceUniverse, SkillSourceUniverseEntry, SkillSourceUniverseFinding, ProjectionMetadataFinding, InstalledProjectionDisposition, InstalledProjectionDispositionRule, InstalledProjectionParityFinding, InstalledProjectionParityReport } from './compiler/skill-templates.ts';
export { minimumAtmEntrySkillDefinitions, defaultSkillTemplateDirectory, parseSkillTemplate, loadSkillTemplates, loadSkillTemplatesForProfile, loadMinimumAtmSkillTemplates, loadSkillCorpusSourceSnapshot, collectSkillCorpusDiscoveryFindings, compileSkillCorpus, sealSkillSourceUniverse, collectSkillSourceUniverseFindings, collectProjectionMetadataFindings, evaluateInstalledProjectionParity } from './compiler/skill-templates.ts';
export type { SkillTier, SkillInstallProfileId, SkillTargetScope, SkillInstallProfile } from './distribution/install-profile.ts';
export { defaultSkillInstallProfiles, getSkillInstallProfile, selectDefaultSkillInstallProfile, skillBelongsToProfile } from './distribution/install-profile.ts';
export type { SkillInvocationPolicy, AdapterCapabilityRequirement, CanonicalSkillCatalogEntry, CanonicalSkillCatalog, SkillProjectionFile, ProjectedSkillCatalog } from './distribution/skill-catalog.ts';
export { buildCanonicalSkillCatalog, inferCompanionFiles } from './distribution/skill-catalog.ts';
export type { AdapterCapabilities, SkillInstallationPlanInput, SkillInstallationPlan } from './distribution/skill-distribution-manager.ts';
export { resolveSkillInstallationPlan, digestSkillInstallationPlan } from './distribution/skill-distribution-manager.ts';
export type { ExternalSkillSourceFormat, ExternalSkillProviderId, FederationDecision, ExternalSkillSourceInput, ExternalSkillSourceDescriptor, ExternalSkillCatalogEntry, ExternalSkillCatalog, ExternalSkillCatalogSkip, ExternalSkillFederationDecision, FederatedSkillCatalog } from './distribution/external-skill-catalog.ts';
export { loadExternalSkillCatalog, federateExternalSkillCatalog } from './distribution/external-skill-catalog.ts';
export type { EditorGlobalOverlayMode, EditorGlobalOverlayOperationKind, EditorGlobalOverlayAdapterId, EditorGlobalOverlayAdapter, EditorGlobalSkillManifestFile, EditorGlobalSkillManifest, EditorGlobalOverlayFileOperation, EditorGlobalOverlayPlan, EditorGlobalOverlayApplyResult } from './distribution/editor-global-overlay.ts';
export { getEditorGlobalOverlayAdapter, createEditorGlobalOverlayPlan, applyEditorGlobalOverlayPlan, formatEditorGlobalSkillManifest } from './distribution/editor-global-overlay.ts';
export type { RenderedCharterInvariants } from './compiler/compile.ts';
export { renderCharterInvariantsBlock, compileSkillTemplatesForAdapter, compileSkillTemplate } from './compiler/compile.ts';
export type { KnownIntegrationAdapterId, IntegrationAdapterId, IntegrationFileFormat, IntegrationPlaceholderStyle, InstallManifestFileSource, Sha256Digest, IntegrationInstallContext, IntegrationSourceFile, InstallManifestFile, InstallManifest, CreateInstallManifestInput, IntegrationInstallResult, IntegrationAdapter, StaticIntegrationAdapterInput, CodexSkillsAdapterOptions, IntegrationVerifyResult, IntegrationUninstallResult } from './manifest/types.ts';
export { installManifestSchemaVersion, sha256Bytes, sha256File, normalizeManifestPath, formatInstallManifest } from './manifest/schema.ts';
export { createInstallManifest, createManifestFileRecord, createCodexSkillsAdapter, createStaticIntegrationAdapter } from './manifest/construct.ts';
export type { IntegrationFindingLevel, IntegrationFindingCode, IntegrationFinding } from './verify/types.ts';
