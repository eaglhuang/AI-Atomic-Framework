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
export type { SkillTemplateAdapterTarget, AtmSkillTemplateFrontmatter, AtmSkillTemplate, CompileSkillTemplateOptions } from './compiler/skill-templates.ts';
export { minimumAtmEntrySkillDefinitions, defaultSkillTemplateDirectory, parseSkillTemplate, loadSkillTemplates, loadMinimumAtmSkillTemplates } from './compiler/skill-templates.ts';
export type { RenderedCharterInvariants } from './compiler/compile.ts';
export { renderCharterInvariantsBlock, compileSkillTemplatesForAdapter, compileSkillTemplate } from './compiler/compile.ts';
export type { KnownIntegrationAdapterId, IntegrationAdapterId, IntegrationFileFormat, IntegrationPlaceholderStyle, InstallManifestFileSource, Sha256Digest, IntegrationInstallContext, IntegrationSourceFile, InstallManifestFile, InstallManifest, CreateInstallManifestInput, IntegrationInstallResult, IntegrationAdapter, StaticIntegrationAdapterInput, CodexSkillsAdapterOptions, IntegrationVerifyResult, IntegrationUninstallResult } from './manifest/types.ts';
export { installManifestSchemaVersion, sha256Bytes, sha256File, normalizeManifestPath, formatInstallManifest } from './manifest/schema.ts';
export { createInstallManifest, createManifestFileRecord, createCodexSkillsAdapter, createStaticIntegrationAdapter } from './manifest/construct.ts';
export type { IntegrationFindingLevel, IntegrationFindingCode, IntegrationFinding } from './verify/types.ts';
