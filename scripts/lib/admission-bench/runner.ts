import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  loadAllAgrBenchmarkScenarios,
  runAgrBenchmarkScenario,
  type AgrBenchmarkScenario,
  type AgrBenchmarkScenarioResult
} from '../agr-benchmark-runner.ts';
import {
  evaluateConflictScenario,
  loadAllAgrConflictBenchmarkScenarios,
  type AgrConflictScenario,
  type AgrConflictScenarioResult
} from '../agr-conflict-benchmark-runner.ts';

export interface AdmissionBenchOptions {
  readonly root: string;
  readonly seed: number;
  readonly mode: 'smoke' | 'export-blind';
  readonly outDir: string;
}

export interface AdmissionBenchResultRow {
  readonly scenarioId: string;
  readonly pack: 'agr-benchmark' | 'agr-conflict-benchmark';
  readonly mode: string;
  readonly composeVerdict: string | null;
  readonly brokerVerdict: string | null;
  readonly conflictVerdict: string | null;
  readonly validatorOutcome: 'pass' | 'fail';
  readonly groundTruth: { readonly safeToParallelize: boolean; readonly validatorShouldCatch: boolean };
  readonly expected: Record<string, unknown>;
  readonly matchedExpectation: boolean;
  readonly falseSafeRegression: boolean;
}

export interface AdmissionBenchSummary {
  readonly schemaId: 'atm.admissionBenchSummary.v1';
  readonly seed: number;
  readonly scenarioCount: number;
  readonly modeComparisons: number;
  readonly matched: number;
  readonly expectationFailures: number;
  readonly falseSafeRegressions: number;
  readonly unsafeCaughtRate: number;
  readonly shipSafe: boolean;
  readonly packs: Record<string, { scenarios: number; comparisons: number }>;
}

function git(cmd: string, root: string): string {
  return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
}

function evaluateAgr(scenarios: readonly AgrBenchmarkScenario[]): AdmissionBenchResultRow[] {
  const rows: AdmissionBenchResultRow[] = [];
  for (const scenario of scenarios) {
    const result: AgrBenchmarkScenarioResult = runAgrBenchmarkScenario(scenario);
    for (const modeResult of result.modes) {
      const expectation = scenario.expected[modeResult.mode];
      rows.push({
        scenarioId: scenario.id,
        pack: 'agr-benchmark',
        mode: modeResult.mode,
        composeVerdict: modeResult.composeVerdict ?? null,
        brokerVerdict: modeResult.brokerVerdict ?? null,
        conflictVerdict: null,
        validatorOutcome: modeResult.validatorOutcome,
        groundTruth: { ...scenario.groundTruth },
        expected: { ...expectation },
        matchedExpectation: modeResult.matchedExpectation,
        falseSafeRegression: modeResult.falseSafeRegression
      });
    }
  }
  return rows;
}

function evaluateConflict(scenarios: readonly AgrConflictScenario[]): AdmissionBenchResultRow[] {
  const rows: AdmissionBenchResultRow[] = [];
  for (const scenario of scenarios) {
    const result: AgrConflictScenarioResult = evaluateConflictScenario(scenario);
    rows.push({
      scenarioId: scenario.id,
      pack: 'agr-conflict-benchmark',
      mode: 'conflict',
      composeVerdict: null,
      brokerVerdict: null,
      conflictVerdict: result.conflictVerdict,
      validatorOutcome: result.validatorOutcome,
      groundTruth: { ...scenario.groundTruth },
      expected: { ...scenario.expected },
      matchedExpectation: result.matchedExpectation,
      falseSafeRegression: result.falseSafeRegression
    });
  }
  return rows;
}

