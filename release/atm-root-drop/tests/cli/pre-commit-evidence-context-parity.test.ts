import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

function stageAll(root: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
}

function taskBundle(taskId: string, includeLedger: boolean, includeEvent: boolean): { root: string; staged: string[] } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-precommit-evidence-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' });
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
  stageAll(root); return { root, staged };
}

function appendTaskBundle(root: string, taskId: string): string[] {
  const transitionId = 'renew-fixture'; const ledgerPath = `.atm/history/tasks/${taskId}.json`;
  const ledger = { schemaId: 'atm.workItem.v0.2', workItemId: taskId, lastTransitionId: transitionId };
  writeJson(root, `.atm/history/evidence/${taskId}.historical-work-admission-attestations.json`, { attestations: [{ taskId }] });
  writeJson(root, ledgerPath, ledger);
  const eventPath = `.atm/history/task-events/${taskId}/${transitionId}.json`;
  writeJson(root, eventPath, { schemaId: 'atm.taskTransition.v1', transitionId, taskId, taskPath: ledgerPath, taskSha256: sha256(JSON.stringify(ledger, null, 2) + '\n'), command: 'node atm.mjs tasks renew' });
  stageAll(root); return [`.atm/history/evidence/${taskId}.historical-work-admission-attestations.json`, ledgerPath, eventPath];
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

{
  const fixture = taskBundle('ATM-GOV-0328', true, true);
  const taskId = 'ATM-FRAMEWORK-TEMP-captain';
  const receiptPath = `.atm/history/evidence/${taskId}.runner-sync-receipt.json`;
  writeJson(fixture.root, receiptPath, { schemaId: 'atm.runnerSyncReceipt.v1', taskId, actorId: 'captain', outputInventory: { entries: [] } });
  writeJson(fixture.root, `.atm/runtime/locks/${taskId}.lock.json`, { workItemId: taskId, actorId: 'captain', heartbeatAt: new Date().toISOString(), ttlSeconds: 3600, files: [receiptPath] });
  stageAll(fixture.root);
  const decision = classifyProtectedEvidenceBundle(fixture.root, [...fixture.staged, receiptPath]).decisions.get(receiptPath.toLowerCase());
  assert.deepEqual(decision, { ok: true, taskId, reason: null });
}

{
  const fixture = taskBundle('ATM-GOV-0328', true, true);
  const taskId = 'ATM-FRAMEWORK-TEMP-publication-steward';
  const takeoverPath = `.atm/history/evidence/${taskId}.runner-publication-takeover.json`;
  writeJson(fixture.root, takeoverPath, {
    schemaId: 'atm.runnerPublicationTakeoverPlan.v1', taskId,
    sealedSourceSha: 'a'.repeat(40), snapshotDigest: `sha256:${'b'.repeat(64)}`,
    digest: `sha256:${'c'.repeat(64)}`,
    entries: [{ path: 'release/atm-onefile/atm.mjs', observedDigest: `sha256:${'d'.repeat(64)}` }]
  });
  writeJson(fixture.root, `.atm/runtime/locks/${taskId}.lock.json`, {
    workItemId: taskId, actorId: 'publication-steward', heartbeatAt: new Date().toISOString(), ttlSeconds: 3600, files: [takeoverPath]
  });
  stageAll(fixture.root);
  const decision = classifyProtectedEvidenceBundle(fixture.root, [...fixture.staged, takeoverPath]).decisions.get(takeoverPath.toLowerCase());
  assert.deepEqual(decision, { ok: true, taskId, reason: null }, 'an active lock may commit its exact, structurally complete broker takeover plan without inventing a task ledger');
}

{
  const fixture = taskBundle('ATM-GOV-0328', true, true);
  const taskId = 'ATM-FRAMEWORK-TEMP-expired-publication-steward';
  const takeoverPath = `.atm/history/evidence/${taskId}.runner-publication-takeover.json`;
  writeJson(fixture.root, takeoverPath, {
    schemaId: 'atm.runnerPublicationTakeoverPlan.v1', taskId,
    sealedSourceSha: 'a'.repeat(40), snapshotDigest: `sha256:${'b'.repeat(64)}`,
    digest: `sha256:${'c'.repeat(64)}`,
    entries: [{ path: 'release/atm-onefile/atm.mjs', observedDigest: `sha256:${'d'.repeat(64)}` }]
  });
  writeJson(fixture.root, `.atm/runtime/locks/${taskId}.lock.json`, {
    workItemId: taskId, actorId: 'publication-steward', heartbeatAt: new Date(Date.now() - 7_200_000).toISOString(), ttlSeconds: 60, files: [takeoverPath]
  });
  stageAll(fixture.root);
  const decision = classifyProtectedEvidenceBundle(fixture.root, [...fixture.staged, takeoverPath]).decisions.get(takeoverPath.toLowerCase());
  assert.equal(decision?.ok, false, 'an expired lock must not manufacture protected evidence context');
}

{
  const fixture = taskBundle('TASK-RUNNER-0005', true, true);
  const producerTaskId = 'ATM-FRAMEWORK-TEMP-producer';
  const closingReceiptPath = '.atm/history/evidence/TASK-RUNNER-0005.runner-sync-receipt.json';
  const producerReceiptPath = `.atm/history/evidence/${producerTaskId}.runner-sync-receipt.json`;
  const members = [producerTaskId];
  writeJson(fixture.root, closingReceiptPath, { schemaId: 'atm.runnerSyncReceipt.v1', taskId: 'TASK-RUNNER-0005', linkedTaskIds: ['TASK-RUNNER-0005'], memberTaskIds: members, groupManifest: { memberTaskIds: members }, childAttribution: { complete: true, members: [{ taskId: producerTaskId }] } });
  writeJson(fixture.root, producerReceiptPath, { schemaId: 'atm.runnerSyncReceipt.v1', taskId: producerTaskId, memberTaskIds: members });
  stageAll(fixture.root);
  assert.equal(inspectProtectedAtmStateChanges(fixture.root, [...fixture.staged, closingReceiptPath, producerReceiptPath]).ok, true, 'a sealed runner receipt may carry its explicitly attested temporary producer receipt in the same close bundle');
}

console.log('pre-commit-evidence-context-parity: ok');
