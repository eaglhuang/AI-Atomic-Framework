import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildResidueReconcileReport } from '../../residue.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath: string, text: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function git(cwd: string, args: readonly string[]) {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-close-crash-matrix-'));
git(repo, ['init']);
git(repo, ['config', 'user.email', 'crash@example.invalid']);
git(repo, ['config', 'user.name', 'ATM Crash Matrix']);
git(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);

const abandonedTaskId = 'TASK-ABANDONED-0001';
writeJson(path.join(repo, `.atm/history/tasks/${abandonedTaskId}.json`), {
  workItemId: abandonedTaskId,
  status: 'abandoned'
});
writeJson(path.join(repo, `.atm/history/task-events/${abandonedTaskId}/audit.json`), {
  schemaId: 'atm.taskTransition.v1',
  taskId: abandonedTaskId,
  action: 'audit'
});
git(repo, ['add', `.atm/history/task-events/${abandonedTaskId}/audit.json`]);

const stagedReport = buildResidueReconcileReport(repo, true);
const stagedAudit = stagedReport.statusReport.entries.find((entry) =>
  entry.path === `.atm/history/task-events/${abandonedTaskId}/audit.json`
);
assert.equal(stagedAudit?.indexState, 'staged');
assert.equal(stagedAudit?.recommendedAction, 'manual-review', 'staged audit evidence must not be auto-cleaned');
assert.equal(
  existsSync(path.join(repo, `.atm/history/task-events/${abandonedTaskId}/audit.json`)),
  true,
  'staged audit evidence must remain on disk'
);

const runtimeResidue = path.join(repo, '.atm/runtime/broker-conflict-resolutions/BCR-crash.json');
writeJson(runtimeResidue, { schemaId: 'atm.brokerConflictResolution.v1' });
const runtimeReport = buildResidueReconcileReport(repo, true);
const runtimeAction = runtimeReport.actions.find((entry) => entry.path === '.atm/runtime/broker-conflict-resolutions/BCR-crash.json');
assert.equal(runtimeAction?.applied, true);
assert.equal(runtimeAction?.attempts, 1);
assert.equal(runtimeAction?.failureCode, null);
assert.equal(existsSync(runtimeResidue), false, 'safe runtime residue should be removed');

const residueSource = readFileSync(path.resolve('packages/cli/src/commands/residue.ts'), 'utf8');
assert.match(residueSource, /RESIDUE_REMOVE_MAX_ATTEMPTS\s*=\s*3/);
assert.match(residueSource, /EPERM/);
assert.match(residueSource, /EBUSY/);
assert.match(residueSource, /ENOTEMPTY/);
