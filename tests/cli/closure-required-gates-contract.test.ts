import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const missingReportSource = readFileSync(
  path.join(root, 'packages/cli/src/commands/evidence/missing-report.ts'),
  'utf8'
);
const closurePacketSource = readFileSync(
  path.join(root, 'packages/cli/src/commands/tasks/close-orchestrator/closure-packet.ts'),
  'utf8'
);

assert(
  missingReportSource.includes('const closureRequired = taskDeclaredValidators.includes(gate);'),
  'pre-close must require only task-card declared validators'
);
assert(
  !missingReportSource.includes('writeRequiredSet'),
  'pre-close must not import unrelated framework-wide closure gates'
);
assert(
  closurePacketSource.includes('const taskRequiredGates = Array.isArray(taskDocument.validators)'),
  'closure packet must derive required gates from the task validation contract'
);
assert(
  closurePacketSource.includes(': taskRequiredGates,'),
  'closure packet must preserve the exact task-required gate set'
);
assert(
  !closurePacketSource.includes('requiredValidationPassesForClosure'),
  'ordinary task close must not substitute framework-wide gates for its declared contract'
);

console.log('[closure-required-gates-contract:test] ok');
