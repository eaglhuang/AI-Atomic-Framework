import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  evaluateTddPhaseReceipt,
  type TddFailureClass,
  type TddPhase,
  type TddPhaseReceipt
} from '../../../../../core/src/evidence/tdd-cycle.ts';
import { CliError, makeResult, message } from '../../shared.ts';
import { runEvidenceRun as runEvidenceRunBase } from '../bundle-io.ts';

const TDD_FLAG_KEYS = new Set([
  '--tdd-phase',
  '--tdd-case-id',
  '--tdd-test-digest',
  '--tdd-acceptance',
  '--tdd-public-seam',
  '--tdd-baseline-sha',
  '--tdd-candidate-sha',
  '--tdd-failure-class',
  '--tdd-failure-reason',
  '--tdd-executed-cases',
  '--tdd-assertions',
  '--tdd-expected-red-predicate'
]);

export interface EvidenceTddRunOptions {
  readonly phase: TddPhase;
  readonly caseId: string;
  readonly testDigest: string;
  readonly acceptanceIds: readonly string[];
  readonly publicSeam: string;
  readonly baselineSha: string;
  readonly candidateSha: string | null;
  readonly failureClass: TddFailureClass | null;
  readonly failureReason: string | null;
  readonly executedCaseCount: number;
  readonly assertionCount: number;
  readonly expectedRedPredicate: string | null;
}

export function runEvidenceRun(argv: string[]) {
  const { baseArgv, tdd } = splitTddRunArgv(argv);
  if (!tdd) {
    return runEvidenceRunBase(baseArgv);
  }

  const common = readCommonRunOptions(baseArgv);
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const shellArgs = process.platform === 'win32'
    ? ['-NoProfile', '-Command', common.command]
    : ['-c', common.command];
  const startedAtMs = Date.now();
  const result = spawnSync(shell, shellArgs, {
    cwd: path.resolve(common.cwd),
    encoding: 'utf8',
    env: {
      ...process.env,
      ATM_ACTOR_ID: common.actorId ?? process.env.ATM_ACTOR_ID,
      ATM_TASK_ID: common.taskId
    }
  });
  const finishedAtMs = Date.now();
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const commandOk = exitCode === 0 && !result.error;

  const receipt = evaluateTddPhaseReceipt({
    phase: tdd.phase,
    binding: {
      caseId: tdd.caseId,
      testDigest: tdd.testDigest,
      acceptanceIds: tdd.acceptanceIds,
      publicSeam: tdd.publicSeam,
      baselineSha: tdd.baselineSha,
      candidateSha: tdd.phase === 'red' ? null : tdd.candidateSha
    },
    exitCode,
    commandOk,
    failureClass: tdd.failureClass,
    failureReason: tdd.failureReason ?? (result.error ? result.error.message : null),
    executedCaseCount: tdd.executedCaseCount,
    assertionCount: tdd.assertionCount,
    expectedRedPredicate: tdd.expectedRedPredicate
  });

  let baseResult: ReturnType<typeof runEvidenceRunBase> | null = null;
  let baseError: CliError | null = null;
  if (tdd.phase === 'green' || commandOk) {
    try {
      baseResult = runEvidenceRunBase(baseArgv);
    } catch (error) {
      if (error instanceof CliError) baseError = error;
      else throw error;
    }
  } else {
    // Valid red intentionally fails the command; record via failure-kind when possible.
    try {
      baseResult = runEvidenceRunBase([
        ...baseArgv,
        '--kind',
        'failure',
        '--summary',
        `TDD red observation for ${tdd.caseId}`
      ]);
    } catch (error) {
      if (error instanceof CliError) baseError = error;
      else throw error;
    }
  }

  if (!receipt.valid) {
    throw new CliError(
      'ATM_TDD_PHASE_RECEIPT_INVALID',
      `TDD ${tdd.phase} receipt invalid for case ${tdd.caseId}.`,
      {
        exitCode: 2,
        details: {
          receipt,
          exitCode,
          durationMs: Math.max(0, finishedAtMs - startedAtMs),
          stdoutSha256: hashString(result.stdout ?? ''),
          stderrSha256: hashString(result.stderr ?? ''),
          baseError: baseError?.code ?? null
        }
      }
    );
  }

  if (tdd.phase === 'green' && baseError) {
    throw baseError;
  }

  const evidence = {
    ...(baseResult?.evidence ?? {}),
    tddCycle: receipt,
    tddObservation: {
      phase: tdd.phase,
      caseId: tdd.caseId,
      exitCode,
      commandOk,
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      stdoutSha256: hashString(result.stdout ?? ''),
      stderrSha256: hashString(result.stderr ?? '')
    }
  };

  return makeResult({
    ok: true,
    command: 'evidence',
    messages: [
      message(
        'info',
        'ATM_TDD_PHASE_RECEIPT_RECORDED',
        `Recorded valid TDD ${tdd.phase} receipt for ${tdd.caseId}.`,
        { receipt }
      ),
      ...(baseResult?.messages ?? [])
    ],
    evidence,
    cwd: common.cwd
  });
}

