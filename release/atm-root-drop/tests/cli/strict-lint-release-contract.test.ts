import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const releaseGateSources = [
  'packages/cli/src/commands/next.ts',
  'packages/cli/src/commands/next/claim-orchestration.ts',
  'packages/cli/src/commands/tasks/claim-orchestrator.ts',
  'packages/cli/src/commands/tasks/close-orchestrator/close-result.ts',
  'packages/cli/src/commands/tasks/close-orchestrator/close-write.ts',
  'packages/cli/src/commands/tasks/close-orchestrator/closure-packet.ts',
  'packages/cli/src/commands/tasks/release-wip-transaction.ts',
  'packages/cli/src/commands/team-knowledge/ranking.ts',
  'packages/cli/src/commands/team/cost-command.ts',
  'packages/cli/src/commands/team/legacy/broker-observability.ts',
  'packages/cli/src/commands/team/legacy/handoff-handler.ts',
  'packages/cli/src/commands/team/legacy/team-run-runtime.ts',
  'packages/core/src/broker/lifecycle.ts',
  'packages/core/src/evidence/validator-lifecycle.ts'
];

for (const relativePath of releaseGateSources) {
  const source = readFileSync(path.join(root, relativePath), 'utf8');
  assert.doesNotMatch(
    source,
    /\bany\b/,
    `${relativePath} must preserve the strict release-lint boundary`
  );
}

console.log('[strict-lint-release-contract] ok');
