import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClaimLifecycleOptions } from '../../packages/cli/src/commands/tasks/task-option-parsers/misc-claim-options.ts';

const parsed = parseClaimLifecycleOptions('claim', [
  '--task', 'TASK-ADOPT-0001',
  '--actor', 'captain',
  '--files', 'packages/cli/src/index.ts',
  '--adopt-unowned-wip'
]);
assert.equal(parsed.adoptUnownedWip, true, 'tasks claim must expose explicit unowned-WIP adoption');

const orchestrator = readFileSync('packages/cli/src/commands/tasks/claim-orchestrator.ts', 'utf8');
assert.match(orchestrator, /allowUnownedTaskScopedRecovery:\s*options\.adoptUnownedWip === true/);
assert.match(orchestrator, /claimDirtyWipAdmission/);
