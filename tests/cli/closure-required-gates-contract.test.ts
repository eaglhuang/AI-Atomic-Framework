import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const closeOrchestratorSource = readFileSync(
  path.join(root, 'packages/cli/src/commands/tasks/close-orchestrator.ts'),
  'utf8'
);

assert(
  closeOrchestratorSource.includes('requiredValidationPassesForClosure(frameworkStatus.requiredGates, closePacketChangedFiles)'),
  'tasks close closure-packet required gates must use the same changed-file filter as pre-close validator classification'
);

console.log('[closure-required-gates-contract:test] ok');
