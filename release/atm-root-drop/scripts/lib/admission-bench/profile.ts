import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  loadAllAgrBenchmarkScenarios,
  runAgrBenchmarkScenario
} from '../agr-benchmark-runner.ts';
import {
  evaluateConflictScenario,
  loadAllAgrConflictBenchmarkScenarios
} from '../agr-conflict-benchmark-runner.ts';
import {
  ABLATION_IDS,
  aggregateAblation,
  evaluateAblation
} from './ablation.ts';
import {
  ADVERSARIAL_FAULTS,
  evaluateAdversarial
} from './adversarial.ts';
import {
  buildForwardingSummary,
  enforcementBoundaryRows
} from './forwarding.ts';
import {
  aggregatePolicy,
  classifyFamily,
  evaluatePolicy,
  oracleVerdictFromScenario,
  POLICY_IDS
} from './policies.ts';
import { renderPaperTables, renderMainResults } from './report.ts';
import type {
  AblationAggregate,
  AblationId,
  AdversarialFaultId,
  AdversarialRow,
  NormalizedScenario,
  PaperProfileSummary,
  PolicyAggregate,
  PolicyId,
  PolicyRow,
  UnresolvedEntry
} from './types.ts';

export type PaperTrack = 'all' | 'policy' | 'ablation' | 'adversarial' | 'forwarding' | 'field' | 'report';

export interface PaperProfileOptions {
  readonly root: string;
  readonly seed: number;
  readonly track: PaperTrack;
  readonly outDir: string;
}

function git(cmd: string, root: string): string {
  return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function loadUnresolvedManifest(root: string): readonly UnresolvedEntry[] {
  const file = path.join(root, 'scripts/fixtures/atm-admission-bench/unresolved.json');
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: UnresolvedEntry[] };
  return parsed.entries ?? [];
}

function normalizeAgr(root: string): NormalizedScenario[] {
  const scenarios = loadAllAgrBenchmarkScenarios(root);
  const normalized: NormalizedScenario[] = [];
  for (const scenario of scenarios) {
    const result = runAgrBenchmarkScenario(scenario);
    for (const modeResult of result.modes) {
      const base: NormalizedScenario = {
        id: scenario.id,
        pack: 'agr-benchmark',
        family: classifyFamily('agr-benchmark', scenario.id),
        mode: modeResult.mode,
        groundTruth: { ...scenario.groundTruth },
        hasReliableOracle: Boolean(modeResult.matchedExpectation),
        oracleVerdict: 'admit-parallel',
        agrScenario: scenario,
        composeVerdict: modeResult.composeVerdict,
        brokerVerdict: modeResult.brokerVerdict
      };
      const withOracle: NormalizedScenario = { ...base, oracleVerdict: oracleVerdictFromScenario(base) };
      normalized.push(withOracle);
    }
  }
  return normalized;
}

function normalizeConflict(root: string): NormalizedScenario[] {
  const scenarios = loadAllAgrConflictBenchmarkScenarios(root);
  const normalized: NormalizedScenario[] = [];
  for (const scenario of scenarios) {
    const result = evaluateConflictScenario(scenario);
    const base: NormalizedScenario = {
      id: scenario.id,
      pack: 'agr-conflict-benchmark',
      family: classifyFamily('agr-conflict-benchmark', scenario.id),
      mode: 'conflict',
      groundTruth: { ...scenario.groundTruth },
      hasReliableOracle: Boolean(result.matchedExpectation),
      oracleVerdict: 'admit-parallel',
      conflictScenario: scenario,
      conflictVerdict: result.conflictVerdict
    };
    normalized.push({ ...base, oracleVerdict: oracleVerdictFromScenario(base) });
  }
  return normalized;
}

interface RunBuckets {
  readonly policyRows: readonly PolicyRow[];
  readonly policyAggregates: readonly PolicyAggregate[];
  readonly ablationRows: readonly ReturnType<typeof evaluateAblation>[];
  readonly ablationAggregates: readonly AblationAggregate[];
  readonly adversarialRows: readonly AdversarialRow[];
}

function shouldRunTrack(track: PaperTrack, name: 'policy' | 'ablation' | 'adversarial' | 'forwarding' | 'field'): boolean {
  if (track === 'all') return true;
  if (track === 'report') return name === 'policy';
  return track === name;
}

