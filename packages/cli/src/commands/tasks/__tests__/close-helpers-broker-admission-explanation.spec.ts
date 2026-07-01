// TASK-RFT-0013 spec — broker-admission-explanation cluster.

import {
  buildBrokerAdmissionExplanation,
  explainBrokerAdapterForPath,
  hasUnexplainedSharedProjection
} from '../close-helpers/broker-admission-explanation.ts';

function fail(msg: string): never {
  console.error(`[close-helpers-broker-admission-explanation.spec] ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function assert(cond: unknown, msg: string) { if (!cond) fail(msg); }

// happy path — empty inputs produce a non-required explanation.
const empty = buildBrokerAdmissionExplanation({ overlappingFiles: [], overlappingAtomIds: [], sharedProjections: [] });
assert(empty.mutationIntentStatus === 'not-required', 'empty -> not-required');
assert(empty.confirmedConflict === false, 'confirmedConflict remains false');

// happy path — overlapping atom ids force missing intent.
const withAtoms = buildBrokerAdmissionExplanation({ overlappingFiles: [], overlappingAtomIds: ['atom-1'], sharedProjections: [] });
assert(withAtoms.mutationIntentStatus === 'missing', 'atoms -> missing intent');

// failure branch — projection file gets a projection-surface adapter explanation.
const projection = explainBrokerAdapterForPath('atomic_workbench/atomization-coverage/path-to-atom-map.json');
assert(projection.length === 1 && projection[0].conflictSurface === 'projection', 'projection classified');

// rollback / fallback — unknown extension gives no adapter explanation.
const unknown = explainBrokerAdapterForPath('foo/bar.baz');
assert(unknown.length === 0, 'unknown extension -> no adapter');

// hasUnexplainedSharedProjection — true when projection not covered by adapters.
const explanation = buildBrokerAdmissionExplanation({ overlappingFiles: [], overlappingAtomIds: [], sharedProjections: [] });
const hasUnexplained = hasUnexplainedSharedProjection(['some/projection.json'], explanation);
assert(hasUnexplained === true, 'unexplained projection detected');

console.log('[close-helpers-broker-admission-explanation.spec] ok (5 branches)');
