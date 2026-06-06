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
// ─── Package identity ──────────────────────────────────────────────────────
export const integrationsCorePackage = {
    packageName: '@ai-atomic-framework/integrations-core',
    packageRole: 'integration-adapter-contracts',
    packageVersion: '0.0.0'
};
// ─── Adapter-level string constants ───────────────────────────────────────
export const atmFirstCommand = 'node atm.mjs next --prompt "$ARGUMENTS" --json';
export const atmPromptScopedFirstCommand = 'node atm.mjs next --prompt "$ARGUMENTS" --json';
export const atmIntentScopedFirstCommand = 'node atm.mjs next --intent .atm/runtime/task-intent.json --json';
export const charterInvariantsPlaceholder = '{{CHARTER_INVARIANTS}}';
export { minimumAtmEntrySkillDefinitions, defaultSkillTemplateDirectory, parseSkillTemplate, loadSkillTemplates, loadMinimumAtmSkillTemplates } from './compiler/skill-templates.js';
export { renderCharterInvariantsBlock, compileSkillTemplatesForAdapter, compileSkillTemplate } from './compiler/compile.js';
export { installManifestSchemaVersion, sha256Bytes, sha256File, normalizeManifestPath, formatInstallManifest } from './manifest/schema.js';
export { createInstallManifest, createManifestFileRecord, createCodexSkillsAdapter, createStaticIntegrationAdapter } from './manifest/construct.js';
