import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CliError } from '../shared.ts';
import { buildTelemetryObservation, normalizeTelemetryDurationMs } from '../../../../core/src/telemetry/observation.ts';
import { canonicalizeValidatorIdentity } from './validator-classification.ts';
import type { EvidenceFreshness } from './validator-classification.ts';
import { isRecord, type CommandRunEvidenceInput } from './shared-utils.ts';
export type { CommandRunEvidenceInput } from './shared-utils.ts';

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value.trim());
}

function normalizeRelativePath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

export function collectRecordCommandRuns(record: Record<string, unknown>): readonly Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const top = (record as { commandRuns?: unknown }).commandRuns;
  if (Array.isArray(top)) {
    for (const r of top) if (isRecord(r)) out.push(r);
  }
  if (isRecord(record.details)) {
    const inner = (record.details as { commandRuns?: unknown }).commandRuns;
    if (Array.isArray(inner)) {
      for (const r of inner) if (isRecord(r)) out.push(r);
    }
  }
  return out;
}

export function readRecordValidationPasses(record: Record<string, unknown>): readonly string[] {
  const passes = new Set<string>();
  const top = (record as { validationPasses?: unknown }).validationPasses;
  if (Array.isArray(top)) {
    for (const v of top) if (typeof v === 'string' && v.trim()) passes.add(canonicalizeValidatorIdentity(v.trim()));
  }
  if (isRecord(record.details)) {
    const inner = (record.details as { validationPasses?: unknown }).validationPasses;
    if (Array.isArray(inner)) {
      for (const v of inner) if (typeof v === 'string' && v.trim()) passes.add(canonicalizeValidatorIdentity(v.trim()));
    }
  }
  return [...passes];
}

export function readRecordFreshness(record: Record<string, unknown>): EvidenceFreshness {
  const top = (record as { evidenceFreshness?: unknown }).evidenceFreshness;
  if (top === 'fresh' || top === 'historical-reference' || top === 'draft') return top;
  if (isRecord(record.details)) {
    const inner = (record.details as { freshness?: unknown }).freshness;
    if (inner === 'fresh' || inner === 'historical-reference' || inner === 'draft') return inner;
  }
  return 'fresh';
}

export function hashString(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function readCurrentCommit(cwd: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8', env: process.env });
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return result.status === 0 && stdout ? stdout : undefined;
}

export function readCommandRunsInputFile(filePath: string): CommandRunEvidenceInput[] {
  if (!existsSync(filePath)) {
    throw new CliError('ATM_COMMAND_RUNS_FILE_MISSING', `Command runs file not found: ${filePath}`, { exitCode: 2 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new CliError('ATM_COMMAND_RUNS_FILE_INVALID_JSON', `Command runs file is not valid JSON: ${filePath}`, {
      exitCode: 2,
      details: { error: error instanceof Error ? error.message : String(error) }
    });
  }
  const records = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.commandRuns)
      ? parsed.commandRuns
      : isRecord(parsed) && Array.isArray(parsed.runs)
        ? parsed.runs
        : [];
  if (records.length === 0) {
    throw new CliError('ATM_COMMAND_RUNS_FILE_EMPTY', 'Command runs file must be an array or contain commandRuns[].', { exitCode: 2 });
  }
  return records.map((record, index) => normalizeCommandRunInput(record, `commandRuns/${index}`));
}

export function normalizeEvidenceCommandRuns(input: {
  readonly cwd: string;
  readonly inlineRun: CommandRunEvidenceInput | null;
  readonly fileRuns: readonly CommandRunEvidenceInput[];
  readonly runnerKind: string | null;
  readonly sourceCommit: string | null;
}): readonly CommandRunEvidenceInput[] {
  const sourceCommit = input.sourceCommit ?? readCurrentCommit(input.cwd);
  return uniqueCommandRuns([
    ...(input.inlineRun ? [input.inlineRun] : []),
    ...input.fileRuns
  ].map((run) => {
    const runnerKind = normalizeRunnerKind(run.runnerKind ?? input.runnerKind ?? inferRunnerKindFromCommand(run.command));
    const normalized = {
      ...run,
      cwd: run.cwd ?? '.',
      runnerKind,
      sourceCommit: run.sourceCommit ?? (runnerKind === 'dev-source' ? sourceCommit ?? undefined : undefined),
      cacheKey: run.cacheKey ?? computeCommandRunCacheKey({
        command: run.command,
        cwd: run.cwd ?? '.',
        exitCode: run.exitCode,
        stdoutSha256: run.stdoutSha256,
        stderrSha256: run.stderrSha256,
        runnerKind,
        sourceCommit: run.sourceCommit ?? (runnerKind === 'dev-source' ? sourceCommit ?? undefined : undefined)
      }),
      cached: run.cached === true,
      generatedAt: run.generatedAt ?? run.finishedAt ?? new Date().toISOString()
    };
    return {
      ...normalized,
      canonicalObservation: buildCommandRunObservation(normalized)
    };
  }));
}

export function normalizeCommandRunInput(value: unknown, label: string): CommandRunEvidenceInput {
  if (!isRecord(value)) {
    throw new CliError('ATM_COMMAND_RUN_INVALID', `Command run ${label} must be an object.`, { exitCode: 2 });
  }
  const command = typeof value.command === 'string' ? value.command.trim() : '';
  const exitCode = typeof value.exitCode === 'number'
    ? value.exitCode
    : typeof value.exitCode === 'string'
      ? Number.parseInt(value.exitCode, 10)
      : Number.NaN;
  const stdoutSha256 = typeof value.stdoutSha256 === 'string'
    ? value.stdoutSha256.trim()
    : typeof value.stdoutHash === 'string'
      ? value.stdoutHash.trim()
      : '';
  const stderrSha256 = typeof value.stderrSha256 === 'string'
    ? value.stderrSha256.trim()
    : typeof value.stderrHash === 'string'
      ? value.stderrHash.trim()
      : '';
  if (!command || !Number.isFinite(exitCode) || !isSha256(stdoutSha256) || !isSha256(stderrSha256)) {
    throw new CliError('ATM_COMMAND_RUN_INVALID', `Command run ${label} requires command, exitCode, stdoutSha256, and stderrSha256.`, {
      exitCode: 2,
      details: { label }
    });
  }
  const cwd = typeof value.cwd === 'string' && value.cwd.trim() ? normalizeRelativePath(value.cwd) : undefined;
  const runnerKind = typeof value.runnerKind === 'string' && value.runnerKind.trim() ? normalizeRunnerKind(value.runnerKind) : undefined;
  const generatedAt = typeof value.generatedAt === 'string' && value.generatedAt.trim() ? value.generatedAt.trim() : undefined;
  const startedAt = typeof value.startedAt === 'string' && value.startedAt.trim() ? value.startedAt.trim() : undefined;
  const finishedAt = typeof value.finishedAt === 'string' && value.finishedAt.trim() ? value.finishedAt.trim() : undefined;
  const durationMs = normalizeTelemetryDurationMs(value.durationMs);
  const cacheKey = typeof value.cacheKey === 'string' && value.cacheKey.trim() ? value.cacheKey.trim() : undefined;
  const cached = value.cached === true;
  const normalized: CommandRunEvidenceInput = {
    command,
    cwd,
    exitCode,
    stdoutSha256,
    stderrSha256,
    validators: Array.isArray(value.validators) ? value.validators.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => canonicalizeValidatorIdentity(entry)) : undefined,
    cached,
    cacheKey,
    runnerKind,
    sourceCommit: typeof value.sourceCommit === 'string' && value.sourceCommit.trim() ? value.sourceCommit.trim() : undefined,
    runnerVersion: typeof value.runnerVersion === 'string' && value.runnerVersion.trim() ? value.runnerVersion.trim() : undefined,
    generatedAt,
    startedAt,
    finishedAt,
    durationMs
  };
  return {
    ...normalized,
    canonicalObservation: buildCommandRunObservation(normalized)
  };
}

export function normalizeRunnerKind(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'dev' || normalized === 'source' || normalized === 'dev-source' || normalized === 'atm.dev.mjs') return 'dev-source';
  if (normalized === 'frozen' || normalized === 'release' || normalized === 'stable' || normalized === 'atm.mjs') return 'frozen-runner';
  if (normalized === 'external' || normalized === 'host') return 'external';
  return 'unknown';
}

