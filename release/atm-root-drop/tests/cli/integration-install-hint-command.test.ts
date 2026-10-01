import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectIntegrationBootstrap, describeIntegrationInstallHint } from '../../packages/cli/src/commands/integration/bootstrap.ts';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';

// A freshly bootstrapped repository without any editor integration.
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-integration-hint-'));
try {
  await runBootstrap(['--cwd', cwd, '--json']);
  const hint = describeIntegrationInstallHint(inspectIntegrationBootstrap(cwd));
  assert.ok(hint, 'a bootstrapped repo without integrations gets an install hint');
  const requiredCommand = String((hint.data as Record<string, unknown>).requiredCommand);
  assert.match(requiredCommand, /^node atm\.mjs integration add \S+ --json$/, 'the hint names one runnable install command');
  assert.ok(hint.text.includes(requiredCommand), 'the hint text itself tells the agent which command to run');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: the integration install hint names a runnable command');
