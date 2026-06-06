export const pluginRuleGuardPackage = {
  packageName: '@ai-atomic-framework/plugin-rule-guard',
  packageRole: 'deterministic-rule-guards',
  packageVersion: '0.0.0'
} as const;

export {
  defaultNeutralityPolicyRelativePath,
  formatGitHubAnnotations,
  loadNeutralityPolicy,
  scanNeutralityRepository,
  scanNeutralityText
} from './neutrality-scanner.ts';

export {
  LIFECYCLE_POLICE_WRITER,
  buildCallerMigrationNotices,
  canWriteQuarantine,
  lifecyclePolicePlugin,
  runLifecyclePolice
} from './lifecycle-police.ts';
export type {
  LifecyclePoliceInputEntry,
  LifecyclePoliceRunOptions,
  LifecyclePoliceTransitionCheck
} from './lifecycle-police.ts';

export {
  checkGuardJustification
} from './rule-justification.ts';
export type {
  GuardJustificationInput,
  GuardJustificationResult,
  GuardViolation,
  RequiredJustification
} from './rule-justification.ts';
