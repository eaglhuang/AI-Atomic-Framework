import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadValidatorFixture } from '../lib/validator-fixture.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixture = loadValidatorFixture(root, 'fixtures/validators/git-hooks-enforcement.fixture.json');
export const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
// TASK-AAO-FABLE-001 (ATM-BUG-2026-07-12-152): the full suite takes ~200s and
// looks like a timeout risk in interactive windows. Bounded lanes reuse the
// same linear scenario flow but stop at a named boundary; `--lane list`
// enumerates them without executing anything.
export const VALIDATOR_LANES = {
  install: { summary: 'bootstrap + integration/git-hooks install + hook template verification', expectedSeconds: 40 },
  'pre-commit': { summary: 'install lane plus deferred-governance, docs-only, and foreign-residue pre-commit scenarios', expectedSeconds: 80 },
  full: { summary: 'entire enforcement suite including commit-range bypass detection (~168 steps)', expectedSeconds: 210 }
} as const;
export type ValidatorLane = keyof typeof VALIDATOR_LANES;
const laneArgValue = process.argv.includes('--lane')
  ? String(process.argv[process.argv.indexOf('--lane') + 1] ?? '').trim()
  : 'full';
if (laneArgValue === 'list') {
  console.log(JSON.stringify({
    schemaId: 'atm.validatorLaneCatalog.v1',
    validator: 'validate:git-hooks-enforcement',
    fullSuiteCommand: 'npm run validate:git-hooks-enforcement',
    lanes: Object.entries(VALIDATOR_LANES).map(([name, lane]) => ({
      lane: name,
      command: `npm run validate:git-hooks-enforcement -- --lane ${name}`,
      expectedSeconds: lane.expectedSeconds,
      summary: lane.summary
    }))
  }, null, 2));
  process.exit(0);
}
if (!(laneArgValue in VALIDATOR_LANES)) {
  console.error(`[git-hooks-enforcement] unknown --lane ${laneArgValue}; use --lane list to enumerate lanes.`);
  process.exit(2);
}
export const selectedLane = laneArgValue as ValidatorLane;
console.log(`[git-hooks-enforcement:${mode}] lane=${selectedLane} expected duration ~${VALIDATOR_LANES[selectedLane].expectedSeconds}s (${VALIDATOR_LANES[selectedLane].summary}). Full suite: ~${VALIDATOR_LANES.full.expectedSeconds}s.`);
const childTimeoutMs = Number(process.env.ATM_VALIDATOR_CHILD_TIMEOUT_MS ?? '30000');
export const validatorStartedAt = Date.now();
let commandSequence = 0;

export function writeReadyFixtureTask(repoPath: string, taskId: string, actorId: string, title: string) {
  const taskPath = path.join(repoPath, '.atm', 'history', 'tasks', `${taskId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title,
    status: 'ready',
    owner: actorId,
    reservedAt: now,
    promotedAt: now
  }, null, 2)}\n`, 'utf8');
}