export { runEvidenceRun as run };

export function parseEvidenceTddRunOptions(argv: readonly string[]): EvidenceTddRunOptions | null {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || !TDD_FLAG_KEYS.has(arg)) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `evidence run ${arg} requires a value`, { exitCode: 2 });
    }
    values.set(arg, value);
    i++;
  }
  if (values.size === 0) return null;
  const phaseRaw = values.get('--tdd-phase');
  if (phaseRaw !== 'red' && phaseRaw !== 'green') {
    throw new CliError('ATM_CLI_USAGE', 'evidence run --tdd-phase requires red|green', { exitCode: 2 });
  }
  const caseId = String(values.get('--tdd-case-id') ?? '').trim();
  const testDigest = String(values.get('--tdd-test-digest') ?? '').trim();
  const publicSeam = String(values.get('--tdd-public-seam') ?? '').trim();
  const baselineSha = String(values.get('--tdd-baseline-sha') ?? '').trim();
  if (!caseId || !testDigest || !publicSeam || !baselineSha) {
    throw new CliError(
      'ATM_CLI_USAGE',
      'TDD evidence run requires --tdd-case-id, --tdd-test-digest, --tdd-public-seam, and --tdd-baseline-sha',
      { exitCode: 2 }
    );
  }
  return {
    phase: phaseRaw,
    caseId,
    testDigest,
    acceptanceIds: String(values.get('--tdd-acceptance') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    publicSeam,
    baselineSha,
    candidateSha: String(values.get('--tdd-candidate-sha') ?? '').trim() || null,
    failureClass: (values.get('--tdd-failure-class') as TddFailureClass | undefined) ?? null,
    failureReason: values.get('--tdd-failure-reason') ?? null,
    executedCaseCount: Number(values.get('--tdd-executed-cases') ?? '1'),
    assertionCount: Number(values.get('--tdd-assertions') ?? '1'),
    expectedRedPredicate: values.get('--tdd-expected-red-predicate') ?? null
  };
}

export function splitTddRunArgv(argv: readonly string[]): {
  readonly baseArgv: string[];
  readonly tdd: EvidenceTddRunOptions | null;
} {
  const tdd = parseEvidenceTddRunOptions(argv);
  if (!tdd) return { baseArgv: [...argv], tdd: null };
  const baseArgv: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && TDD_FLAG_KEYS.has(arg)) {
      i++;
      continue;
    }
    if (arg !== undefined) baseArgv.push(arg);
  }
  return { baseArgv, tdd };
}

function readCommonRunOptions(argv: readonly string[]): {
  cwd: string;
  taskId: string;
  actorId: string | null;
  command: string;
} {
  let cwd = process.cwd();
  let taskId = '';
  let actorId: string | null = null;
  let command = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cwd' && argv[i + 1]) cwd = argv[++i]!;
    else if (arg === '--task' && argv[i + 1]) taskId = argv[++i]!;
    else if (arg === '--actor' && argv[i + 1]) actorId = argv[++i]!;
    else if (arg === '--command' && argv[i + 1]) command = argv[++i]!;
  }
  if (!taskId) throw new CliError('ATM_CLI_USAGE', 'evidence run requires --task <id>', { exitCode: 2 });
  if (!command) throw new CliError('ATM_CLI_USAGE', 'evidence run requires --command "<cmd>"', { exitCode: 2 });
  return { cwd, taskId, actorId, command };
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export type { TddPhaseReceipt };
