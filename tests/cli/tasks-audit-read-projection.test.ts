import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  REGISTERED_PROJECTION_FIELDS,
  TASK_READ_PROJECTION_SCHEMA_ID,
  buildTaskReadProjection,
  hasTaskReadProjectionRequest,
  parseTaskReadProjectionOptions,
  runTasksReadProjection
} from '../../packages/cli/src/commands/tasks/read-projection.ts';

const frameworkRepo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function writeTask(repo: string, taskId: string, status: string, actorId: string): void {
  const transitionId = `2026-07-29T00-00-00-000Z-close-${taskId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  mkdirSync(path.join(repo, '.atm', 'history', 'task-events', taskId), { recursive: true });
  writeFileSync(
    path.join(repo, '.atm', 'history', 'task-events', taskId, `${transitionId}.json`),
    `${JSON.stringify({
      schemaId: 'atm.taskTransition.v1',
      transitionId,
      taskId,
      action: 'close',
      actorId,
      createdAt: '2026-07-29T00:00:00.000Z'
    }, null, 2)}\n`,
    'utf8'
  );
  writeFileSync(
    path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`),
    `${JSON.stringify({
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: taskId,
      title: `${taskId} fixture`,
      status,
      targetWork: { allowedFiles: [] }
    }, null, 2)}\n`,
    'utf8'
  );
}

function makeRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'tasks-read-projection-'));
  mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
  writeTask(repo, 'TASK-ZZZ-0002', 'done', 'actor-b');
  writeTask(repo, 'TASK-ZZZ-0001', 'running', 'actor-a');
  writeTask(repo, 'TASK-YYY-0001', 'planned', 'actor-c');
  return repo;
}

const repo = makeRepo();

// --- request detection ------------------------------------------------------
assert.equal(hasTaskReadProjectionRequest(['--json']), false, 'plain audit must not route to projection');
assert.equal(hasTaskReadProjectionRequest(['--staged', '--json']), false, 'staged audit must not route to projection');
assert.equal(hasTaskReadProjectionRequest(['--summary', '--all']), true);
assert.equal(hasTaskReadProjectionRequest(['--tasks', 'TASK-ZZZ-0001']), true);

// --- explicit multi-task selection ------------------------------------------
const explicit = buildTaskReadProjection(parseTaskReadProjectionOptions([
  '--cwd', repo, '--tasks', 'TASK-ZZZ-0002,TASK-ZZZ-0001', '--summary', '--json'
]));
assert.equal(explicit.schemaId, TASK_READ_PROJECTION_SCHEMA_ID);
assert.equal(explicit.readOnly, true);
assert.equal(explicit.rowCount, 2);
assert.deepEqual(
  explicit.rows.map((row) => row.taskId),
  ['TASK-ZZZ-0001', 'TASK-ZZZ-0002'],
  'rows must be sorted by taskId regardless of argument order'
);
assert.equal(explicit.rows[0].status, 'running');
assert.equal(explicit.rows[1].status, 'done');

// --- series filtering and stable ordering -----------------------------------
const series = buildTaskReadProjection(parseTaskReadProjectionOptions([
  '--cwd', repo, '--series', 'TASK-ZZZ', '--summary'
]));
assert.deepEqual(series.rows.map((row) => row.taskId), ['TASK-ZZZ-0001', 'TASK-ZZZ-0002']);
assert.ok(
  series.rows.every((row) => String(row.taskId).startsWith('TASK-ZZZ-')),
  'series selection must exclude other prefixes'
);

const all = buildTaskReadProjection(parseTaskReadProjectionOptions(['--cwd', repo, '--all', '--summary']));
assert.equal(all.rowCount, 3);
assert.deepEqual(all.rows.map((row) => row.taskId), ['TASK-YYY-0001', 'TASK-ZZZ-0001', 'TASK-ZZZ-0002']);

// --- fields allowlist -------------------------------------------------------
const projected = buildTaskReadProjection(parseTaskReadProjectionOptions([
  '--cwd', repo, '--series', 'TASK-ZZZ', '--fields', 'taskId,status'
]));
assert.deepEqual(Object.keys(projected.rows[0]), ['taskId', 'status'], 'only requested fields are emitted');

for (const field of REGISTERED_PROJECTION_FIELDS) {
  const single = buildTaskReadProjection(parseTaskReadProjectionOptions([
    '--cwd', repo, '--tasks', 'TASK-ZZZ-0001', '--fields', field
  ]));
  assert.deepEqual(Object.keys(single.rows[0]), [field], `registered field ${field} must project`);
}

