import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateTaskWorkAdmissionGate } from '../work-admission-check.ts';
import {
  frameworkTempPublicationCapabilityCovers,
  resolveFrameworkTempPublicationCapability,
} from '../../framework-development/framework-temp-publication-capability.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-temp-admission-'));
const taskId = 'ATM-FRAMEWORK-TEMP-validator';
mkdirSync(path.join(cwd, '.atm', 'runtime', 'locks'), { recursive: true });
writeFileSync(path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`), `${JSON.stringify({
  workItemId: taskId,
  actorId: 'validator',
  lockedAt: '2026-08-09T14:52:53.900Z',
  heartbeatAt: '2026-08-09T14:52:53.900Z',
  ttlSeconds: 3600,
  files: ['packages/cli/src/example.ts']
}, null, 2)}\n`, 'utf8');

const capability = resolveFrameworkTempPublicationCapability({
  cwd,
  taskId,
  actorId: 'validator',
  now: Date.parse('2026-08-09T14:53:00.000Z'),
});
assert.equal(capability?.taskId, taskId);
assert.equal(frameworkTempPublicationCapabilityCovers(capability, ['packages/cli/src/example.ts']), true);
assert.equal(frameworkTempPublicationCapabilityCovers(capability, ['packages/core/src/outside.ts']), false);
assert.equal(resolveFrameworkTempPublicationCapability({
  cwd,
  taskId,
  actorId: 'other-actor',
  now: Date.parse('2026-08-09T14:53:00.000Z'),
}), null);

const admitted = evaluateTaskWorkAdmissionGate({
  cwd,
  taskId,
  operation: 'commit',
  files: ['packages/cli/src/example.ts'],
  producingAtmCommand: 'node atm.mjs git commit',
  now: '2026-08-09T14:53:00.000Z'
});
assert.equal(admitted.decision.ok, true);
assert.equal(admitted.receipt?.actorId, 'validator');

const deniedOutsideScope = evaluateTaskWorkAdmissionGate({
  cwd,
  taskId,
  operation: 'commit',
  files: ['packages/core/src/outside.ts'],
  producingAtmCommand: 'node atm.mjs git commit',
  now: '2026-08-09T14:53:00.000Z'
});
assert.equal(deniedOutsideScope.decision.ok, false);
console.log('work-admission-check: ok');
