import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const closePacketSource = readFileSync(
  path.join(root, 'packages/cli/src/commands/tasks/close-orchestrator/closure-packet.ts'),
  'utf8'
);
const taskflowSource = readFileSync(
  path.join(root, 'packages/cli/src/commands/taskflow/implementation.ts'),
  'utf8'
);

assert(
  closePacketSource.includes("from './acceptance-evidence-gate.ts'")
    && closePacketSource.includes('assertAcceptanceEvidenceClosureGate({ taskId: options.taskId, taskDocument })'),
  'closure packet preparation must call the shared acceptance evidence gate before close write can create a packet'
);

assert(
  !taskflowSource.includes('acceptanceEvidenceObservations')
    && !taskflowSource.includes('evaluateAcceptanceEvidenceMap'),
  'taskflow close must not grow a second acceptance evidence algorithm; it should route through close-orchestrator closure packet preparation'
);

console.log('[taskflow-close-readiness-parity:test] ok');
