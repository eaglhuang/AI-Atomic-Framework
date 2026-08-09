import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  frameworkTempPublicationCapabilityCovers,
  resolveFrameworkTempPublicationCapability,
} from '../../framework-development/framework-temp-publication-capability.ts';
import { evaluateTaskWorkAdmissionGate } from '../work-admission-check.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-temp-publication-'));
const taskId = 'ATM-FRAMEWORK-TEMP-publication';
const now = '2026-08-09T14:53:00.000Z';
mkdirSync(path.join(cwd, '.atm', 'runtime', 'locks'), { recursive: true });
mkdirSync(path.join(cwd, 'release', 'atm-root-drop'), { recursive: true });
writeFileSync(path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`), `${JSON.stringify({
  workItemId: taskId,
  actorId: 'publication-steward',
  heartbeatAt: '2026-08-09T14:52:53.900Z',
  ttlSeconds: 3600,
  laneSessionId: 'lane-publication',
  files: ['release/atm-onefile/atm.mjs', 'release/atm-root-drop'],
}, null, 2)}\n`, 'utf8');

const capability = resolveFrameworkTempPublicationCapability({
  cwd,
  taskId,
  actorId: 'publication-steward',
  now: Date.parse(now),
});
assert.equal(capability?.laneSessionId, 'lane-publication');
assert.equal(frameworkTempPublicationCapabilityCovers(capability, [
  'release/atm-onefile/atm.mjs',
  'release/atm-root-drop/atm.mjs',
]), true);
assert.equal(frameworkTempPublicationCapabilityCovers(capability, ['packages/core/src/outside.ts']), false);

const admitted = evaluateTaskWorkAdmissionGate({
  cwd,
  taskId,
  operation: 'commit',
  files: ['release/atm-onefile/atm.mjs'],
  producingAtmCommand: 'node atm.mjs git commit',
  now,
});
assert.equal(admitted.decision.ok, true);
assert.equal(admitted.receipt?.actorId, 'publication-steward');

const expired = resolveFrameworkTempPublicationCapability({
  cwd,
  taskId,
  actorId: 'publication-steward',
  now: Date.parse('2026-08-09T16:00:00.000Z'),
});
assert.equal(expired, null);
console.log('framework-temp-publication-capability: ok');
