import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePlan3SemanticClosure } from '../packages/cli/src/commands/broker/replay/closure-policy.ts';
import { inspectCommandBackedMatrix } from '../packages/cli/src/commands/broker/replay/command-backed-matrix.ts';
import { selectRuntimeDogfoodTasks } from '../packages/cli/src/commands/broker/replay/implementation.ts';

interface DiagnosticCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly evidence?: unknown;
}

interface DiagnosticReport {
  readonly schemaId: 'atm.plan3EvidenceClosureDiagnostic.v1';
  readonly generatedAt: string;
  readonly cwd: string;
  readonly ok: boolean;
  readonly verdict: 'ready-to-close' | 'remain-open';
  readonly blockers: readonly string[];
  readonly checks: readonly DiagnosticCheck[];
  readonly semanticClosure?: unknown;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.cwd() || repoRoot;
const requiredIntersection = ['docs/governance/atm-3-replay-evidence.md'];

interface FrozenCommandReceipt {
  readonly id: string;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly elapsedMs: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly combinedDigest: string;
}

interface FalseGreenEvidenceFreeze {
  readonly schemaId: 'atm.falseGreenEvidenceFreeze.v1';
  readonly generatedAt: string;
  readonly verdict: 'remain-open';
  readonly receiptWindow: { readonly startedAt: string; readonly finishedAt: string };
  readonly scope: Record<string, unknown>;
  readonly commandReceipts: readonly FrozenCommandReceipt[];
  readonly rescueWorktrees: readonly Record<string, unknown>[];
  readonly nonClaims: readonly string[];
}

const freezeCurrentHead = process.argv.includes('--freeze-current-head');
if (freezeCurrentHead) {
  runFreezeCurrentHead();
  process.exit(0);
}

const semantic = evaluatePlan3SemanticClosure({
  cwd,
  requiredIntersection,
  useLiveEvidence: true
});

const checks: DiagnosticCheck[] = [
  dogfoodCandidateCheck(cwd),
  replayCliSurfaceCheck(cwd),
  commandBackedMatrixCheck(cwd),
  formulaMatrixDisclosureCheck(cwd),
  {
    name: 'semantic-closure-policy',
    ok: semantic.verdict === 'ready-to-close',
    detail: semantic.verdict === 'ready-to-close'
      ? 'semantic closure predicates are satisfied'
      : `remain-open; missing=${semantic.missingLifecycleClasses.join(',') || 'none'}; invariants=${semantic.invariantFindings.map((entry) => entry.code).join(',') || 'none'}`,
    evidence: semantic
  }
];

const blockers = [
  ...checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`),
  ...semantic.blockers
];
const uniqueBlockers = [...new Set(blockers)];
const report: DiagnosticReport = {
  schemaId: 'atm.plan3EvidenceClosureDiagnostic.v1',
  generatedAt: new Date().toISOString(),
  cwd,
  ok: uniqueBlockers.length === 0,
  verdict: uniqueBlockers.length === 0 ? 'ready-to-close' : 'remain-open',
  blockers: uniqueBlockers,
  checks,
  semanticClosure: semantic
};

const jsonRequested = process.argv.includes('--json');
const allowInconclusive = process.argv.includes('--allow-inconclusive');

if (jsonRequested) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Plan 3 evidence closure diagnostic: ${report.verdict}`);
  for (const check of checks) {
    console.log(`- ${check.ok ? 'ok' : 'blocker'} ${check.name}: ${check.detail}`);
  }
}

if (!report.ok && !allowInconclusive) process.exitCode = 1;