function runAllTracks(
  scenarios: readonly NormalizedScenario[],
  track: PaperTrack
): RunBuckets {
  const policyRows: PolicyRow[] = [];
  if (shouldRunTrack(track, 'policy')) {
    for (const scenario of scenarios) {
      for (const policy of POLICY_IDS) {
        policyRows.push(evaluatePolicy(scenario, policy));
      }
    }
  }
  const policyAggregates: PolicyAggregate[] = POLICY_IDS.map((policy) => aggregatePolicy(policyRows, policy));

  const baselineByScenario = new Map<string, PolicyRow>();
  for (const row of policyRows) {
    if (row.policy === 'atm-full') {
      baselineByScenario.set(`${row.pack}::${row.scenarioId}::${row.mode}`, row);
    }
  }

  const ablationRows: ReturnType<typeof evaluateAblation>[] = [];
  if (shouldRunTrack(track, 'ablation')) {
    for (const scenario of scenarios) {
      const key = `${scenario.pack}::${scenario.id}::${scenario.mode}`;
      let baseline = baselineByScenario.get(key);
      if (!baseline) {
        baseline = evaluatePolicy(scenario, 'atm-full');
      }
      for (const variant of ABLATION_IDS) {
        ablationRows.push(evaluateAblation(scenario, variant, baseline));
      }
    }
  }
  const ablationAggregates: AblationAggregate[] = ABLATION_IDS.map((variant) => aggregateAblation(ablationRows, variant));

  const adversarialRows: AdversarialRow[] = [];
  if (shouldRunTrack(track, 'adversarial')) {
    for (const scenario of scenarios) {
      for (const fault of ADVERSARIAL_FAULTS) {
        adversarialRows.push(evaluateAdversarial(scenario, fault));
      }
    }
  }

  return { policyRows, policyAggregates, ablationRows, ablationAggregates, adversarialRows };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not-applicable';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function policyCsv(rows: readonly PolicyRow[]): string {
  const header = ['policy', 'scenarioId', 'pack', 'family', 'mode', 'route', 'admitted', 'caughtPhase', 'falseSafe', 'overSerialized', 'intentPreserved', 'oracleVerdict', 'routeMatchedOracle'].join(',');
  const lines = rows.map((row) => [
    row.policy, row.scenarioId, row.pack, row.family, row.mode, row.route,
    row.admitted, row.caughtPhase, row.falseSafe, row.overSerialized,
    row.intentPreserved, row.oracleVerdict, row.routeMatchedOracle
  ].map(csvCell).join(','));
  return [header, ...lines].join('\n') + '\n';
}

function ablationCsv(rows: readonly ReturnType<typeof evaluateAblation>[]): string {
  const header = ['variant', 'scenarioId', 'pack', 'family', 'mode', 'baselineRoute', 'ablatedRoute', 'baselineFalseSafe', 'ablatedFalseSafe', 'baselineOverSerialized', 'ablatedOverSerialized', 'baselineE2ESuccess', 'ablatedE2ESuccess'].join(',');
  const lines = rows.map((row) => [
    row.variant, row.scenarioId, row.pack, row.family, row.mode,
    row.baselineRoute, row.ablatedRoute,
    row.baselineFalseSafe, row.ablatedFalseSafe,
    row.baselineOverSerialized, row.ablatedOverSerialized,
    row.baselineE2ESuccess, row.ablatedE2ESuccess
  ].map(csvCell).join(','));
  return [header, ...lines].join('\n') + '\n';
}

function enforcementCsv(rows: readonly ReturnType<typeof enforcementBoundaryRows>[number][]): string {
  const header = ['condition', 'admissionCaught', 'applyCaught', 'validatorCaught', 'silentMiss', 'total'].join(',');
  const lines = rows.map((row) => [
    row.condition, row.admissionCaught, row.applyCaught, row.validatorCaught, row.silentMiss, row.total
  ].map(csvCell).join(','));
  return [header, ...lines].join('\n') + '\n';
}