function buildSummary(seed: number, rows: readonly AdmissionBenchResultRow[]): AdmissionBenchSummary {
  let matched = 0;
  let expectationFailures = 0;
  let falseSafe = 0;
  let unsafeTotal = 0;
  let unsafeCaught = 0;
  const packs: Record<string, { scenarios: number; comparisons: number }> = {};
  const seenScenario = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.matchedExpectation) matched += 1; else expectationFailures += 1;
    if (row.falseSafeRegression) falseSafe += 1;
    if (!row.groundTruth.safeToParallelize) {
      unsafeTotal += 1;
      const permissive =
        row.composeVerdict === 'parallel-safe'
        || row.brokerVerdict === 'parallel-safe'
        || row.conflictVerdict === 'allow-parallel'
        || row.conflictVerdict === 'allow-with-watch';
      if (!permissive || row.validatorOutcome === 'fail') {
        unsafeCaught += 1;
      }
    }

    if (!packs[row.pack]) packs[row.pack] = { scenarios: 0, comparisons: 0 };
    packs[row.pack].comparisons += 1;
    const key = `${row.pack}::${row.scenarioId}`;
    if (!seenScenario.has(key)) {
      seenScenario.set(key, new Set());
      packs[row.pack].scenarios += 1;
    }
    seenScenario.get(key)!.add(row.mode);
  }

  return {
    schemaId: 'atm.admissionBenchSummary.v1',
    seed,
    scenarioCount: seenScenario.size,
    modeComparisons: rows.length,
    matched,
    expectationFailures,
    falseSafeRegressions: falseSafe,
    unsafeCaughtRate: unsafeTotal === 0 ? 1 : Math.round((unsafeCaught / unsafeTotal) * 10000) / 10000,
    shipSafe: expectationFailures === 0 && falseSafe === 0,
    packs
  };
}

function toCsv(rows: readonly AdmissionBenchResultRow[], blind: boolean): string {
  const header = [
    'scenarioId', 'pack', 'mode',
    'composeVerdict', 'brokerVerdict', 'conflictVerdict',
    'validatorOutcome',
    'safeToParallelize', 'validatorShouldCatch',
    'matchedExpectation', 'falseSafeRegression'
  ].join(',');
  const lines = rows.map((row) => [
    row.scenarioId, row.pack, row.mode,
    row.composeVerdict ?? '', row.brokerVerdict ?? '', row.conflictVerdict ?? '',
    row.validatorOutcome,
    row.groundTruth.safeToParallelize, row.groundTruth.validatorShouldCatch,
    blind ? '' : row.matchedExpectation,
    blind ? '' : row.falseSafeRegression
  ].join(','));
  return [header, ...lines].join('\n') + '\n';
}

