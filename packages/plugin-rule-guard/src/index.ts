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
} from './neutrality-scanner.mjs';

export {
  LIFECYCLE_POLICE_WRITER,
  buildCallerMigrationNotices,
  canWriteQuarantine,
  lifecyclePolicePlugin,
  runLifecyclePolice
} from './lifecycle-police';
export type {
  LifecyclePoliceInputEntry,
  LifecyclePoliceRunOptions,
  LifecyclePoliceTransitionCheck
} from './lifecycle-police';
