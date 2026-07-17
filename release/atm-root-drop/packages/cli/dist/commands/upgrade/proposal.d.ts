/**
 * upgrade/proposal.ts
 *
 * TASK-ASR-0014 upgrade.ts complete split
 * TASK-RFT-0095 bounded facade
 *
 * Upgrade proposal flow: option parsing, guided legacy dry-run proposals,
 * input document discovery, and context budget evaluation.
 */
export type { ParsedUpgradeCommandOptions } from './proposal/types.ts';
export { parseUpgradeOptions } from './proposal/parse.ts';
export { discoverInputDocuments, inferInputKind, loadExplicitInputDocuments } from './proposal/inputs.ts';
export { isGuidedLegacyDryRun, runGuidedLegacyDryRunProposal } from './proposal/guided-legacy.ts';
export { evaluateUpgradeContextBudget } from './proposal/context-budget.ts';