function dogfoodCandidateCheck(root: string): DiagnosticCheck {
  let selected: ReturnType<typeof selectRuntimeDogfoodTasks> = [];
  try {
    selected = selectRuntimeDogfoodTasks({
      cwd: root,
      requiredIntersection,
      minimum: 2
    });
  } catch {
    selected = [];
  }
  const present = selected.length >= 2;
  return {
    name: 'real-dogfood-registered-candidates',
    // Missing candidates remain a hard blocker. Present candidates are only availability,
    // so keep ok=true and let semantic-closure-policy own the fail-closed verdict.
    ok: present,
    detail: present
      ? `found ${selected.length} registered task candidates with declared intersection (availability only; not closure proof)`
      : `found ${selected.length}/2 registered planned/ready/running task candidates with declared intersection`,
    evidence: {
      requiredIntersection,
      selected,
      closureNote: 'candidate-availability-is-not-semantic-closure'
    }
  };
}

function replayCliSurfaceCheck(root: string): DiagnosticCheck {
  const brokerSpecPath = path.join(root, 'packages/cli/src/commands/command-specs/broker.spec.ts');
  const brokerImplementationPath = path.join(root, 'packages/cli/src/commands/broker/implementation.ts');
  const brokerSpec = existsSync(brokerSpecPath) ? readFileSync(brokerSpecPath, 'utf8') : '';
  const brokerImplementation = existsSync(brokerImplementationPath) ? readFileSync(brokerImplementationPath, 'utf8') : '';
  const hasPublicReplayAction = /\breplay\b/.test(brokerSpec) || /supports: .*replay/.test(brokerImplementation);
  return {
    name: 'frozen-cli-replay-surface',
    ok: hasPublicReplayAction,
    detail: hasPublicReplayAction
      ? 'broker replay is exposed as a frozen CLI action'
      : 'no public frozen `node atm.mjs broker replay ...` action is exposed; current replay harness is implementation/test-only',
    evidence: {
      brokerSpecPath: relative(root, brokerSpecPath),
      brokerImplementationPath: relative(root, brokerImplementationPath)
    }
  };
}

function commandBackedMatrixCheck(root: string): DiagnosticCheck {
  const matrix = inspectCommandBackedMatrix(root);
  const currentSummary = readCurrentPairedAbSummary(root);
  const currentComplete = currentSummary !== null
    && currentSummary.schemaId === 'atm.pairedAbV4Summary.v1'
    && currentSummary.verdict === 'pass'
    && currentSummary.cellCount === currentSummary.requiredCellCount
    && currentSummary.repeatsPerOrder >= 3
    && currentSummary.correctness?.negativeControlRejectedBeforeCanonicalWrite === true;
  const legacyComplete = matrix.cellCount === 420 && matrix.commandBackedCount === 420;
  const complete = currentComplete || legacyComplete;
  return {
    name: 'command-backed-420-cell-matrix',
    // Missing receipt shapes remain a hard blocker. Complete shapes alone still cannot close;
    // semantic-closure-policy keeps the repository remain-open under fake-green inputs.
    ok: complete,
    detail: currentComplete
      ? `${currentSummary.cellCount} matched AB/BA comparison cells passed with ${currentSummary.repeatsPerOrder} repeats per order (current schema; shape only, not closure proof)`
      : legacyComplete
        ? 'all 420 legacy cells include command/workload receipt shapes (shape only; not closure proof)'
        : `${matrix.cellCount} legacy cells found, ${matrix.commandBackedCount}/420 include command/workload receipt evidence`,
    evidence: {
      ...matrix,
      currentSummary,
      closureNote: 'receipt-shape-is-not-semantic-closure'
    }
  };
}

