import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  appendMachineFindings,
  buildDecompositionPlanHintDraft,
  buildEvolutionSuppressionKey,
  buildLegacyRoutePlan,
  buildMergedFamily,
  buildPoliceFamilyGateReport,
  buildPolymorphSuppressionKey,
  buildRollbackSuppressionKey,
  buildSourceInventoryReport,
  compareQualityMetrics,
  createLocalGitAdapter,
  curateAtomMapEvolution,
  createStubReviewAdvisoryReport,
  runAdopterNeutralityCheck,
  runAtomizationPolice,
  runDedupPolice,
  runDemandPolice,
  runDecompositionPolice,
  runEvidenceIntegrityGate,
  runEvolutionPolice,
  runMapIntegrationPolice,
  runNoiseControlGate,
  runPoliceFamilyGate,
  runPolymorphPolice,
  runQualityPolice,
  runRegistryContractDriftCheck,
  runReversibilityGate,
  runRollbackPolice,
  toReviewAdvisoryMachineFinding,
  verifyAdvisoryOnlyHardening,
  VALIDATOR_PROFILE_NAMING_CONTRACT,
  type PoliceFinding
} from './deps.ts';
import type { PoliceFamilyContext } from './context.ts';

export async function runFinalContractScenarios(ctx: PoliceFamilyContext, gate: any) {
  const { root, mode, fixture, check, readJson, readText, materializeCuratorInput, buildCoreFamilies, sharedCoreFamilies } = ctx;
  const { positiveGateReport, blockerFamilies, advisoryFamilies } = gate;
  const newFamilyFixtures = [
    'fixtures/police-family/decomposition/positive-oversized.json',
    'fixtures/police-family/decomposition/negative-below-threshold.json',
    'fixtures/police-family/decomposition/negative-ignored-path.json',
    'fixtures/police-family/decomposition/negative-existing-replacement-map.json',
    'fixtures/police-family/evolution/positive-recurring-regression.json',
    'fixtures/police-family/evolution/negative-usage-only.json',
    'fixtures/police-family/evolution/negative-host-local.json',
    'fixtures/police-family/evolution/negative-stale-base.json',
    'fixtures/police-family/polymorph/positive-template-drift.json',
    'fixtures/police-family/polymorph/positive-instance-propagation-missing.json',
    'fixtures/police-family/polymorph/positive-variant-explosion.json',
    'fixtures/police-family/polymorph/negative-same-group-dedup-ignored.json',
    'fixtures/police-family/rollback/positive-rollback-proof-present.json',
    'fixtures/police-family/rollback/negative-irreversible-proposal.json',
    'fixtures/police-family/rollback/negative-map-equivalence-missing.json',
    'fixtures/police-family/rollback/negative-rollback-scope-drift.json',
    'fixtures/police-family/shared-gates/positive-evidence-integrity-clean.json',
    'fixtures/police-family/shared-gates/negative-evidence-missing.json',
    'fixtures/police-family/shared-gates/negative-evidence-stale.json',
    'fixtures/police-family/shared-gates/negative-evidence-duplicate.json',
    'fixtures/police-family/shared-gates/positive-noise-control-suppression.json',
    'fixtures/police-family/shared-gates/negative-noise-control-high-severity-bypass.json',
    'fixtures/police-family/contract-drift/positive-spec-implementation-drift.json',
    'fixtures/police-family/contract-drift/negative-matching-hashes.json',
    'packages/core/src/source-inventory/source-inventory.ts'
  ];
  for (const relativePath of newFamilyFixtures) {
    check(existsSync(path.join(root, relativePath)), `required new-family file missing: ${relativePath}`);
  }

  // ── Adopter Neutrality Check (APF-0052) ────────────────────────────────────

  const adopterCleanFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/positive-clean-protected-surface.json').input);
  check(adopterCleanFamily.family === 'registry-consistency', 'Adopter Neutrality Check must be carried by registry-consistency family');
  check(adopterCleanFamily.findings.length === 0, 'Adopter Neutrality clean fixture must produce no finding');
  check(adopterCleanFamily.sourceValidator === 'runAdopterNeutralityCheck', 'Adopter Neutrality must use named source validator');

  const adopterProjectFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/negative-adopter-project-name.json').input);
  check(adopterProjectFamily.findings.some((f) => f.trigger === 'adopter-neutrality-violation'), 'Adopter Neutrality must report adopter-neutrality-violation');
  check(adopterProjectFamily.findings.some((f) => (f.metadata as any)?.matchedTermClass === 'adopter-project-name'), 'finding metadata must include matchedTermClass');
  check(adopterProjectFamily.status === 'fail', 'Adopter Neutrality full profile must fail when banned term found');
  check(adopterProjectFamily.findings.every((f) => f.severity === 'block'), 'Adopter Neutrality under full profile must use severity=block');

  const adopterEngineFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/negative-adopter-engine-name.json').input);
  check(adopterEngineFamily.findings.some((f) => (f.metadata as any)?.matchedTermClass === 'adopter-engine-name'), 'engine-name fixture must produce matchedTermClass=adopter-engine-name');

  const adopterPathFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/negative-absolute-private-path.json').input);
  check(adopterPathFamily.findings.some((f) => (f.metadata as any)?.matchedTermClass === 'adopter-private-path'), 'private-path fixture must produce matchedTermClass=adopter-private-path');
  check(adopterPathFamily.findings.every((f) => f.severity === 'advisory'), 'standard profile must demote severity to advisory');
  check(adopterPathFamily.status === 'pass', 'standard profile must not fail status when advisory-only');

  const adopterAssetFamily = runAdopterNeutralityCheck(readJson('fixtures/police-family/adopter-neutrality/negative-host-only-asset-path.json').input);
  check(adopterAssetFamily.findings.some((f) => (f.metadata as any)?.matchedTermClass === 'adopter-host-only-asset'), 'host-only-asset fixture must produce matchedTermClass=adopter-host-only-asset');

  const adopterAllowlistFamily = runAdopterNeutralityCheck({
    ...readJson('fixtures/police-family/adopter-neutrality/negative-adopter-project-name.json').input,
    allowlist: ['docs/protected-readme.md']
  });
  check(adopterAllowlistFamily.findings.length === 0, 'allowlist must exempt files from adopter-neutrality check');

  const adopterMetadataFields = ['filePath', 'matchedTermClass', 'scope', 'suggestedAction', 'profile'];
  for (const field of adopterMetadataFields) {
    check(field in (adopterProjectFamily.findings[0].metadata as any), `Adopter Neutrality finding metadata must include ${field}`);
  }

  // ── Advisory-Only Hardening (APF-0053) ─────────────────────────────────────

  const positiveAdvisoryHardening = verifyAdvisoryOnlyHardening({ probes: [] });
  check(positiveAdvisoryHardening.schemaId === 'atm.advisoryOnlyHardeningReport', 'hardening report must use atm.advisoryOnlyHardeningReport schemaId');
  check(positiveAdvisoryHardening.ok === true, 'hardening report with empty probes must be ok');

  const mutationDenialFixture = readJson('fixtures/police-family/advisory-hardening/negative-advisory-mutation-denial.json');
  const mutationDenial = verifyAdvisoryOnlyHardening(mutationDenialFixture.input);
  check(mutationDenial.results.length === 1, 'mutation denial fixture must produce one result');
  check(mutationDenial.results[0].rejected === true, 'mutation attempt must be rejected');
  check(mutationDenial.results[0].attemptedAction === 'registry-mutation', 'mutation denial result must record attemptedAction');
  check(mutationDenial.results[0].reason.includes('cannot directly mutate registry'), 'mutation denial reason must explain rejection');

  const autoApprovalFixture = readJson('fixtures/police-family/advisory-hardening/negative-advisory-auto-approval-denial.json');
  const autoApprovalDenial = verifyAdvisoryOnlyHardening(autoApprovalFixture.input);
  check(autoApprovalDenial.results[0].rejected === true, 'auto-approve attempt must be rejected');
  check(autoApprovalDenial.results[0].attemptedAction === 'auto-approve', 'auto-approve denial result must record attemptedAction');
  check(autoApprovalDenial.results[0].reason.includes('cannot produce approved HumanReviewDecision'), 'auto-approve denial reason must explain rejection');

  const positiveAdvisoryFixture = readJson('fixtures/police-family/advisory-hardening/positive-advisory-report-only.json');
  check(positiveAdvisoryFixture.advisoryFinding.directApplyAllowed === false, 'positive advisory fixture must mark directApplyAllowed=false');
  check(positiveAdvisoryFixture.advisoryFinding.action === 'needs-review', 'positive advisory fixture action must be report-only (needs-review)');

  const combinedHardening = verifyAdvisoryOnlyHardening({
    probes: [
      ...mutationDenialFixture.input.probes,
      ...autoApprovalFixture.input.probes
    ]
  });
  check(combinedHardening.results.every((r) => r.rejected === true), 'all hardening probes must be rejected');
  check(combinedHardening.ok === true, 'combined hardening report must be ok when all probes rejected');

  // Verify advisory-mode families across the gate report did not attempt mutation/auto-approve
  for (const advisoryFamily of advisoryFamilies) {
    for (const finding of advisoryFamily.findings) {
      check(finding.action !== 'quarantine', `advisory family ${advisoryFamily.family} must not produce quarantine actions`);
      check((finding.metadata as any)?.directApplyAllowed !== true, `advisory family ${advisoryFamily.family} findings must not declare directApplyAllowed=true`);
    }
  }

  // ── Validator Profile Naming Contract (APF-0053) ───────────────────────────

  check(VALIDATOR_PROFILE_NAMING_CONTRACT.schemaId === 'atm.validatorProfileNamingContract', 'naming contract schemaId must be atm.validatorProfileNamingContract');
  const profileNames = VALIDATOR_PROFILE_NAMING_CONTRACT.profiles.map((p) => p.profile);
  for (const expected of ['validate:police', 'validate:police-family', 'validate:standard', 'validate:full'] as const) {
    check(profileNames.includes(expected), `naming contract must include ${expected}`);
  }
  const familyEntry = VALIDATOR_PROFILE_NAMING_CONTRACT.profiles.find((p) => p.profile === 'validate:police-family');
  check(familyEntry?.role.includes('PoliceFamilyGateReport'), 'validate:police-family contract role must mention PoliceFamilyGateReport');
  const standardEntry = VALIDATOR_PROFILE_NAMING_CONTRACT.profiles.find((p) => p.profile === 'validate:standard');
  check(standardEntry?.relatesTo.includes('validate:police-family'), 'validate:standard must relate to validate:police-family');
  const fullEntry = VALIDATOR_PROFILE_NAMING_CONTRACT.profiles.find((p) => p.profile === 'validate:full');
  check(fullEntry?.relatesTo.includes('validate:police'), 'validate:full must retain relation to legacy validate:police');
}
