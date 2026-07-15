import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { discoverGovernedVendorConfigSurface } from '../../../packages/cli/src/commands/integration.ts';

export function runGovernedRepoVendorConfigValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'governed-repo-vendor-config') return false;
  const surface = discoverGovernedVendorConfigSurface(process.cwd());
  assert.equal(surface.exists, true);
  assert.ok(surface.rootDir.endsWith(path.join('agent-integrations', 'vendors')));
  assert.ok(surface.templateReadme.endsWith(path.join('agent-integrations', 'vendors', 'README.md')));
  const selfHosting = readFileSync(path.join(process.cwd(), 'docs', 'SELF_HOSTING_ALPHA.md'), 'utf8');
  assert.ok(selfHosting.includes('agent-integrations/vendors'));
  console.log('[validate-team-agents] ok (governed-repo-vendor-config)');
  return true;
}
