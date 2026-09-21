import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../../packages/cli/src/commands/doctor/run-doctor.ts';
import { checkIntegrationHealth } from '../../packages/cli/src/commands/integration/health.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-doctor-fast-health-'));
try {
  const health = await checkIntegrationHealth(root, { sourceParity: 'deferred' });
  assert.equal(health.ok, true);
  assert.equal(health.sourceParity, 'deferred');

  const result = await runDoctor(['--cwd', root]);
  const checks = (result.evidence as any).checks as Array<Record<string, unknown>>;
  const integration = checks.find((check) => check.name === 'integration-adapters');
  assert(integration, 'doctor must expose the integration adapter check');
  assert.equal((integration.details as any).sourceParity, 'deferred');
  console.log('[doctor-integration-fast-health.test] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
