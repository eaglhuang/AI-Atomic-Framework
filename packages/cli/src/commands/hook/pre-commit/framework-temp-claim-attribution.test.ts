import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasLiveFrameworkTempClaimAttribution } from './framework-temp-claim-attribution.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-attribution-'));
const taskId = 'ATM-FRAMEWORK-TEMP-agent-one';
const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
mkdirSync(path.dirname(lockPath), { recursive: true });
writeFileSync(lockPath, JSON.stringify({ workItemId: taskId, actorId: 'agent-one', heartbeatAt: '2026-08-09T00:00:00.000Z', ttlSeconds: 60 }), 'utf8');
assert.equal(hasLiveFrameworkTempClaimAttribution({ cwd, actorId: 'agent-one', taskId, now: Date.parse('2026-08-09T00:00:30.000Z') }), true);
assert.equal(hasLiveFrameworkTempClaimAttribution({ cwd, actorId: 'other', taskId, now: Date.parse('2026-08-09T00:00:30.000Z') }), false);
assert.equal(hasLiveFrameworkTempClaimAttribution({ cwd, actorId: 'agent-one', taskId, now: Date.parse('2026-08-09T00:01:01.000Z') }), false);
console.log('framework-temp-claim-attribution: ok');
