export { runPoliceChecks } from '../../packages/core/src/police/index.ts';
export {
  buildCorePoliceFamilies,
  buildDecompositionPlanHintDraft,
  buildEvolutionSuppressionKey,
  buildPoliceFamilyGateReport,
  buildPolymorphSuppressionKey,
  buildRollbackSuppressionKey,
  runAtomizationPolice,
  runDecompositionPolice,
  runDedupPolice,
  runDemandPolice,
  runEvidenceIntegrityGate,
  runEvolutionPolice,
  runMapIntegrationPolice,
  runNoiseControlGate,
  runPoliceFamilyGate,
  runPolymorphPolice,
  runQualityPolice,
  runAdopterNeutralityCheck,
  runRegistryContractDriftCheck,
  runReversibilityGate,
  runRollbackPolice,
  toReviewAdvisoryMachineFinding,
  verifyAdvisoryOnlyHardening,
  VALIDATOR_PROFILE_NAMING_CONTRACT,
  type PoliceFamilyReport,
  type PoliceFinding
} from '../../packages/core/src/police/family.ts';
export { buildSourceInventoryReport } from '../../packages/core/src/source-inventory/source-inventory.ts';
export { buildLegacyRoutePlan } from '../../packages/core/src/guidance/legacy-route-plan.ts';
export { compareQualityMetrics } from '../../packages/core/src/police/regression-compare.ts';
export { curateAtomMapEvolution } from '../../packages/core/src/upgrade/map-curator.ts';
export { createLocalGitAdapter } from '../../packages/adapter-local-git/src/local-git-adapter.ts';
export { runLifecyclePolice } from '../../packages/plugin-rule-guard/src/lifecycle-police.ts';
export { appendMachineFindings, createStubReviewAdvisoryReport } from '../../packages/plugin-review-advisory/src/index.ts';

export function buildMergedFamily(
  family: import('../../packages/core/src/police/family.ts').PoliceFamilyReport['family'],
  mode: import('../../packages/core/src/police/family.ts').PoliceFamilyReport['mode'],
  reports: readonly import('../../packages/core/src/police/family.ts').PoliceFamilyReport[]
): import('../../packages/core/src/police/family.ts').PoliceFamilyReport {
  return {
    family,
    mode,
    status: reports.some((report) => report.status === 'fail') ? 'fail' : 'pass',
    findings: reports.flatMap((report) => [...report.findings]),
    advisoryOnly: mode === 'advisory',
    sourceValidator: reports[0]?.sourceValidator ?? `run-${family}-police`
  };
}
