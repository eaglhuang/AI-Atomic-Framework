import assert from 'node:assert/strict';
import { buildAtomMapProjectionScopeDiagnostic } from '../../packages/cli/src/commands/tasks/task-import-validators.ts';

const projection = 'atomic_workbench/atomization-coverage/path-to-atom-map.json';
const ownerShard = 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json';

const warning = buildAtomMapProjectionScopeDiagnostic({ taskId: 'TASK-AAO-0158', declaredFiles: [projection] });
assert.equal(warning?.code, 'ATM_TASK_IMPORT_GENERATED_ATOM_MAP_PROJECTION_ONLY');
assert.match(warning?.text ?? '', /write-projection/);

assert.equal(buildAtomMapProjectionScopeDiagnostic({ taskId: 'TASK-AAO-0158', declaredFiles: [projection, ownerShard] }), null);
assert.equal(buildAtomMapProjectionScopeDiagnostic({ taskId: 'TASK-AAO-0158', declaredFiles: [ownerShard] }), null);
assert.equal(buildAtomMapProjectionScopeDiagnostic({ taskId: 'TASK-AAO-0158', declaredFiles: ['docs/notes.md'] }), null);

console.log('[task-import-atom-map-projection-warning] ok');
