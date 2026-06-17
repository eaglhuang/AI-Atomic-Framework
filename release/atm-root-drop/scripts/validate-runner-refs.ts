// TASK-MAO-0014: validate runner-ref store invariants. Exercises the publish
// primitive deterministically — version refs immutable, control refs mutable,
// resolver returns latest. Silent on success; throws on first failed invariant.
import {
  createEmptyRunnerRefStore,
  publishRunnerRef,
  resolveRunnerRef
} from '../packages/core/src/broker/runner-ref-store.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`[validate-runner-refs] ${msg}`);
    process.exit(1);
  }
}

let store = createEmptyRunnerRefStore();

// Version ref published once, then re-publish must fail closed.
const v1 = publishRunnerRef(store, {
  refName: 'v0.1.0',
  kind: 'version',
  sourceCommit: 'commit-a',
  artifactSha256: 'sha256:aaa',
  publisherActorId: 'runner-steward'
});
assert(v1.ok, 'initial version ref publish must succeed');
store = v1.store;

const v1again = publishRunnerRef(store, {
  refName: 'v0.1.0',
  kind: 'version',
  sourceCommit: 'commit-b',
  artifactSha256: 'sha256:bbb',
  publisherActorId: 'runner-steward'
});
assert(!v1again.ok, 'duplicate version ref publish must fail closed');

// Control ref can move; resolver returns latest.
const c1 = publishRunnerRef(store, {
  refName: 'in-dev/HEAD',
  kind: 'control',
  sourceCommit: 'commit-a',
  artifactSha256: 'sha256:aaa',
  publisherActorId: 'runner-steward'
});
assert(c1.ok, 'first control ref publish must succeed');
store = c1.store;

const c2 = publishRunnerRef(store, {
  refName: 'in-dev/HEAD',
  kind: 'control',
  sourceCommit: 'commit-c',
  artifactSha256: 'sha256:ccc',
  publisherActorId: 'runner-steward'
});
assert(c2.ok, 'control ref move must succeed');
store = c2.store;

const resolved = resolveRunnerRef(store, 'in-dev/HEAD', 'control');
assert(resolved !== null, 'control ref must resolve');
assert(resolved!.sourceCommit === 'commit-c', 'control ref resolver must return latest entry');

console.log('[validate-runner-refs] ok (publish / immutability / control move / resolve)');
