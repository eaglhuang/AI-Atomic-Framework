import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assessCloseoutProvenanceGap,
  buildDependencyCloseoutBlocker,
  verifyCloseoutProvenance
} from '../closeout-provenance.ts';

function fail(message: string): never {
  console.error(`[closeout-provenance.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-closeout-provenance-'));

const manualDone = {
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: 'TASK-PROVENANCE-0001',
  status: 'done'
};
assert(!verifyCloseoutProvenance(repo, 'TASK-PROVENANCE-0001', manualDone), 'manual done without closure provenance must not be trusted');
const manualGap = assessCloseoutProvenanceGap(repo, 'TASK-PROVENANCE-0001', manualDone);
assert(manualGap.bucket === 'source-done-governance-incomplete', 'manual done must be classified as source-done governance incomplete');
assert(manualGap.missingSegments.includes('closure-packet'), 'manual done must report missing closure packet');
assert(manualGap.missingSegments.includes('close-transition-metadata'), 'manual done must report missing close transition metadata');

writeJson(path.join(repo, '.atm', 'history', 'evidence', 'TASK-PROVENANCE-0002.closure-packet.json'), {
  schemaId: 'atm.closurePacket.v1',
  taskId: 'TASK-PROVENANCE-0002'
});
const packetDone = {
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: 'TASK-PROVENANCE-0002',
  status: 'done',
  closurePacket: '.atm/history/evidence/TASK-PROVENANCE-0002.closure-packet.json'
};
assert(verifyCloseoutProvenance(repo, 'TASK-PROVENANCE-0002', packetDone), 'valid closure packet must satisfy closeout provenance');
assert(assessCloseoutProvenanceGap(repo, 'TASK-PROVENANCE-0002', packetDone).trusted === true, 'valid closure packet must produce a trusted gap report');

const transitionId = '2026-06-13T00-00-00-000Z-close-fixture';
writeJson(path.join(repo, '.atm', 'history', 'task-events', 'TASK-PROVENANCE-0003', `${transitionId}.json`), {
  schemaId: 'atm.taskTransition.v1',
  taskId: 'TASK-PROVENANCE-0003',
  transitionId,
  action: 'close',
  toStatus: 'done',
  closure: {
    schemaId: 'atm.taskClosureTransition.v1'
  }
});
const transitionDone = {
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: 'TASK-PROVENANCE-0003',
  status: 'done',
  lastTransitionId: transitionId
};
assert(verifyCloseoutProvenance(repo, 'TASK-PROVENANCE-0003', transitionDone), 'valid close transition metadata must satisfy closeout provenance');

const planningAuthority = {
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: 'TASK-PROVENANCE-0004',
  status: 'done',
  closureAuthority: 'planning_repo'
};
assert(verifyCloseoutProvenance(repo, 'TASK-PROVENANCE-0004', planningAuthority), 'planning_repo authority tasks must remain exempt from target closure packet enforcement');

const blocker = buildDependencyCloseoutBlocker(repo, 'TASK-PROVENANCE-0001', '.atm/history/tasks/TASK-PROVENANCE-0001.json', manualDone);
assert(blocker.status === 'source-done-governance-incomplete', 'dependency blocker must use the source-done governance incomplete status');
assert(String(blocker.requiredCommand).includes('tasks repair-closure'), 'manual done blocker must point to repair-closure');

console.log('[closeout-provenance.test] ok');
