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

export async function runPolymorphRollbackScenarios(ctx: PoliceFamilyContext, gate: any) {
  const { root, mode, fixture, check, readJson, readText, materializeCuratorInput, buildCoreFamilies, sharedCoreFamilies } = ctx;
  const { stubReport } = gate;
  const polymorphDriftFixture = readJson('fixtures/police-family/polymorph/positive-template-drift.json');
  const polymorphDriftFamily = runPolymorphPolice(polymorphDriftFixture.input);
  check(polymorphDriftFamily.sourceValidator === 'runPolymorphPolice', 'Polymorph Police must be a named scanner');
  check(
    polymorphDriftFamily.findings.some((finding) => finding.trigger === 'template-drift'),
    'Polymorph Police must produce template-drift finding for drifting instance'
  );
  check(
    polymorphDriftFamily.findings.every((finding) => (finding.metadata as any)?.directApplyAllowed === false),
    'Polymorph Police findings must mark directApplyAllowed=false'
  );

  const polymorphPropagationFamily = runPolymorphPolice(readJson('fixtures/police-family/polymorph/positive-instance-propagation-missing.json').input);
  check(
    polymorphPropagationFamily.findings.some((finding) => finding.trigger === 'instance-propagation-missing'),
    'Polymorph Police must produce instance-propagation-missing finding when instances lag template'
  );

  const polymorphVariantFamily = runPolymorphPolice(readJson('fixtures/police-family/polymorph/positive-variant-explosion.json').input);
  check(
    polymorphVariantFamily.findings.some((finding) => finding.trigger === 'variant-explosion'),
    'Polymorph Police must produce variant-explosion finding when threshold exceeded'
  );

  const polymorphCleanFamily = runPolymorphPolice(readJson('fixtures/police-family/polymorph/negative-same-group-dedup-ignored.json').input);
  check(polymorphCleanFamily.findings.length === 0, 'Polymorph Police must produce no finding when instances synchronized within threshold');

  const polymorphSuppressionKey = buildPolymorphSuppressionKey({
    templateId: 'ATM-POLY-0001',
    signalKind: 'template-drift',
    instanceId: 'ATM-INST-0001',
    templateVersion: '1.2.0'
  });
  const polymorphSuppressed = runPolymorphPolice({
    ...polymorphDriftFixture.input,
    suppressedKeys: [polymorphSuppressionKey]
  });
  check(polymorphSuppressed.findings.filter((f) => f.trigger === 'template-drift').length === 0, 'Polymorph Police must honor suppressionKeys');

  // ── Rollback Police (APF-0043 / 0044) ──────────────────────────────────────

  const rollbackProofFamily = runRollbackPolice(readJson('fixtures/police-family/rollback/positive-rollback-proof-present.json').input);
  check(rollbackProofFamily.sourceValidator === 'runRollbackPolice', 'Rollback Police must be a named scanner');
  check(rollbackProofFamily.findings.length === 0, 'Rollback Police must produce no finding when rollback proof present');

  const rollbackIrreversibleFamily = runRollbackPolice(readJson('fixtures/police-family/rollback/negative-irreversible-proposal.json').input);
  check(
    rollbackIrreversibleFamily.findings.some((f) => f.trigger === 'irreversible-proposal' && f.severity === 'block'),
    'Rollback Police must block irreversible proposal'
  );
  check(rollbackIrreversibleFamily.status === 'fail', 'Rollback Police status must fail when blocker present');

  const rollbackEquivalenceFamily = runRollbackPolice(readJson('fixtures/police-family/rollback/negative-map-equivalence-missing.json').input);
  check(
    rollbackEquivalenceFamily.findings.some((f) => f.trigger === 'equivalence-proof-missing'),
    'Rollback Police must report equivalence-proof-missing for map-replacement'
  );

  const rollbackScopeDriftFamily = runRollbackPolice(readJson('fixtures/police-family/rollback/negative-rollback-scope-drift.json').input);
  check(
    rollbackScopeDriftFamily.findings.some((f) => f.trigger === 'rollback-scope-drift'),
    'Rollback Police must report rollback-scope-drift when touched surfaces escape declared scope'
  );

  const rollbackSuppressionKey = buildRollbackSuppressionKey({
    proposalId: 'proposal.atomize.unsafe.001',
    signalKind: 'irreversible-proposal',
    baseVersion: '0.5.0'
  });
  const rollbackSuppressed = runRollbackPolice({
    ...readJson('fixtures/police-family/rollback/negative-irreversible-proposal.json').input,
    suppressedKeys: [rollbackSuppressionKey]
  });
  check(
    rollbackSuppressed.findings.every((f) => f.trigger !== 'irreversible-proposal'),
    'Rollback Police must honor suppressionKeys'
  );

  // ── Evidence Integrity Gate (APF-0045) ─────────────────────────────────────

  const evidenceCleanGate = runEvidenceIntegrityGate(readJson('fixtures/police-family/shared-gates/positive-evidence-integrity-clean.json').input);
  check(evidenceCleanGate.gate === 'evidence-integrity', 'Evidence Integrity Gate name must be evidence-integrity');
  check(evidenceCleanGate.status === 'pass', 'Evidence Integrity Gate must pass for clean fixture');

  const evidenceMissingGate = runEvidenceIntegrityGate(readJson('fixtures/police-family/shared-gates/negative-evidence-missing.json').input);
  check(
    evidenceMissingGate.findings.some((f) => f.trigger === 'evidence-missing'),
    'Evidence Integrity Gate must report evidence-missing'
  );

  const evidenceStaleGate = runEvidenceIntegrityGate(readJson('fixtures/police-family/shared-gates/negative-evidence-stale.json').input);
  check(
    evidenceStaleGate.findings.some((f) => f.trigger === 'evidence-stale'),
    'Evidence Integrity Gate must report evidence-stale'
  );

  const evidenceDuplicateGate = runEvidenceIntegrityGate(readJson('fixtures/police-family/shared-gates/negative-evidence-duplicate.json').input);
  check(
    evidenceDuplicateGate.findings.some((f) => f.trigger === 'evidence-duplicate'),
    'Evidence Integrity Gate must report evidence-duplicate'
  );

  // ── Reversibility Gate (APF-0046) ──────────────────────────────────────────

  const reversibilityCleanGate = runReversibilityGate({ proposals: readJson('fixtures/police-family/rollback/positive-rollback-proof-present.json').input.proposals });
  check(reversibilityCleanGate.gate === 'reversibility', 'Reversibility Gate name must be reversibility');
  check(reversibilityCleanGate.status === 'pass', 'Reversibility Gate must pass when rollback proof present');

  const reversibilityBlockedGate = runReversibilityGate({ proposals: readJson('fixtures/police-family/rollback/negative-irreversible-proposal.json').input.proposals });
  check(reversibilityBlockedGate.status === 'fail', 'Reversibility Gate must fail for irreversible proposal');
  check((reversibilityBlockedGate.summary.blocked ?? 0) > 0, 'Reversibility Gate must record blocked count');

  // ── Noise Control Gate (APF-0047) ──────────────────────────────────────────

  const noiseSuppress = runNoiseControlGate(readJson('fixtures/police-family/shared-gates/positive-noise-control-suppression.json').input);
  check(noiseSuppress.gate === 'noise-control', 'Noise Control Gate name must be noise-control');
  check(noiseSuppress.findings.length === 0, 'Noise Control Gate must filter suppressed advisory finding');
  check((noiseSuppress.summary.suppressed ?? 0) === 1, 'Noise Control Gate must record suppressed count');

  const noiseBypass = runNoiseControlGate(readJson('fixtures/police-family/shared-gates/negative-noise-control-high-severity-bypass.json').input);
  check(noiseBypass.findings.length === 1, 'Noise Control Gate must admit high-severity finding bypassing suppression');
  check((noiseBypass.summary.bypassed ?? 0) === 1, 'Noise Control Gate must record bypassed count');

  // ── Contract Drift Check inside Registry Consistency (APF-0048) ────────────

  const driftFamily = runRegistryContractDriftCheck(readJson('fixtures/police-family/contract-drift/positive-spec-implementation-drift.json').input);
  check(driftFamily.family === 'registry-consistency', 'Contract Drift output must be carried by registry-consistency family');
  check(
    driftFamily.findings.some((f) => f.trigger === 'spec-implementation-drift'),
    'Contract Drift Check must report spec-implementation-drift'
  );
  check(driftFamily.status === 'fail', 'Contract Drift Check must fail registry-consistency when drift detected');
  check(driftFamily.mode === 'blocker', 'Contract Drift Check must produce blocker-mode family report');

  const driftClean = runRegistryContractDriftCheck(readJson('fixtures/police-family/contract-drift/negative-matching-hashes.json').input);
  check(driftClean.findings.length === 0, 'Contract Drift Check must produce no finding when hashes match');

  // ── Bridges to ReviewAdvisory for new families ─────────────────────────────

  const polymorphMachineFinding = toReviewAdvisoryMachineFinding(polymorphDriftFamily.findings[0]);
  const polymorphBridged = appendMachineFindings(stubReport, [polymorphMachineFinding]);
  const polymorphBridgedFinding = polymorphBridged.findings.find((finding: any) => finding.id === polymorphMachineFinding.id);
  check((polymorphBridgedFinding?.metadata?.policeFinding as any)?.policeFamily === 'polymorph', 'ReviewAdvisory must preserve polymorph policeFinding');

  const rollbackMachineFinding = toReviewAdvisoryMachineFinding(rollbackIrreversibleFamily.findings[0]);
  const rollbackBridged = appendMachineFindings(stubReport, [rollbackMachineFinding]);
  const rollbackBridgedFinding = rollbackBridged.findings.find((finding: any) => finding.id === rollbackMachineFinding.id);
  check((rollbackBridgedFinding?.metadata?.policeFinding as any)?.policeFamily === 'rollback', 'ReviewAdvisory must preserve rollback policeFinding');
  check(rollbackBridgedFinding?.action === 'request-human-review', 'Rollback blocker must route to request-human-review (not auto-approve)');
}
