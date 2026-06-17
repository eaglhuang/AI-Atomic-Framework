// TASK-MAO-0014: tests for runner-ref publish primitive.
import assert from 'node:assert/strict';
import {
  createEmptyRunnerRefStore,
  publishRunnerRef,
  resolveRunnerRef
} from '../runner-ref-store.ts';

function testPublishVersionRefSucceeds() {
  const store = createEmptyRunnerRefStore();
  const result = publishRunnerRef(store, {
    refName: 'v1.0.0',
    kind: 'version',
    sourceCommit: 'abc123',
    artifactSha256: 'sha256:def',
    publisherActorId: 'runner-steward'
  });
  assert.equal(result.ok, true);
  assert.equal(result.entry!.refName, 'v1.0.0');
  assert.equal(result.store.entries.length, 1);
}

function testRepublishVersionRefFailsClosed() {
  let store = createEmptyRunnerRefStore();
  store = publishRunnerRef(store, {
    refName: 'v1.0.0',
    kind: 'version',
    sourceCommit: 'abc123',
    artifactSha256: 'sha256:def',
    publisherActorId: 'a'
  }).store;
  const second = publishRunnerRef(store, {
    refName: 'v1.0.0',
    kind: 'version',
    sourceCommit: 'abc456',
    artifactSha256: 'sha256:ghi',
    publisherActorId: 'b'
  });
  assert.equal(second.ok, false);
  assert.match(second.reason, /immutable/);
}

function testControlRefIsMutableAndLatestWins() {
  let store = createEmptyRunnerRefStore();
  store = publishRunnerRef(store, {
    refName: 'in-dev/HEAD',
    kind: 'control',
    sourceCommit: 'a1',
    artifactSha256: 'sha256:1',
    publisherActorId: 'a'
  }).store;
  store = publishRunnerRef(store, {
    refName: 'in-dev/HEAD',
    kind: 'control',
    sourceCommit: 'a2',
    artifactSha256: 'sha256:2',
    publisherActorId: 'b'
  }).store;
  const resolved = resolveRunnerRef(store, 'in-dev/HEAD', 'control');
  assert.ok(resolved);
  assert.equal(resolved!.sourceCommit, 'a2');
}

function testMissingFieldFailsClosed() {
  const result = publishRunnerRef(createEmptyRunnerRefStore(), {
    refName: '',
    kind: 'version',
    sourceCommit: 'x',
    artifactSha256: 'y',
    publisherActorId: 'z'
  });
  assert.equal(result.ok, false);
}

testPublishVersionRefSucceeds();
testRepublishVersionRefFailsClosed();
testControlRefIsMutableAndLatestWins();
testMissingFieldFailsClosed();

console.log('runner ref store tests: ok');