function toMarkdown(summary: AdmissionBenchSummary, rows: readonly AdmissionBenchResultRow[]): string {
  const lines: string[] = [];
  lines.push('# ATM-AdmissionBench v0.1 — Smoke Results');
  lines.push('');
  lines.push(`- Seed: \`${summary.seed}\``);
  lines.push(`- Scenarios: ${summary.scenarioCount}`);
  lines.push(`- Mode comparisons: ${summary.modeComparisons}`);
  lines.push(`- Matched expectations: ${summary.matched}/${summary.modeComparisons}`);
  lines.push(`- False-safe regressions: ${summary.falseSafeRegressions}`);
  lines.push(`- Unsafe-caught rate: ${(summary.unsafeCaughtRate * 100).toFixed(2)}%`);
  lines.push(`- Ship-safe: ${summary.shipSafe ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Pack breakdown');
  lines.push('');
  lines.push('| Pack | Scenarios | Comparisons |');
  lines.push('| --- | ---: | ---: |');
  for (const [pack, info] of Object.entries(summary.packs).sort()) {
    lines.push(`| ${pack} | ${info.scenarios} | ${info.comparisons} |`);
  }
  lines.push('');
  lines.push('## Per-scenario');
  lines.push('');
  lines.push('| Pack | Scenario | Mode | Verdict | Validator | Matched |');
  lines.push('| --- | --- | --- | --- | --- | :---: |');
  for (const row of rows) {
    const verdict = row.composeVerdict ?? row.brokerVerdict ?? row.conflictVerdict ?? '—';
    lines.push(`| ${row.pack} | ${row.scenarioId} | ${row.mode} | ${verdict} | ${row.validatorOutcome} | ${row.matchedExpectation ? '✓' : '✗'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function readBaseCommit(root: string): string {
  const stampPath = path.join(root, 'artifacts/generated/atm-admission-bench/base-commit.txt');
  if (existsSync(stampPath)) {
    return readFileSync(stampPath, 'utf8').trim();
  }
  const head = git('rev-parse HEAD', root);
  ensureDir(path.dirname(stampPath));
  writeFileSync(stampPath, head + '\n', 'utf8');
  return head;
}

export function runAdmissionBench(options: AdmissionBenchOptions): AdmissionBenchSummary {
  const agrScenarios = loadAllAgrBenchmarkScenarios(options.root);
  const conflictScenarios = loadAllAgrConflictBenchmarkScenarios(options.root);

  const rows = [
    ...evaluateAgr(agrScenarios),
    ...evaluateConflict(conflictScenarios)
  ];

  const summary = buildSummary(options.seed, rows);
  ensureDir(options.outDir);

  const generatorCommit = git('rev-parse HEAD', options.root);
  const baseCommit = readBaseCommit(options.root);
  const generatedAt = git('show -s --format=%cI HEAD', options.root);

  const manifest = {
    schemaId: 'atm.admissionBenchGeneratorManifest.v1',
    contract: 'docs/bench/ATM-AdmissionBench-CONTRACT.md',
    seed: options.seed,
    baseCommit,
    generatorCommit,
    generatedAt,
    commands: [
      'npm run typecheck',
      'npm run validate:agr-benchmark',
      'npm run validate:agr-conflict-benchmark',
      'npm run bench:admission:smoke -- --seed 20260625',
      'npm run bench:admission:export-blind -- --seed 20260625',
      'git diff --check'
    ],
    knownLimitations: [
      'Smoke corpus only — does not exercise CAS re-plan, throughput, or vendor providers.',
      'Validator outcomes are derived from the in-repo deterministic harness, not from running external tools per scenario.',
      'Scenario verdicts are computed by the same code path that the AGR validators gate; this bench measures consistency, not correctness of that code path.',
      'Blind export removes per-mode expected routes but keeps ground-truth labels; auditor must derive expected verdicts independently.'
    ]
  };

  if (options.mode === 'smoke') {
    const runManifest = {
      schemaId: 'atm.admissionBenchRunManifest.v1',
      seed: options.seed,
      mode: options.mode,
      scenarioCount: summary.scenarioCount,
      modeComparisons: summary.modeComparisons,
      generatorCommit,
      generatedAt
    };
    writeFileSync(path.join(options.outDir, 'run-manifest.json'), JSON.stringify(runManifest, null, 2) + '\n', 'utf8');
    writeFileSync(path.join(options.outDir, 'results.jsonl'),
      rows.map((row) => JSON.stringify({ schemaId: 'atm.admissionBenchResult.v1', ...row })).join('\n') + '\n',
      'utf8');
    writeFileSync(path.join(options.outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
    writeFileSync(path.join(options.outDir, 'summary.csv'), toCsv(rows, false), 'utf8');
    writeFileSync(path.join(options.outDir, 'main-results.md'), toMarkdown(summary, rows), 'utf8');
    writeFileSync(path.join(options.outDir, 'generator-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  } else {
    const blindRows = rows.map(({ expected, matchedExpectation, falseSafeRegression, ...rest }) => rest);
    const blindSummary = {
      schemaId: 'atm.admissionBenchSummary.v1',
      seed: summary.seed,
      scenarioCount: summary.scenarioCount,
      modeComparisons: summary.modeComparisons,
      packs: summary.packs
    };
    writeFileSync(path.join(options.outDir, 'results.blind.jsonl'),
      blindRows.map((row) => JSON.stringify({ schemaId: 'atm.admissionBenchResult.blind.v1', ...row })).join('\n') + '\n',
      'utf8');
    writeFileSync(path.join(options.outDir, 'summary.blind.json'), JSON.stringify(blindSummary, null, 2) + '\n', 'utf8');
    writeFileSync(path.join(options.outDir, 'summary.csv'), toCsv(rows, true), 'utf8');
    writeFileSync(path.join(options.outDir, 'main-results.md'), toMarkdown(summary, rows), 'utf8');
    writeFileSync(path.join(options.outDir, 'generator-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    writeFileSync(path.join(options.outDir, 'README.md'), [
      '# ATM-AdmissionBench v0.1 — Blind Export',
      '',
      `Seed: \`${options.seed}\`. Generator commit: \`${generatorCommit}\`.`,
      '',
      'This package is the blind copy used for independent Codex audit.',
      'Per-mode `expected.*` routes have been removed from `results.blind.jsonl`',
      'and `summary.blind.json`; `groundTruth` flags are retained so the auditor',
      'can derive expected verdicts from the contract without reading generator',
      'oracles.',
      '',
      'Reproduce with:',
      '',
      '```',
      'npm run typecheck',
      'npm run validate:agr-benchmark',
      'npm run validate:agr-conflict-benchmark',
      `npm run bench:admission:smoke -- --seed ${options.seed}`,
      `npm run bench:admission:export-blind -- --seed ${options.seed}`,
      '```',
      ''
    ].join('\n'), 'utf8');
  }

  return summary;
}
