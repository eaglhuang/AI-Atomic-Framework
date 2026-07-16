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

export async function runDecompositionEvolutionScenarios(ctx: PoliceFamilyContext, gate: any) {
  const { root, mode, fixture, check, readJson, readText, materializeCuratorInput, buildCoreFamilies, sharedCoreFamilies } = ctx;
  const { stubReport } = gate;
  const decompPositiveFixture = readJson('fixtures/police-family/decomposition/positive-oversized.json');
  const decompPositiveInventory = buildSourceInventoryReport({
    maxFileLines: 1000,
    entries: decompPositiveFixture.input.inventory.entries
  });
  const decompPositiveFamily = runDecompositionPolice({ inventory: decompPositiveInventory });
  check(decompPositiveFamily.sourceValidator === 'runDecompositionPolice', 'Decomposition Police must be a named scanner');
  check(decompPositiveFamily.findings.length === 1, 'Decomposition Police must produce 1 finding for oversized fixture');
  check(decompPositiveFamily.findings[0].trigger === 'oversized-source-surface', 'Decomposition Police trigger must be oversized-source-surface');
  check(decompPositiveFamily.findings[0].severity === 'advisory', 'Decomposition Police finding severity must be advisory');
  check(decompPositiveFamily.findings[0].action === 'proposal-draft', 'Decomposition Police action must be proposal-draft');
  check(decompPositiveFamily.findings[0].routeHint === 'behavior.atomize', 'Decomposition Police primary route must be behavior.atomize');
  const decompMetadata = decompPositiveFamily.findings[0].metadata as any;
  check(decompMetadata.directApplyAllowed === false, 'Decomposition Police must not auto-apply');
  check(Array.isArray(decompMetadata.suggestedRoute) && decompMetadata.suggestedRoute.includes('behavior.compose'), 'Decomposition Police must suggest behavior.compose as secondary route');
  check(decompMetadata.suggestedMapReplacement === true, 'Decomposition Police must hint suggestedMapReplacement=true');
  check(decompMetadata.decompositionPlanHint?.legacyUris?.length > 0, 'decompositionPlanHint.legacyUris must be populated');

  const decompBelow = runDecompositionPolice({
    inventory: buildSourceInventoryReport({
      maxFileLines: 1000,
      entries: readJson('fixtures/police-family/decomposition/negative-below-threshold.json').input.inventory.entries
    })
  });
  check(decompBelow.findings.length === 0, 'Decomposition Police must produce no finding below threshold');

  const decompIgnored = runDecompositionPolice({
    inventory: buildSourceInventoryReport({
      maxFileLines: 1000,
      entries: readJson('fixtures/police-family/decomposition/negative-ignored-path.json').input.inventory.entries
    })
  });
  check(decompIgnored.findings.length === 0, 'Decomposition Police must skip entries with ignoredReason');

  const decompReplaced = runDecompositionPolice({
    inventory: buildSourceInventoryReport({
      maxFileLines: 1000,
      entries: readJson('fixtures/police-family/decomposition/negative-existing-replacement-map.json').input.inventory.entries
    })
  });
  check(decompReplaced.findings.length === 0, 'Decomposition Police must skip entries with hasActiveReplacementMap');

  const decompPlanDraft = buildDecompositionPlanHintDraft(decompPositiveFamily.findings[0]);
  check(decompPlanDraft.ok === true, 'buildDecompositionPlanHintDraft must succeed for positive finding');
  check(decompPlanDraft.draft?.mode === 'draft', 'decomposition plan draft mode must be draft');
  check((decompPlanDraft.draft?.legacyUris?.length ?? 0) > 0, 'decomposition plan draft must have legacyUris');
  check((decompPlanDraft.draft?.entrypoints?.length ?? 0) > 0, 'decomposition plan draft must have entrypoints');

  const draftMissingLegacy = buildDecompositionPlanHintDraft({
    ...decompPositiveFamily.findings[0],
    metadata: { ...decompMetadata, decompositionPlanHint: { entrypoints: ['x'] } }
  });
  check(draftMissingLegacy.ok === false, 'plan draft must fail when legacyUris missing');
  check(draftMissingLegacy.errors.includes('missing-replacement-legacyUris'), 'plan draft must report missing-replacement-legacyUris');

  const draftMissingEntry = buildDecompositionPlanHintDraft({
    ...decompPositiveFamily.findings[0],
    metadata: { ...decompMetadata, decompositionPlanHint: { legacyUris: ['x'] } }
  });
  check(draftMissingEntry.ok === false, 'plan draft must fail when entrypoints missing');
  check(draftMissingEntry.errors.includes('missing-entrypoints'), 'plan draft must report missing-entrypoints');

  const decompCapped = runDecompositionPolice({
    inventory: buildSourceInventoryReport({
      maxFileLines: 500,
      entries: [
        { filePath: 'src/over-a.ts', lineCount: 1200 },
        { filePath: 'src/over-b.ts', lineCount: 1100 },
        { filePath: 'src/over-c.ts', lineCount: 900 }
      ]
    }),
    dailyCap: 2
  });
  check(
    decompCapped.findings.filter((f) => f.trigger === 'oversized-source-surface' && f.severity === 'advisory').length === 2,
    'Decomposition Police must emit exactly dailyCap advisory findings'
  );
  check(
    decompCapped.findings.some((f) => f.routeHint === 'observation.daily-cap'),
    'Decomposition Police must produce observation finding when daily cap is reached'
  );

  // ── Evolution Police (APF-0034 / 0035 / 0036 / 0038) ───────────────────────

  const evoPositiveFixture = readJson('fixtures/police-family/evolution/positive-recurring-regression.json');
  const evoPositiveFamily = runEvolutionPolice({ evidencePatterns: evoPositiveFixture.input.evidencePatterns });
  check(evoPositiveFamily.sourceValidator === 'runEvolutionPolice', 'Evolution Police must be a named scanner');
  check(evoPositiveFamily.findings.length === 1, 'Evolution Police must produce 1 finding for recurring regression');
  check(evoPositiveFamily.findings[0].trigger === 'evidence-evolution-signal', 'Evolution Police trigger must be evidence-evolution-signal');
  check(evoPositiveFamily.findings[0].severity === 'advisory', 'Evolution Police finding severity must be advisory');
  check(evoPositiveFamily.findings[0].action === 'proposal-draft', 'Evolution Police action must be proposal-draft');
  check(evoPositiveFamily.findings[0].routeHint === 'behavior.evolve', 'Evolution Police route must be behavior.evolve for atom-level signal');
  const evoMetadata = evoPositiveFamily.findings[0].metadata as any;
  check(evoMetadata.directApplyAllowed === false, 'Evolution Police must not auto-apply');
  check(evoMetadata.suppressionKey?.includes('::evolution'), 'Evolution suppressionKey must include scanner family suffix');

  const evoUsageOnly = runEvolutionPolice({
    evidencePatterns: readJson('fixtures/police-family/evolution/negative-usage-only.json').input.evidencePatterns
  });
  check(evoUsageOnly.findings.length === 0, 'Evolution Police must reject usage-only evidence');

  const evoHostLocal = runEvolutionPolice({
    evidencePatterns: readJson('fixtures/police-family/evolution/negative-host-local.json').input.evidencePatterns
  });
  check(evoHostLocal.findings.length === 0, 'Evolution Police must suppress host-local preferences from global atom contract');

  const evoStaleBase = runEvolutionPolice({
    evidencePatterns: readJson('fixtures/police-family/evolution/negative-stale-base.json').input.evidencePatterns
  });
  check(evoStaleBase.findings.length === 1, 'Evolution Police must produce stale-evolution-draft finding');
  check(evoStaleBase.findings[0].trigger === 'stale-evolution-draft', 'stale-base finding must use stale-evolution-draft trigger');
  check(evoStaleBase.findings[0].severity === 'warning', 'stale-base finding must be warning severity');
  check(evoStaleBase.findings[0].action === 'request-human-review', 'stale-base must request human review');

  const evoSuppressed = runEvolutionPolice({
    evidencePatterns: evoPositiveFixture.input.evidencePatterns,
    suppressedKeys: [buildEvolutionSuppressionKey(evoPositiveFixture.input.evidencePatterns[0])]
  });
  check(evoSuppressed.findings.length === 0, 'Evolution Police must suppress matching suppression key');

  const evoBelowConfidence = runEvolutionPolice({
    evidencePatterns: [{
      ...evoPositiveFixture.input.evidencePatterns[0],
      confidence: 0.3
    }]
  });
  check(evoBelowConfidence.findings.length === 0, 'Evolution Police must reject below-confidence-threshold patterns');

  const evoBelowRecurrence = runEvolutionPolice({
    evidencePatterns: [{
      ...evoPositiveFixture.input.evidencePatterns[0],
      recurrence: 1
    }]
  });
  check(evoBelowRecurrence.findings.length === 0, 'Evolution Police must reject below-recurrence-threshold patterns');

  // Decomposition + Evolution families must reach ReviewAdvisory via machine-finding
  const decompMachineFinding = toReviewAdvisoryMachineFinding(decompPositiveFamily.findings[0]);
  const decompBridged = appendMachineFindings(stubReport, [decompMachineFinding]);
  const decompBridgedFinding = decompBridged.findings.find((finding: any) => finding.id === decompMachineFinding.id);
  check(decompBridgedFinding?.trigger === 'machine-finding', 'Decomposition finding must enter ReviewAdvisory as machine-finding');
  check((decompBridgedFinding?.metadata?.policeFinding as any)?.policeFamily === 'decomposition', 'ReviewAdvisory must preserve decomposition policeFinding');
  check(decompBridgedFinding?.action !== 'none', 'Decomposition advisory cannot auto-approve');

  const evoMachineFinding = toReviewAdvisoryMachineFinding(evoPositiveFamily.findings[0]);
  const evoBridged = appendMachineFindings(stubReport, [evoMachineFinding]);
  const evoBridgedFinding = evoBridged.findings.find((finding: any) => finding.id === evoMachineFinding.id);
  check(evoBridgedFinding?.trigger === 'machine-finding', 'Evolution finding must enter ReviewAdvisory as machine-finding');
  check((evoBridgedFinding?.metadata?.policeFinding as any)?.policeFamily === 'evolution', 'ReviewAdvisory must preserve evolution policeFinding');
  check(evoBridgedFinding?.action !== 'none', 'Evolution advisory cannot auto-approve');
}
