import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRoute } from '../../packages/cli/src/commands/route.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-route-freeze-runtime');

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const routeId = 'route-TASK-MAO-0046-cursor-gpt-5.2';
  const open = await runRoute([
    'open',
    '--cwd', tempDir,
    '--route-id', routeId,
    '--task', 'TASK-MAO-0046',
    '--actor', 'cursor-gpt-5.2',
    '--claim-intent', 'write',
    '--write-set', 'packages/cli/src/commands/route.ts'
  ]);
  assert.equal(open.ok, true);

  const paused = await runRoute([
    'pause',
    '--cwd', tempDir,
    '--route', routeId,
    '--actor', 'cursor-gpt-5.2',
    '--reason', 'conflict review'
  ]);
  assert.equal(paused.ok, true);

  const freezeEvidence = paused.evidence.freezeProtocol as {
    signal: { freezeId: string; taskId: string; blockingRoute?: string };
    ack: { freezeId: string; acknowledgedAt: string };
    resolution: { decision: { state: string }; forceRelease: boolean };
  };
  assert.ok(freezeEvidence, 'pause must expose freezeProtocol evidence');
  assert.equal(freezeEvidence.signal.taskId, 'TASK-MAO-0046');
  assert.equal(freezeEvidence.signal.blockingRoute, routeId);
  assert.equal(freezeEvidence.ack.freezeId, freezeEvidence.signal.freezeId);
  assert.equal(freezeEvidence.resolution.decision.state, 'acknowledged');
  assert.equal(freezeEvidence.resolution.forceRelease, false);

  const freezePath = path.join(tempDir, '.atm', 'runtime', 'routes', `${routeId}.freeze.json`);
  assert.equal(existsSync(freezePath), true, 'pause must persist freeze protocol sidecar');

  const resumed = await runRoute([
    'resume',
    '--cwd', tempDir,
    '--route', routeId,
    '--actor', 'cursor-gpt-5.2',
    '--admission-rechecked'
  ]);
  assert.equal(resumed.ok, true);

  const resumeEvidence = resumed.evidence.freezeProtocol as {
    resume: { decision: { state: string }; requireAdmissionRecheck?: boolean };
  };
  assert.ok(resumeEvidence?.resume, 'resume must expose freezeProtocol.resume');
  assert.equal(resumeEvidence.resume.decision.state, 'resumed');
  assert.equal(resumeEvidence.resume.requireAdmissionRecheck, false);
  assert.equal(existsSync(freezePath), false, 'resume must clear freeze protocol sidecar');

  const routeRecord = JSON.parse(readFileSync(path.join(tempDir, '.atm', 'runtime', 'routes', `${routeId}.json`), 'utf8'));
  assert.equal(routeRecord.state, 'open');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[route-freeze-runtime:cli-test] ok (pause/resume exercises freeze protocol)');