export function fail(message: string): never {
  console.error(`[git-hooks-enforcement:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

export function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

export function run(command: string, args: readonly string[], cwd: string, options: { allowFailure?: boolean; env?: Record<string, string>; input?: string } = {}) {
  const sequence = ++commandSequence;
  const label = `${command} ${args.join(' ')}`;
  const startedAt = Date.now();
  console.log(`[git-hooks-enforcement:${mode}] step ${sequence} start (${Math.round((startedAt - validatorStartedAt) / 1000)}s): ${label}`);
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    input: options.input,
    timeout: childTimeoutMs,
    env: {
      ...process.env,
      ...(options.env ?? {})
    }
  });
  const elapsedMs = Date.now() - startedAt;
  if (result.error?.message?.toLowerCase().includes('timed out') || result.signal === 'SIGTERM') {
    fail(`${label} timed out after ${childTimeoutMs}ms (step ${sequence}, elapsed ${elapsedMs}ms)`);
  }
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    fail(`${label} failed after ${elapsedMs}ms\nerror:\n${result.error?.message || ''}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  console.log(`[git-hooks-enforcement:${mode}] step ${sequence} done (${elapsedMs}ms): ${label}`);
  return result;
}

export function runGit(repo: string, args: readonly string[], options: { allowFailure?: boolean; env?: Record<string, string> } = {}) {
  return run('git', args, repo, options);
}

export function runCli(repo: string, args: readonly string[], options: { allowFailure?: boolean; env?: Record<string, string>; input?: string } = {}) {
  return run(process.execPath, ['atm.dev.mjs', ...args], repo, options);
}

export function parsePayload(result: ReturnType<typeof run>) {
  const payload = (result.stdout || result.stderr || '').trim();
  try {
    return payload ? JSON.parse(payload) : {};
  } catch (error) {
    console.error('PARSE PAYLOAD FAILED. Raw payload:', payload);
    throw error;
  }
}

export function createCommandRun(command: string, stdoutSha256: string) {
  return {
    command,
    cwd: '.',
    exitCode: 0,
    stdoutSha256,
    stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    runnerVersion: '0.1.0'
  };
}

export function rewritePackageScripts(repo: string, scripts: Record<string, string>) {
  const packageJsonPath = path.join(repo, 'package.json');
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, any>;
  parsed.scripts = {
    ...(parsed.scripts ?? {}),
    ...scripts
  };
  writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

export function writeHistoricalRestorePacket(repo: string, taskId: string, status = 'done') {
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', `${taskId}.json`);
  const closurePacketPath = path.join(repo, '.atm', 'history', 'evidence', `${taskId}.closure-packet.json`);
  const eventId = `2026-01-02T00-00-00-000Z-close-${taskId.toLowerCase()}`;
  const eventPath = path.join(repo, '.atm', 'history', 'task-events', taskId, `${eventId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  mkdirSync(path.dirname(eventPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Historical restore hook fixture',
    status,
    owner: 'legacy-agent',
    lastTransitionId: eventId,
    lastTransitionAt: '2026-01-02T00:00:00.000Z',
    closedAt: status === 'done' ? '2026-01-02T00:00:00.000Z' : null,
    closedByActor: status === 'done' ? 'legacy-agent' : null,
    closedBySessionId: status === 'done' ? 'session-legacy-restore' : null,
    claim: {
      actorId: 'legacy-agent',
      leaseId: 'lease-legacy-restore',
      state: 'active'
    }
  }, null, 2)}\n`, 'utf8');
  writeFileSync(evidencePath, `${JSON.stringify({
    taskId,
    updatedAt: '2026-01-02T00:00:00.000Z',
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'historical restore hook fixture',
        producedBy: 'legacy-agent',
        sessionId: 'session-legacy-restore',
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    ]
  }, null, 2)}\n`, 'utf8');
  writeFileSync(closurePacketPath, `${JSON.stringify({
    schemaId: 'atm.closurePacket.v1',
    specVersion: '0.1.0',
    taskId,
    targetCommit: '0123456789abcdef0123456789abcdef01234567',
    evidencePath: `.atm/history/evidence/${taskId}.json`,
    closedAt: '2026-01-02T00:00:00.000Z',
    closedByActor: 'legacy-agent'
  }, null, 2)}\n`, 'utf8');
  writeFileSync(eventPath, `${JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    specVersion: '0.1.0',
    transitionId: eventId,
    taskId,
    action: 'close',
    actorId: 'legacy-agent',
    fromStatus: 'running',
    toStatus: status,
    taskPath: `.atm/history/tasks/${taskId}.json`,
    taskSha256: 'sha256:fixture',
    createdAt: '2026-01-02T00:00:00.000Z',
    command: `node atm.mjs tasks close --task ${taskId} --actor legacy-agent --status done --json`
  }, null, 2)}\n`, 'utf8');
  return [
    `.atm/history/tasks/${taskId}.json`,
    `.atm/history/evidence/${taskId}.json`,
    `.atm/history/evidence/${taskId}.closure-packet.json`,
    `.atm/history/task-events/${taskId}/${eventId}.json`
  ];
}

const preCommitTemplate = readFileSync(path.join(root, 'templates', 'enforcement', 'pre-commit.sh'), 'utf8');
assert(preCommitTemplate.includes('runner="atm.mjs"'), 'pre-commit enforcement template must declare the stable-runner fallback');
assert(preCommitTemplate.includes('runner="atm.dev.mjs"'), 'pre-commit enforcement template must allow source-first framework routing');
assert(preCommitTemplate.includes('node "$runner" atm-chart verify --json'), 'pre-commit enforcement template must verify ATMChart freshness through the selected runner');
assert(preCommitTemplate.includes('node "$runner" hook pre-commit --json'), 'pre-commit enforcement template must delegate to ATM hook pre-commit through the selected runner');
assert(preCommitTemplate.includes('node "$runner" tasks audit --json'), 'pre-commit enforcement template must audit task closure integrity through the selected runner');
assert(preCommitTemplate.includes('node "$runner" agent-pack verify-fresh --id "$pack_id" --json'), 'pre-commit enforcement template must verify installed agent-pack freshness through the selected runner');

const examplePreCommit = readFileSync(path.join(root, 'examples', 'git-hooks-enforcement', 'hooks', 'pre-commit'), 'utf8');
assert(examplePreCommit.includes('runner="atm.mjs"'), 'example pre-commit hook must declare the stable-runner fallback');
assert(examplePreCommit.includes('runner="atm.dev.mjs"'), 'example pre-commit hook must allow source-first framework routing');
assert(examplePreCommit.includes('node "$runner" hook pre-commit --json'), 'example pre-commit hook must use hook pre-commit through the selected runner');

export const tempRoot = mkdtempSync(path.join(process.env.TMPDIR ?? process.env.TEMP ?? '.', 'atm-git-hooks-'));
export function completeLaneBoundary(boundary: ValidatorLane) {
  if (selectedLane !== boundary) return;
  rmSync(tempRoot, { recursive: true, force: true });
  console.log(`[git-hooks-enforcement:${mode}] ok (bounded lane '${boundary}' completed in ${Math.round((Date.now() - validatorStartedAt) / 1000)}s)`);
  process.exit(0);
}
