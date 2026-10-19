export declare const pluginRuleGuardPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-rule-guard";
    readonly packageRole: "deterministic-rule-guards";
    readonly packageVersion: "0.0.0";
};
export { defaultNeutralityPolicyRelativePath, formatGitHubAnnotations, loadNeutralityPolicy, scanNeutralityRepository, scanNeutralityText } from './neutrality-scanner.js';
export { LIFECYCLE_POLICE_WRITER, buildCallerMigrationNotices, canWriteQuarantine, lifecyclePolicePlugin, runLifecyclePolice } from './lifecycle-police.js';
export type { LifecyclePoliceInputEntry, LifecyclePoliceRunOptions, LifecyclePoliceTransitionCheck } from './lifecycle-police.js';
export { checkGuardJustification } from './rule-justification.js';
export type { GuardJustificationInput, GuardJustificationResult, GuardViolation, RequiredJustification } from './rule-justification.js';
