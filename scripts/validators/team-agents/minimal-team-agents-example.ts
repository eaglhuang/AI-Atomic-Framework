import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function runMinimalTeamAgentsExampleValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'minimal-team-agents-example') return false;

  const root = path.join(process.cwd(), 'examples', 'team-agents-minimal');
  const requiredFiles = [
    'README.md',
    'team-brief.md',
    'agent-report.md',
    'team-summary.md',
    'captain-decision.md',
    'team-memory-shard.md',
    'patrol-report.md',
    'QUICK_START_WALK_THROUGH.md'
  ];
  for (const file of requiredFiles) {
    assert.equal(existsSync(path.join(root, file)), true, `${file} should exist`);
  }
  assert.ok(readFileSync(path.join(root, 'team-brief.md'), 'utf8').includes('Team level: L1'));
  assert.ok(readFileSync(path.join(root, 'team-summary.md'), 'utf8').includes('decisionClass'));
  assert.ok(readFileSync(path.join(root, 'QUICK_START_WALK_THROUGH.md'), 'utf8').includes('90 minutes'));
  console.log('[validate-team-agents] ok (minimal-team-agents-example)');
  return true;
}
