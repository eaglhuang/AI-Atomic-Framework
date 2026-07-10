/**
 * TASK-RFT-0012 spec — import-orchestrator surface smoke test.
 *
 * Branches exercised via CliError code:
 *   - fresh-open (missing --from)
 *   - drift (both --dry-run and --write set)
 *   - reset-open (reset-open without emergency approval → classification path)
 *   - emergency-lease (--force without approval)
 */
import { runTasksImport } from '../import-orchestrator.ts';
import { CliError } from '../../shared.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fail(message: string): never {
  console.error(`[import-orchestrator.spec] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

assert(typeof runTasksImport === 'function', 'runTasksImport export must be a function');
assert(runTasksImport.constructor.name === 'AsyncFunction', 'runTasksImport must be async');

async function expectCliError(argv: string[], branch: string): Promise<void> {
  try {
    await runTasksImport(argv);
    fail(`branch ${branch}: expected CliError, got success`);
  } catch (err) {
    if (!(err instanceof CliError)) {
      fail(`branch ${branch}: expected CliError, got ${err instanceof Error ? err.constructor.name : typeof err}`);
    }
  }
}

// fresh-open branch: missing --from is a usage error
await expectCliError(['--dry-run'], 'fresh-open');
// drift branch: both --dry-run and --write are contradictory
await expectCliError(['--from', 'docs/plan.md', '--dry-run', '--write'], 'drift');
// reset-open branch: --write --reset-open triggers classification/emergency path
await expectCliError(['--from', 'docs/nonexistent-plan.md', '--write', '--reset-open'], 'reset-open');
// emergency-lease branch: --force without approval token
await expectCliError(['--from', 'docs/nonexistent-plan.md', '--write', '--force'], 'emergency-lease');

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-import-orchestrator-'));
try {
  writeJson(path.join(tempRoot, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  const taskId = 'TASK-IMPORT-077';
  const planPath = path.join(tempRoot, 'docs/tasks/TASK-IMPORT-077.task.md');
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, [
    '---',
    `task_id: ${taskId}`,
    'title: Reconcile mirror fixture',
    'status: done',
    'planning_repo: PlanningRepo',
    'target_repo: TargetRepo',
    'closure_authority: target-repo',
    'deliverables:',
    '  - src/new.ts',
    '---',
    `# ${taskId}`,
    ''
  ].join('\n'), 'utf8');
  const taskPath = path.join(tempRoot, '.atm/history/tasks', `${taskId}.json`);
  writeJson(taskPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Existing done fixture',
    status: 'done',
    closedAt: '2026-07-10T00:00:00.000Z',
    closedByActor: 'validator',
    closurePacket: '.atm/history/evidence/TASK-IMPORT-077.closure-packet.json',
    source: { planPath: 'docs/tasks/old.task.md', hash: 'old-hash' },
    importedAt: '2026-07-09T00:00:00.000Z'
  });

  const result = await runTasksImport(['--cwd', tempRoot, '--from', planPath, '--write', '--reconcile-mirror', '--json']);
  assert(result.ok === true, 'reconcile-mirror import must succeed for done task');
  const updated = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, any>;
  assert(updated.status === 'done', 'reconcile-mirror must preserve done status');
  assert(updated.closedAt === '2026-07-10T00:00:00.000Z', 'reconcile-mirror must preserve closedAt');
  assert(updated.closedByActor === 'validator', 'reconcile-mirror must preserve closedByActor');
  assert(updated.closurePacket === '.atm/history/evidence/TASK-IMPORT-077.closure-packet.json', 'reconcile-mirror must preserve closurePacket');
  assert(updated.source.planPath === 'docs/tasks/TASK-IMPORT-077.task.md', 'reconcile-mirror must refresh source planPath');
  assert(updated.planningRepo === 'PlanningRepo', 'reconcile-mirror must refresh planningRepo');
  assert(updated.targetRepo === 'TargetRepo', 'reconcile-mirror must refresh targetRepo');
  const eventDir = path.join(tempRoot, '.atm/history/task-events', taskId);
  assert(existsSync(eventDir), 'reconcile-mirror must write a transition event');
  const eventText = readFileSync(path.join(eventDir, readdirFirstJson(eventDir)), 'utf8');
  assert(eventText.includes('planning-mirror-reconcile'), 'transition event must identify mirror-only reconcile action');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function readdirFirstJson(directory: string): string {
  return readdirSync(directory).find((entry) => entry.endsWith('.json')) ?? fail('expected transition event json');
}

console.log('[import-orchestrator.spec] ok (4 branches + reconcile-mirror)');
