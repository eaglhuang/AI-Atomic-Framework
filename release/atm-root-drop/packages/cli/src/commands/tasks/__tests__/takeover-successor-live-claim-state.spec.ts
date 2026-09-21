import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readRepo(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

const orchestrator = readRepo('packages/cli/src/commands/tasks/claim-orchestrator.ts');
const takeoverEvidence = readRepo('packages/cli/src/commands/tasks/takeover-evidence.ts');
const governanceCommands = readRepo('scripts/validate-governance-commands/implementation.ts');

assert.match(
  orchestrator,
  /`taken_over` belongs in[\s\S]*transition\/evidence history/,
  'takeover must document that taken_over is history, not live claim.state'
);
assert.match(
  orchestrator,
  /consumers[\s\S]*treat only `active` as live authority/,
  'takeover must keep successor live authority on claim.state === active'
);
assert.equal(
  /takeoverClaim[\s\S]{0,400}state:\s*['"]taken_over['"]/.test(orchestrator),
  false,
  'takeover must not assign taken_over onto the successor live claim record'
);
assert.match(
  takeoverEvidence,
  /action:\s*['"]takeover['"]/,
  'takeover evidence must record action takeover'
);

assert.equal(
  /claim\?\.state === ['"]taken_over['"]/.test(governanceCommands),
  false,
  'declared governance-commands validator must not require successor claim.state === taken_over'
);
assert.match(
  governanceCommands,
  /claim\?\.state === ['"]active['"]/,
  'declared governance-commands validator must require successor claim.state === active'
);
assert.match(
  governanceCommands,
  /action['"]:\s*['"]takeover['"]|action === ['"]takeover['"]|includes\(['"]takeover['"]\)/,
  'declared governance-commands validator must observe takeover in transition or evidence'
);

console.log('[takeover-successor-live-claim-state] ok');
