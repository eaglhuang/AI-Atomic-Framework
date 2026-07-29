import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyProtectedEvidenceBundle, inspectProtectedAtmStateChanges } from '../../packages/cli/src/commands/hook/pre-commit/support.ts';

function sha256(value: string): string { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }

function writeJson(root: string, relativePath: string, value: unknown): void {
  const target = path.join(root, relativePath); mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function taskBundle(taskId: string, includeLedger: boolean, includeEvent: boolean): { root: string; staged: string[] } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-precommit-evidence-'));
  const evidencePath = `.atm/history/evidence/${taskId}.historical-work-admission-attestations.json`;
  writeJson(root, evidencePath, { schemaId: 'atm.historicalWorkAdmissionAttestationLedger.v1', attestations: [{ taskId }] });
  const staged = [evidencePath];
  const transitionId = 'renew-fixture'; const ledgerPath = `.atm/history/tasks/${taskId}.json`;
  if (includeLedger) {
    const ledger = { schemaId: 'atm.workItem.v0.2', workItemId: taskId, lastTransitionId: transitionId };
    writeJson(root, ledgerPath, ledger); staged.push(ledgerPath);
    if (includeEvent) {
      const ledgerBytes = JSON.stringify(ledger, null, 2) + '\n';
      const eventPath = `.atm/history/task-events/${taskId}/${transitionId}.json`;
      writeJson(root, eventPath, { schemaId: 'atm.taskTransition.v1', transitionId, taskId, taskPath: ledgerPath, taskSha256: sha256(ledgerBytes), command: 'node atm.mjs tasks renew' });
      staged.push(eventPath);
    }
  } else if (includeEvent) {
    const eventPath = `.atm/history/task-events/${taskId}/${transitionId}.json`;
    writeJson(root, eventPath, { schemaId: 'atm.taskTransition.v1', transitionId, taskId, taskPath: ledgerPath, taskSha256: 'sha256:fixture', command: 'node atm.mjs tasks renew' });
    staged.push(eventPath);
  }
  return { root, staged };
}

function appendTaskBundle(root: string, taskId: string): string[] {
  const transitionId = 'renew-fixture'; const ledgerPath = `.atm/history/tasks/${taskId}.json`;
  const ledger = { schemaId: 'atm.workItem.v0.2', workItemId: taskId, lastTransitionId: transitionId };
  writeJson(root, `.atm/history/evidence/${taskId}.historical-work-admission-attestations.json`, { attestations: [{ taskId }] });
  writeJson(root, ledgerPath, ledger);
  const eventPath = `.atm/history/task-events/${taskId}/${transitionId}.json`;
  writeJson(root, eventPath, { schemaId: 'atm.taskTransition.v1', transitionId, taskId, taskPath: ledgerPath, taskSha256: sha256(JSON.stringify(ledger, null, 2) + '\n'), command: 'node atm.mjs tasks renew' });
  return [`.atm/history/evidence/${taskId}.historical-work-admission-attestations.json`, ledgerPath, eventPath];
}

{
  const fixture = taskBundle('TASK-GIT-0024', true, true);
  const decision = classifyProtectedEvidenceBundle(fixture.root, fixture.staged).decisions.get('.atm/history/evidence/task-git-0024.historical-work-admission-attestations.json');
  assert.deepEqual(decision, { ok: true, taskId: 'TASK-GIT-0024', reason: null });
  assert.equal(inspectProtectedAtmStateChanges(fixture.root, fixture.staged).ok, true);
}

{
  const fixture = taskBundle('TASK-GIT-0024', false, false);
  assert.equal(inspectProtectedAtmStateChanges(fixture.root, fixture.staged).ok, false);
}

{
  const fixture = taskBundle('TASK-GIT-0024', false, true);
  assert.equal(inspectProtectedAtmStateChanges(fixture.root, fixture.staged).ok, true);
}

{
  const fixture = taskBundle('TASK-GIT-0024', true, true);
  const combined = [...fixture.staged, ...appendTaskBundle(fixture.root, 'TASK-GIT-0099')];
  assert.equal(inspectProtectedAtmStateChanges(fixture.root, combined).ok, false);
}

console.log('pre-commit-evidence-context-parity: ok');
