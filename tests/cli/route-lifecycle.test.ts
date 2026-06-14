import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRoute } from '../../packages/cli/src/commands/route.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-route-lifecycle');

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const routeId = 'route-TASK-MAO-0003-captain';
  const open = await runRoute([
    'open',
    '--cwd', tempDir,
    '--route-id', routeId,
    '--task', 'TASK-MAO-0003',
    '--actor', 'captain',
    '--claim-intent', 'write',
    '--read-set', 'docs/specs/mao-logical-routing-v1.md',
    '--write-set', 'packages/cli/src/commands/route.ts,tests/cli/route-lifecycle.test.ts',
    '--atom-cids', 'cid:atm.mao-route-cli-map',
    '--virtual-atom-cids', 'vcid:atm.route.lifecycle'
  ]);
  assert.equal(open.ok, true);
  assert.equal(open.evidence.action, 'open');
  assert.equal(readRouteEvidence(open).route.routeId, routeId);

  const routePath = path.join(tempDir, '.atm', 'runtime', 'routes', `${routeId}.json`);
  assert.equal(existsSync(routePath), true, 'route open must write runtime route context');
  assert.equal(existsSync(path.join(tempDir, '.atm', 'history', 'tasks', 'TASK-MAO-0003.json')), false, 'route open must not mutate task ledger');

  const status = await runRoute(['status', '--cwd', tempDir, '--route', routeId]);
  assert.equal(status.ok, true);
  assert.equal(readRouteEvidence(status).route.state, 'open');

  const list = await runRoute(['list', '--cwd', tempDir]);
  assert.equal(list.ok, true);
  assert.equal((list.evidence.routes as unknown[]).length, 1);

  const paused = await runRoute(['pause', '--cwd', tempDir, '--route', routeId, '--actor', 'captain', '--reason', 'review requested']);
  assert.equal(paused.ok, true);
  assert.equal(readRouteEvidence(paused).route.state, 'frozen');
  assert.equal(readRouteEvidence(paused).route.admission?.verdict, 'freeze');

  const resumed = await runRoute(['resume', '--cwd', tempDir, '--route', routeId, '--actor', 'captain']);
  assert.equal(resumed.ok, true);
  assert.equal(readRouteEvidence(resumed).route.state, 'open');

  const abandoned = await runRoute(['abandon', '--cwd', tempDir, '--route', routeId, '--actor', 'captain', '--reason', 'superseded']);
  assert.equal(abandoned.ok, true);
  assert.equal(readRouteEvidence(abandoned).route.state, 'abandoned');
  assert.equal(JSON.parse(readFileSync(routePath, 'utf8')).state, 'abandoned');
  assert.equal(existsSync(path.join(tempDir, '.atm', 'history', 'tasks')), false, 'route lifecycle must not create task history');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('[route-lifecycle:cli-test] ok (open/status/list/pause/resume/abandon)');

function readRouteEvidence(result: { evidence: Record<string, unknown> }) {
  return result.evidence as {
    route: {
      routeId: string;
      state: string;
      admission?: {
        verdict: string;
      };
    };
  };
}