export function runPaperProfile(options: PaperProfileOptions): PaperProfileSummary {
  const agr = normalizeAgr(options.root);
  const conflict = normalizeConflict(options.root);
  const allScenarios = [...agr, ...conflict];
  const unresolvedManifest = loadUnresolvedManifest(options.root);
  const unresolvedKeys = new Set(unresolvedManifest.map((e) => `${e.pack}::${e.scenarioId}::${e.mode}`));
  const primaryScenarios = allScenarios.filter((s) => !unresolvedKeys.has(`${s.pack}::${s.id}::${s.mode}`));

  // Oracle completeness check: any scenario without a reliable oracle that isn't in unresolved is a failure.
  const unreliable: NormalizedScenario[] = [];
  for (const scenario of primaryScenarios) {
    if (!scenario.hasReliableOracle) unreliable.push(scenario);
  }
  if (unreliable.length > 0) {
    throw new Error(
      `oracle_completeness_failed: ${unreliable.length} scenarios lack a reliable oracle and are not listed in unresolved.json: ${unreliable.map((s) => `${s.pack}::${s.id}::${s.mode}`).join(', ')}`
    );
  }

  const buckets = runAllTracks(primaryScenarios, options.track);
  const enforcementAggregates = enforcementBoundaryRows(buckets.policyRows);
  const forwarding = buildForwardingSummary(buckets.policyRows, options.root);

  const generatorCommit = git('rev-parse HEAD', options.root);
  const generatedAt = git('show -s --format=%cI HEAD', options.root);
  const baseCommitStamp = path.join(options.root, 'artifacts/generated/atm-admission-bench/base-commit.txt');
  ensureDir(path.dirname(baseCommitStamp));
  let baseCommit: string;
  if (existsSync(baseCommitStamp)) {
    baseCommit = readFileSync(baseCommitStamp, 'utf8').trim();
  } else {
    baseCommit = generatorCommit;
    writeFileSync(baseCommitStamp, baseCommit + '\n', 'utf8');
  }

  const atmFullFalseSafe = buckets.policyRows.filter((row) => row.policy === 'atm-full' && row.falseSafe).length;

  const summary: PaperProfileSummary = {
    schemaId: 'atm.admissionBenchPaperSummary.v1',
    seed: options.seed,
    profile: 'paper',
    contractVersion: '0.2',
    track: options.track,
    scenarioCount: new Set(allScenarios.map((s) => `${s.pack}::${s.id}`)).size,
    modeComparisons: allScenarios.length,
    unresolvedCount: unresolvedManifest.length,
    policyRows: buckets.policyRows.length,
    ablationRows: buckets.ablationRows.length,
    adversarialRows: buckets.adversarialRows.length,
    enforcementRows: enforcementAggregates.length,
    policyAggregates: buckets.policyAggregates,
    ablationAggregates: buckets.ablationAggregates,
    enforcementAggregates,
    forwarding,
    atmFullFalseSafeCount: atmFullFalseSafe,
    primaryDenominator: primaryScenarios.length,
    unresolvedExcludedFromPrimary: true
  };

  ensureDir(options.outDir);
  const manifest = {
    schemaId: 'atm.admissionBenchGeneratorManifest.v1',
    contract: 'docs/bench/ATM-AdmissionBench-CONTRACT.md',
    contractVersion: '0.2',
    profile: 'paper',
    track: options.track,
    seed: options.seed,
    baseCommit,
    generatorCommit,
    generatedAt,
    commands: [
      'npm run typecheck',
      'npm run validate:agr-benchmark',
      'npm run validate:agr-conflict-benchmark',
      'npm run bench:admission:smoke -- --seed 20260625',
      'npm run bench:admission:paper -- --seed 20260625',
      'npm run bench:admission:report -- --seed 20260625',
      'git diff --check'
    ],
    knownLimitations: [
      'Frozen denominator: v0.1 corpus only (20 scenarios / 42 mode comparisons).',
      'direct, git-diff3, file-serial, file-occ, text-range are deterministic baseline models, not real external tool executions.',
      'p95 latency is not-measured (no timing source wired).',
      'Field forwarding evidence is not mixed into policy baseline; if no field-evidence path is present the field source is reported as not-applicable.',
      'Adversarial fault model perturbs scenario oracle/inputs deterministically; it does not generate new free-form scenarios.',
      'Ablation perturbs atm-full oracle for the affected family rather than rewiring ATM internals; main-affected-families captures route divergence.'
    ]
  };
  const runManifest = {
    schemaId: 'atm.admissionBenchRunManifest.v1',
    profile: 'paper',
    track: options.track,
    seed: options.seed,
    scenarioCount: summary.scenarioCount,
    modeComparisons: summary.modeComparisons,
    unresolvedCount: summary.unresolvedCount,
    primaryDenominator: summary.primaryDenominator,
    generatorCommit,
    generatedAt
  };
  writeFileSync(path.join(options.outDir, 'run-manifest.json'), JSON.stringify(runManifest, null, 2) + '\n', 'utf8');
  const resultLines: string[] = [];
  for (const row of buckets.policyRows) resultLines.push(JSON.stringify(row));
  for (const row of buckets.ablationRows) resultLines.push(JSON.stringify({ schemaId: 'atm.admissionBenchAblationRow.v1', ...row }));
  for (const row of buckets.adversarialRows) resultLines.push(JSON.stringify(row));
  writeFileSync(path.join(options.outDir, 'results.jsonl'), resultLines.join('\n') + '\n', 'utf8');
  writeFileSync(path.join(options.outDir, 'policy-comparison.csv'), policyCsv(buckets.policyRows), 'utf8');
  writeFileSync(path.join(options.outDir, 'ablation.csv'), ablationCsv(buckets.ablationRows), 'utf8');
  writeFileSync(path.join(options.outDir, 'enforcement-boundary.csv'), enforcementCsv(enforcementAggregates), 'utf8');
  writeFileSync(path.join(options.outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  writeFileSync(path.join(options.outDir, 'main-results.md'), renderMainResults(summary), 'utf8');
  writeFileSync(path.join(options.outDir, 'paper-tables.md'), renderPaperTables(summary), 'utf8');
  writeFileSync(path.join(options.outDir, 'unresolved-set.json'), JSON.stringify({
    schemaId: 'atm.admissionBenchUnresolvedSet.v1',
    contractVersion: '0.2',
    entries: unresolvedManifest,
    excludedFromPrimaryMetrics: true
  }, null, 2) + '\n', 'utf8');
  writeFileSync(path.join(options.outDir, 'generator-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return summary;
}
