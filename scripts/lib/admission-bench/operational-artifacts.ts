import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { operationalBenchScenarios, getOperationalBenchProfile } from './operational-scenarios.ts';
import {
  operationalBenchSpanNames,
  type OperationalBenchProfileName,
  type OperationalBenchResultRow,
  type OperationalBenchSpanName,
  type OperationalBenchStats
} from './operational-types.ts';

export interface OperationalBenchArtifactContext {
  readonly runId: string;
  readonly root: string;
  readonly seed: number;
  readonly profile: {
    readonly name: OperationalBenchProfileName;
    readonly warmup: number;
    readonly repeat: number;
    readonly concurrency: readonly number[];
  };
  readonly outDir: string;
}

export interface SummaryDoc {
  readonly schemaId: 'atm.operationalBenchSummary.v1';
  readonly benchFamily: 'ATM Bench';
  readonly benchName: 'ATM OperationalBench';
  readonly benchVersion: '0.1';
  readonly seed: number;
  readonly profile: OperationalBenchProfileName;
  readonly warmup: number;
  readonly repeat: number;
  readonly concurrency: readonly number[];
  readonly scenarioCount: number;
  readonly resultRows: number;
  readonly trackCounts: Record<string, number>;
  readonly blockedCaseCounts: Record<string, number>;
  readonly routeCounts: Record<string, number>;
  readonly spanStats: Record<OperationalBenchSpanName, OperationalBenchStats>;
  readonly scenarioSpanStats: Record<string, Record<OperationalBenchSpanName, OperationalBenchStats>>;
  readonly recoveryMetrics: {
    readonly preservedIntentSalvageRate: number | null;
    readonly terminalFailClosedRate: number | null;
    readonly overSerializationRate: number | null;
    readonly fullRegenerationRate: number | null;
    readonly fullRegenerationNote: string;
  };
  readonly nullMetricReasons: readonly {
    readonly scenarioId: string;
    readonly metric: OperationalBenchSpanName | 'fullRegenerationRate';
    readonly reason: string;
  }[];
  readonly notes: readonly string[];
}

function roundMs(value: number): number {
  if (value < 0.001) return 0.001;
  return Math.round(value * 1000) / 1000;
}