function readCurrentPairedAbSummary(root: string): Record<string, any> | null {
  const summaryPath = path.join(root, 'artifacts/generated/atm-ab-v4/summary.json');
  if (!existsSync(summaryPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(summaryPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formulaMatrixDisclosureCheck(root: string): DiagnosticCheck {
  const scriptPath = path.join(root, 'scripts/run-paired-ab-v4.ts');
  const source = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';
  const formulaSignals = [
    'const serialBase =',
    'const armFactor =',
    'const throughputFactor =',
    'const costFactor ='
  ].filter((signal) => source.includes(signal));
  return {
    name: 'formula-generated-matrix-disclosed',
    ok: true,
    detail: formulaSignals.length > 0
      ? 'current paired AB v4 matrix is visibly formula-generated and must not be treated as real workload proof'
      : 'formula-generation signals were not found; inspect whether the matrix source changed',
    evidence: {
      scriptPath: relative(root, scriptPath),
      formulaSignals,
      informationalOnly: true
    }
  };
}

function relative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function runFreezeCurrentHead(): void {
  const outputArgument = valueAfter('--output');
  if (!outputArgument) throw new Error('--freeze-current-head requires --output <path>');
  const outputPath = path.resolve(cwd, outputArgument);
  const markdownPath = outputPath.replace(/\.json$/i, '.md');
  if (markdownPath === outputPath) throw new Error('--output must end in .json so the paired markdown receipt can be derived');
  const startedAt = new Date().toISOString();
  const planningRoot = process.env.ATM_PLANNING_REPO_ROOT || 'C:/Users/User/3KLife';
  const commands: ReadonlyArray<{ id: string; command: readonly string[]; commandCwd?: string; timeoutMs?: number }> = [
    { id: 'target-head', command: ['git', 'rev-parse', 'HEAD'], commandCwd: cwd },
    { id: 'origin-main-head', command: ['git', 'rev-parse', 'origin/main'], commandCwd: cwd },
    { id: 'planning-head', command: ['git', 'rev-parse', 'HEAD'], commandCwd: planningRoot },
    { id: 'target-status-porcelain', command: ['git', 'status', '--porcelain=v1', '-z'], commandCwd: cwd },
    { id: 'planning-status-porcelain', command: ['git', 'status', '--porcelain=v1', '-z'], commandCwd: planningRoot },
    { id: 'worktree-registry', command: ['git', 'worktree', 'list', '--porcelain'], commandCwd: cwd },
    { id: 'task-ledger-census', command: [process.execPath, 'atm.mjs', 'tasks', 'audit', '--all', '--summary', '--fields', 'taskId,status,claimState,owner,lastTransitionAt,residueBucket,nextActionCode,planningStatus,partialClose', '--json'] },
    { id: 'protected-override-census', command: [process.execPath, 'atm.mjs', 'emergency', 'audit', '--json'] },
    { id: 'validate-test-facade', command: [process.execPath, '--strip-types', 'scripts/validate-test-facade.ts', '--mode', 'validate'], timeoutMs: 30 * 60 * 1000 },
    { id: 'validate-module-boundaries', command: [process.execPath, '--strip-types', 'scripts/validate-module-boundaries.ts', '--mode', 'validate'], timeoutMs: 10 * 60 * 1000 },
    { id: 'validate-quick', command: [process.execPath, '--strip-types', 'scripts/run-validators.ts', 'quick'], timeoutMs: 15 * 60 * 1000 },
    { id: 'validate-standard', command: [process.execPath, '--strip-types', 'scripts/run-validators.ts', 'standard'], timeoutMs: 45 * 60 * 1000 }
  ];
  const receipts = commands.map((entry) => captureCommand(entry.id, entry.command, entry.commandCwd ?? cwd, entry.timeoutMs ?? 5 * 60 * 1000));
  const rescueReceipt = receipts.find((receipt) => receipt.id === 'worktree-registry');
  const rescueWorktrees = parseRescueWorktrees(rescueReceipt?.stdout ?? '');
  const currentHeads = Object.fromEntries(receipts
    .filter((receipt) => ['target-head', 'origin-main-head', 'planning-head'].includes(receipt.id))
    .map((receipt) => [receipt.id, receipt.stdout.trim() || null]));
  const finishedAt = new Date().toISOString();
  const freeze: FalseGreenEvidenceFreeze = {
    schemaId: 'atm.falseGreenEvidenceFreeze.v1',
    generatedAt: finishedAt,
    verdict: 'remain-open',
    receiptWindow: { startedAt, finishedAt },
    scope: {
      targetHead: currentHeads['target-head'],
      originMainHead: currentHeads['origin-main-head'],
      planningHead: currentHeads['planning-head'],
      planningRoot,
      sourceDigestStatus: 'present',
      sourceDigestReason: 'Every current-head census and validator result is embedded as a raw, hashed receipt in commandReceipts.'
    },
    commandReceipts: receipts,
    rescueWorktrees,
    nonClaims: [
      'This freeze does not certify Plan 3.0, 3.1, 3.2, or 4.0.',
      'A non-zero exit code, timeout, unavailable source, or malformed receipt remains evidence for NOT COMPLETE and is never normalized to pass.',
      'No rescue worktree was pruned, removed, reset, rebased, merged, or otherwise cleaned by this collector.'
    ]
  };
  writeFileSync(outputPath, `${JSON.stringify(freeze, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderFreezeMarkdown(freeze), 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath: relative(cwd, outputPath), markdownPath: relative(cwd, markdownPath), receiptCount: receipts.length, rescueWorktreeCount: rescueWorktrees.length, verdict: freeze.verdict }, null, 2)}\n`);
}

function captureCommand(id: string, command: readonly string[], commandCwd: string, timeoutMs: number): FrozenCommandReceipt {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const result = spawnSync(command[0], command.slice(1), { cwd: commandCwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  const finishedAt = new Date().toISOString();
  const stdout = result.stdout || '';
  const stderr = `${result.error ? `${result.error.message}\n` : ''}${result.stderr || ''}`;
  const timedOut = result.error?.name === 'Error' && /timed?\s*out/i.test(result.error.message);
  return {
    id,
    command,
    cwd: commandCwd,
    startedAt,
    finishedAt,
    elapsedMs: Date.now() - started,
    exitCode: typeof result.status === 'number' ? result.status : null,
    timedOut,
    signal: result.signal ?? null,
    stdout,
    stderr,
    stdoutDigest: digest(stdout),
    stderrDigest: digest(stderr),
    combinedDigest: digest(`${stdout}\u0000${stderr}`)
  };
}

function parseRescueWorktrees(raw: string): readonly Record<string, unknown>[] {
  const blocks = raw.split(/\r?\n\r?\n/);
  return blocks.flatMap((block) => {
    const fields = Object.fromEntries(block.split(/\r?\n/).map((line) => {
      const separator = line.indexOf(' ');
      return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const worktree = fields.worktree;
    if (!worktree || !/ATM-rescue-/.test(worktree)) return [];
    return [{ path: worktree.replaceAll('\\', '/'), head: fields.HEAD ?? null, evidenceHold: true }];
  });
}

function renderFreezeMarkdown(freeze: FalseGreenEvidenceFreeze): string {
  const lines = [
    '# Plan 3.x / 4.x false-green evidence freeze',
    '',
    `- Verdict: **${freeze.verdict}**`,
    `- Window: ${freeze.receiptWindow.startedAt} → ${freeze.receiptWindow.finishedAt}`,
    `- Raw receipt count: ${freeze.commandReceipts.length}`,
    `- Rescue worktrees held: ${freeze.rescueWorktrees.length}`,
    '',
    '## Command receipts',
    '',
    '| id | exit | timeout | elapsed ms | combined digest |',
    '|---|---:|---|---:|---|',
    ...freeze.commandReceipts.map((receipt) => `| ${receipt.id} | ${receipt.exitCode ?? 'null'} | ${receipt.timedOut} | ${receipt.elapsedMs} | \`${receipt.combinedDigest}\` |`),
    '',
    'The JSON companion is authoritative for raw stdout/stderr. Non-zero and timeout receipts remain negative evidence; this artifact does not compute a completion verdict from them.',
    ''
  ];
  return lines.join('\n');
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}