export function inferRunnerKindFromCommand(command: string) {
  if (/\batm\.dev\.mjs\b/.test(command)) return 'dev-source';
  if (/\batm\.mjs\b/.test(command)) return 'frozen-runner';
  return 'unknown';
}

export function uniqueCommandRuns(runs: readonly CommandRunEvidenceInput[]) {
  const seen = new Set<string>();
  const output: CommandRunEvidenceInput[] = [];
  for (const run of runs) {
    const key = `${run.command}|${run.cwd ?? '.'}|${run.exitCode}|${run.stdoutSha256}|${run.stderrSha256}|${run.runnerKind ?? ''}|${run.sourceCommit ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(run);
  }
  return output;
}

export function computeCommandRunCacheKey(run: {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly runnerKind?: string;
  readonly sourceCommit?: string;
}) {
  return hashJson({
    schemaId: 'atm.commandRunCacheKey.v1',
    command: run.command,
    cwd: run.cwd,
    exitCode: run.exitCode,
    stdoutSha256: run.stdoutSha256,
    stderrSha256: run.stderrSha256,
    runnerKind: run.runnerKind ?? null,
    sourceCommit: run.sourceCommit ?? null
  });
}

export function buildCommandRunObservation(run: CommandRunEvidenceInput) {
  return buildTelemetryObservation({
    observationId: run.cacheKey ?? computeCommandRunCacheKey({
      command: run.command,
      cwd: run.cwd ?? '.',
      exitCode: run.exitCode,
      stdoutSha256: run.stdoutSha256,
      stderrSha256: run.stderrSha256,
      runnerKind: run.runnerKind,
      sourceCommit: run.sourceCommit
    }),
    producerId: 'evidence.command-runs',
    producerVersion: '0.1.0',
    observationKind: 'command-run',
    status: 'canonical',
    source: 'evidence-command-run-normalizer',
    sourceAvailability: 'available',
    storagePolicy: 'tracked-compact-digest',
    timing: {
      generatedAt: run.generatedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs
    },
    inputDigest: hashJson({
      command: run.command,
      cwd: run.cwd ?? '.',
      runnerKind: run.runnerKind ?? null,
      sourceCommit: run.sourceCommit ?? null
    }),
    outputDigest: hashJson({
      exitCode: run.exitCode,
      stdoutSha256: run.stdoutSha256,
      stderrSha256: run.stderrSha256
    }),
    cacheKey: run.cacheKey,
    cached: run.cached,
    extensions: {
      command: run.command,
      cwd: run.cwd ?? '.',
      exitCode: run.exitCode,
      validators: run.validators ?? [],
      runnerKind: run.runnerKind ?? 'unknown',
      sourceCommit: run.sourceCommit ?? null,
      runnerVersion: run.runnerVersion ?? null
    }
  });
}

export function hashJson(value: unknown) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