// --- fail-closed rejections -------------------------------------------------
function rejects(argv: string[], needle: string, label: string): void {
  assert.throws(
    () => parseTaskReadProjectionOptions(argv),
    (error: unknown) => {
      const err = error as { code?: string; message?: string };
      assert.equal(err.code, 'ATM_CLI_USAGE', `${label} must fail with ATM_CLI_USAGE`);
      assert.ok(String(err.message).includes(needle), `${label} message should mention ${needle}`);
      return true;
    },
    label
  );
}

rejects(['--cwd', repo, '--all', '--fields', 'taskId,rm -rf /'], 'does not support field', 'unknown field');
rejects(['--cwd', repo, '--all', '--fields', 'nextAction'], 'does not support field', 'near-miss field name');
rejects(['--cwd', repo, '--summary'], 'exactly one of', 'no selector');
rejects(['--cwd', repo, '--all', '--series', 'TASK-ZZZ', '--summary'], 'exactly one of', 'two selectors');
rejects(['--cwd', repo, '--all'], '--summary or --fields', 'no projection mode');
rejects(['--cwd', repo, '--tasks', '../../etc/passwd', '--summary'], 'task ids only', 'path traversal selector');
rejects(['--cwd', repo, '--tasks', 'process.exit(1)', '--summary'], 'task ids only', 'js expression selector');
rejects(['--cwd', repo, '--series', '$(whoami)', '--summary'], 'prefix only', 'shell text selector');
rejects(['--cwd', repo, '--all', '--summary', '--eval', 'x'], 'does not support option', 'arbitrary option');

assert.throws(
  () => buildTaskReadProjection(parseTaskReadProjectionOptions([
    '--cwd', repo, '--tasks', 'TASK-DOES-NOT-EXIST', '--summary'
  ])),
  (error: unknown) => {
    const err = error as { code?: string; message?: string };
    assert.equal(err.code, 'ATM_CLI_USAGE');
    assert.ok(String(err.message).includes('No ledger record'));
    return true;
  },
  'explicit selection of an unknown task id must fail closed'
);

// --- envelope ---------------------------------------------------------------
const result = runTasksReadProjection(['--cwd', repo, '--series', 'TASK-ZZZ', '--summary']);
assert.equal(result.ok, true);
assert.equal(result.command, 'tasks');
assert.equal(result.messages[0].code, 'ATM_TASKS_READ_PROJECTION_READY');
assert.equal((result.evidence as Record<string, { rowCount: number }>).projection.rowCount, 2);

// --- zero side effects ------------------------------------------------------
function snapshotAtm(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).slice().sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else entries.push(`${path.relative(root, full)}:${readFileSync(full, 'utf8').length}`);
    }
  };
  walk(path.join(root, '.atm'));
  return entries.sort().join('\n');
}

const before = snapshotAtm(repo);
buildTaskReadProjection(parseTaskReadProjectionOptions(['--cwd', repo, '--all', '--summary']));
runTasksReadProjection(['--cwd', repo, '--all', '--summary']);
assert.equal(snapshotAtm(repo), before, 'projection must not mutate .atm state');

// --- regression: existing audit envelope is untouched ------------------------
// The findings audit legitimately exits non-zero when the live repo has error-level
// findings; this regression asserts envelope shape and routing only, never repo health.
let auditJson: string;
try {
  auditJson = execFileSync(
    process.execPath,
    ['atm.mjs', 'tasks', 'audit', '--json'],
    {
      cwd: frameworkRepo,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
} catch (error) {
  const failure = error as { stdout?: string; stderr?: string };
  auditJson = String(failure.stdout || failure.stderr || '');
  assert.ok(auditJson.length > 0, 'tasks audit --json must emit a JSON envelope even when it fails');
}
const audit = JSON.parse(auditJson) as {
  command: string;
  evidence?: Record<string, unknown>;
  messages: { code: string; data?: { inspectedTaskCount?: number } }[];
};
assert.equal(audit.command, 'tasks');
assert.ok(
  audit.evidence && !('projection' in audit.evidence),
  'plain tasks audit --json must not emit a projection evidence block'
);
assert.ok(
  audit.messages.some((entry) => entry.code.startsWith('ATM_TASKS_AUDIT')),
  'plain tasks audit --json must still return the findings envelope'
);
assert.ok(
  audit.messages.every((entry) => entry.code !== 'ATM_TASKS_READ_PROJECTION_READY'),
  'plain tasks audit --json must not route to the projection surface'
);

rmSync(repo, { recursive: true, force: true });
console.log('tasks-audit-read-projection.test.ts: ok');