function stats(values: readonly (number | null)[]): OperationalBenchStats {
  const numeric = values.filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
  if (numeric.length === 0) {
    return { count: 0, min: null, max: null, mean: null, stddev: null, p50: null, p95: null, p99: null };
  }
  const mean = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const variance = numeric.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numeric.length;
  return {
    count: numeric.length,
    min: roundMs(numeric[0]),
    max: roundMs(numeric[numeric.length - 1]),
    mean: roundMs(mean),
    stddev: roundMs(Math.sqrt(variance)),
    p50: percentile(numeric, 0.50),
    p95: percentile(numeric, 0.95),
    p99: percentile(numeric, 0.99)
  };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return roundMs(values[index]);
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function rate(values: readonly (boolean | null)[]): number | null {
  const observed = values.filter((value): value is boolean => typeof value === 'boolean');
  if (observed.length === 0) return null;
  return roundRate(observed.filter(Boolean).length / observed.length);
}

function roundRate(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function buildSummary(ctx: OperationalBenchArtifactContext, rows: readonly OperationalBenchResultRow[]): SummaryDoc {
  const spanStats = Object.fromEntries(operationalBenchSpanNames.map((name) => [name, stats(rows.map((row) => row.spans[name]))])) as Record<OperationalBenchSpanName, OperationalBenchStats>;
  const scenarioSpanStats = Object.fromEntries(operationalBenchScenarios.map((scenario) => [
    scenario.id,
    Object.fromEntries(operationalBenchSpanNames.map((name) => [name, stats(rows.filter((row) => row.scenarioId === scenario.id).map((row) => row.spans[name]))]))
  ])) as Record<string, Record<OperationalBenchSpanName, OperationalBenchStats>>;

  return {
    schemaId: 'atm.operationalBenchSummary.v1',
    benchFamily: 'ATM Bench',
    benchName: 'ATM OperationalBench',
    benchVersion: '0.1',
    seed: ctx.seed,
    profile: ctx.profile.name,
    warmup: ctx.profile.warmup,
    repeat: ctx.profile.repeat,
    concurrency: ctx.profile.concurrency,
    scenarioCount: operationalBenchScenarios.length,
    resultRows: rows.length,
    trackCounts: countBy(rows.map((row) => row.track)),
    blockedCaseCounts: countBy(rows.map((row) => row.blockedCase)),
    routeCounts: countBy(rows.map((row) => row.route)),
    spanStats,
    scenarioSpanStats,
    recoveryMetrics: {
      preservedIntentSalvageRate: rate(rows.map((row) => row.recovery.preservedIntentSalvage)),
      terminalFailClosedRate: rate(rows.map((row) => row.recovery.terminalFailClosed)),
      overSerializationRate: rate(rows.map((row) => row.recovery.overSerialized)),
      fullRegenerationRate: null,
      fullRegenerationNote: 'not observed by this harness'
    },
    nullMetricReasons: buildNullMetricReasons(rows),
    notes: [
      'OperationalBench measures ATM-local operational overhead only; it is not an external comparison benchmark.',
      'Validator cost is listed independently in validatorMs.',
      'Fail-closed means fail-closed to unsafe direct or parallel apply; preserved intent is not discarded.',
      'Blocked cases are separated into queue, serialization, steward review, rebase replay, refinement, and terminal fail-closed.'
    ]
  };
}

function buildNullMetricReasons(rows: readonly OperationalBenchResultRow[]) {
  const entries: Array<{ scenarioId: string; metric: OperationalBenchSpanName | 'fullRegenerationRate'; reason: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const name of operationalBenchSpanNames) {
      if (row.spans[name] !== null) continue;
      const reason = nullReason(row.scenarioId, name);
      const key = `${row.scenarioId}:${name}:${reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ scenarioId: row.scenarioId, metric: name, reason });
    }
  }
  for (const scenario of operationalBenchScenarios) {
    const key = `${scenario.id}:fullRegenerationRate`;
    if (!seen.has(key)) {
      entries.push({ scenarioId: scenario.id, metric: 'fullRegenerationRate', reason: 'not observed by this harness' });
      seen.add(key);
    }
  }
  return entries.sort((a, b) => `${a.scenarioId}:${a.metric}`.localeCompare(`${b.scenarioId}:${b.metric}`));
}

function nullReason(scenarioId: string, metric: OperationalBenchSpanName): string {
  if (metric === 'composerPlanMs') return 'scenario did not route through deterministic composer planning';
  if (metric === 'stewardDryRunMs') return 'scenario did not route through neutral steward dry-run';
  if (metric === 'stewardApplyMs') return 'scenario did not route through neutral steward apply';
  if (metric === 'gitAdmitDryRunMs') return 'scenario is not a Git boundary pre-push dry-run case';
  if (metric === 'casMismatchRecoveryMs') return 'scenario did not observe a CAS/non-fast-forward recovery path';
  if (metric === 'queueWaitMs') return 'scenario did not enter a serial queue path';
  if (metric === 'diffConstructionMs') return 'scenario did not construct a Git diff envelope';
  if (metric === 'mutationRequestConstructionMs') return 'not executed by this scenario shape';
  if (metric === 'admissionDecisionMs') return 'not executed by this scenario shape';
  if (metric === 'validatorMs') return 'validator phase was not reached';
  return `${scenarioId} did not execute ${metric}`;
}

function renderPaperTable(summary: SummaryDoc): string {
  const lines = [
    '# ATM OperationalBench v0.1 Paper Table',
    '',
    'OperationalBench is an ATM Bench family member and the operational-overhead sibling of AdmissionBench. It measures ATM-local overhead only; it does not compare ATM with CoAgent, S-Bus, CodeTeam, or any external system.',
    '',
    'Validator cost is listed independently as `validatorMs`. Fail-closed means fail-closed to unsafe direct or parallel apply, not discarding preserved intent.',
    '',
    '| Metric | Count | Min ms | Mean ms | Stddev ms | P50 ms | P95 ms | P99 ms | Max ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const name of operationalBenchSpanNames) {
    const stat = summary.spanStats[name];
    lines.push(`| ${name} | ${stat.count} | ${fmt(stat.min)} | ${fmt(stat.mean)} | ${fmt(stat.stddev)} | ${fmt(stat.p50)} | ${fmt(stat.p95)} | ${fmt(stat.p99)} | ${fmt(stat.max)} |`);
  }
  lines.push('');
  lines.push('| Recovery Metric | Value | Note |');
  lines.push('| --- | ---: | --- |');
  lines.push(`| preservedIntentSalvageRate | ${fmtRate(summary.recoveryMetrics.preservedIntentSalvageRate)} | Preserved intent after recovery routing |`);
  lines.push(`| terminalFailClosedRate | ${fmtRate(summary.recoveryMetrics.terminalFailClosedRate)} | Fail-closed to unsafe direct/parallel apply |`);
  lines.push(`| overSerializationRate | ${fmtRate(summary.recoveryMetrics.overSerializationRate)} | Explicit over-serialization observations |`);
  lines.push(`| fullRegenerationRate | null | ${summary.recoveryMetrics.fullRegenerationNote} |`);
  lines.push('');
  lines.push('| Blocked Case | Rows |');
  lines.push('| --- | ---: |');
  for (const [blockedCase, count] of Object.entries(summary.blockedCaseCounts).sort()) {
    lines.push(`| ${blockedCase} | ${count} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function fmt(value: number | null): string {
  return value === null ? 'null' : value.toFixed(3);
}

function fmtRate(value: number | null): string {
  return value === null ? 'null' : value.toFixed(4);
}

function renderReadme(ctx: OperationalBenchArtifactContext, summary: SummaryDoc): string {
  return [
    '# ATM OperationalBench v0.1',
    '',
    'This artifact is part of the ATM Bench family. It is the operational-overhead sibling of AdmissionBench and uses the same `docs/bench`, `bench:*`, validator registry, and generated-artifact conventions.',
    '',
    'OperationalBench measures ATM-local operational overhead only. It must not be cited as showing that ATM is faster or slower than CoAgent, S-Bus, CodeTeam, or any external system.',
    '',
    'Validator cost is listed independently as `validatorMs`. Unexecuted spans are `null`, never `0`.',
    '',
    'Fail-closed means fail-closed to unsafe direct or parallel apply. It does not mean the original intent was discarded.',
    '',
    'Blocked cases are reported separately as queue, serialization, steward review, rebase replay, refinement, and terminal fail-closed.',
    '',
    `Profile: \`${ctx.profile.name}\`; warmup: \`${ctx.profile.warmup}\`; repeat: \`${ctx.profile.repeat}\`; concurrency: \`${ctx.profile.concurrency.join(', ')}\`; seed: \`${ctx.seed}\`.`,
    '',
    'Reproduce:',
    '',
    '```bash',
    `npm run bench:operational:${ctx.profile.name} -- --seed ${ctx.seed}`,
    'npm run validate:operational-bench',
    '```',
    '',
    'Required files:',
    '',
    '- `summary.json`',
    '- `results.jsonl`',
    '- `paper-table.md`',
    '- `scenario-manifest.json`',
    '- `artifact-hash-manifest.sha256`',
    '',
    `Full regeneration rate is \`null\`: ${summary.recoveryMetrics.fullRegenerationNote}.`,
    ''
  ].join('\n');
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

function writeHashManifest(outDir: string): void {
  const manifestPath = path.join(outDir, 'artifact-hash-manifest.sha256');
  const files = listFiles(outDir)
    .filter((file) => path.resolve(file) !== path.resolve(manifestPath))
    .sort((a, b) => a.localeCompare(b));
  const lines = files.map((file) => {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    const relative = path.relative(outDir, file).replace(/\\/g, '/');
    return `${hash}  ${relative}`;
  });
  writeFileSync(manifestPath, `${lines.join('\n')}\n`, 'utf8');
}

export function writeOperationalBenchArtifacts(ctx: OperationalBenchArtifactContext, rows: readonly OperationalBenchResultRow[], summary: SummaryDoc): void {
  writeFileSync(path.join(ctx.outDir, 'results.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeJson(path.join(ctx.outDir, 'summary.json'), summary);
  writeJson(path.join(ctx.outDir, 'scenario-manifest.json'), {
    schemaId: 'atm.operationalBenchScenarioManifest.v1',
    benchFamily: 'ATM Bench',
    benchName: 'ATM OperationalBench',
    benchVersion: '0.1',
    profiles: {
      smoke: getOperationalBenchProfile('smoke'),
      paper: getOperationalBenchProfile('paper'),
      extended: getOperationalBenchProfile('extended')
    },
    scenarios: operationalBenchScenarios
  });
  writeFileSync(path.join(ctx.outDir, 'paper-table.md'), renderPaperTable(summary), 'utf8');
  writeFileSync(path.join(ctx.outDir, 'README.md'), renderReadme(ctx, summary), 'utf8');
  writeHashManifest(ctx.outDir);
}
