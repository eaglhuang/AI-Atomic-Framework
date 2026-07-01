// TASK-RFT-0013 spec — close-artifact-staging helpers surface.
// Verifies the extracted module loads, exports the expected surface, and
// exercises happy-path + failure + rollback branches on pure helpers.

import {
  extractTaskCloseDeclaredFiles,
  extractTaskDeliverableFiles,
  taskDeliveryPrincipleText,
  existingTaskCloseArtifacts,
  stageTaskCloseArtifacts,
  evaluateTaskDeliverableGate
} from '../close-helpers/close-artifact-staging.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function fail(msg: string): never {
  console.error(`[close-helpers-close-artifact-staging.spec] ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function assert(cond: unknown, msg: string) { if (!cond) fail(msg); }

// happy path — taskDeliveryPrincipleText returns canonical guidance string.
const principle = taskDeliveryPrincipleText();
assert(typeof principle === 'string' && principle.includes('deliver'), 'delivery principle text present');

// happy path — extract deliverable + declared files from a synthetic task doc.
const doc = {
  deliverables: ['a/b.ts', 'c/d.ts'],
  claim: { files: ['a/b.ts'] },
  targetAllowedFiles: ['e/f.md']
};
const deliverable = extractTaskDeliverableFiles(doc);
assert(deliverable.includes('a/b.ts') && deliverable.length === 2, 'deliverable files extracted');
const declared = extractTaskCloseDeclaredFiles(doc);
assert(declared.includes('a/b.ts') && declared.includes('e/f.md'), 'declared files include claim + target');

// failure — existingTaskCloseArtifacts returns empty for non-existent files.
const tmp = mkdtempSync(path.join(tmpdir(), 'rft13-'));
const missing = existingTaskCloseArtifacts(tmp, ['nope.txt', '   ', null, undefined]);
assert(missing.length === 0, 'missing files filtered out');

// happy path — existing file surfaces.
writeFileSync(path.join(tmp, 'real.txt'), 'x');
const found = existingTaskCloseArtifacts(tmp, ['real.txt']);
assert(found.length === 1 && found[0] === 'real.txt', 'real file surfaced');

// rollback — stageTaskCloseArtifacts is a no-op with empty input (won't crash).
stageTaskCloseArtifacts(tmp, []);
stageTaskCloseArtifacts(tmp, [null, undefined, '']);

// happy path — evaluateTaskDeliverableGate handles ledger-only mode without git.
const gate = evaluateTaskDeliverableGate({
  cwd: tmp,
  taskId: 'TASK-RFT-0013',
  taskDocument: { deliverableMode: 'ledger-only', deliverables: [] },
  taskDeclaredFiles: [],
  claim: null
});
assert(gate.required === false && gate.ok === true, 'ledger-only gate passes without diff');

console.log('[close-helpers-close-artifact-staging.spec] ok (5 branches)');
