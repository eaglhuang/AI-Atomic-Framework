// TASK-MAO-0020: tests for broker bootstrap recovery analysis.
import assert from 'node:assert/strict';
import { analyzeBootstrap } from '../runner-bootstrap.js';
import { createEmptyRunnerRefStore, publishRunnerRef } from '../runner-ref-store.js';
import { createRunnerVersionStream, transitionRunnerVersion } from '../runner-version-state.js';
function withInDevHead(commit) {
    return publishRunnerRef(createEmptyRunnerRefStore(), {
        refName: 'in-dev/HEAD',
        kind: 'control',
        sourceCommit: commit,
        artifactSha256: 'sha256:x',
        publisherActorId: 'steward'
    }).store;
}
function publishedStream(streamId) {
    let s = createRunnerVersionStream(streamId);
    for (const t of ['cut-rc', 'freeze-rc', 'publish']) {
        s = transitionRunnerVersion(s, t, 'steward').record;
    }
    return s;
}
function testHealthyBrokerNoRecovery() {
    const store = publishRunnerRef(withInDevHead('a'), {
        refName: 'v0.1.0',
        kind: 'version',
        sourceCommit: 'a',
        artifactSha256: 'sha256:a',
        publisherActorId: 'steward'
    }).store;
    const plan = analyzeBootstrap({
        refStore: store,
        stream: publishedStream('runner'),
        reachableSourceCommits: new Set(['a'])
    });
    assert.equal(plan.decision, 'no-recovery-needed');
}
function testOrphanedInDevHeadTriggersRollback() {
    const store = withInDevHead('orphan');
    const plan = analyzeBootstrap({
        refStore: publishRunnerRef(store, {
            refName: 'v0.1.0',
            kind: 'version',
            sourceCommit: 'a',
            artifactSha256: 'sha256:a',
            publisherActorId: 's'
        }).store,
        stream: createRunnerVersionStream('runner'),
        reachableSourceCommits: new Set(['a']) // orphan not reachable
    });
    assert.equal(plan.decision, 'rollback-rc-to-in-dev');
    assert.ok(plan.findings.some((f) => f.code === 'in-dev-head-orphaned'));
}
function testNoVersionRefSuggestsReseed() {
    const store = withInDevHead('a');
    const plan = analyzeBootstrap({
        refStore: store,
        stream: createRunnerVersionStream('runner'),
        reachableSourceCommits: new Set(['a'])
    });
    assert.equal(plan.decision, 'reseed-from-version');
}
function testLeaseOnPublishedStreamTriggersQuarantine() {
    const store = publishRunnerRef(withInDevHead('a'), {
        refName: 'v0.1.0',
        kind: 'version',
        sourceCommit: 'a',
        artifactSha256: 'sha256:a',
        publisherActorId: 's'
    }).store;
    const stream = {
        ...publishedStream('runner'),
        lease: { heldBy: 'stale-agent', heldUntil: '2026-01-01T00:00:00.000Z' }
    };
    const plan = analyzeBootstrap({
        refStore: store,
        stream,
        reachableSourceCommits: new Set(['a'])
    });
    assert.equal(plan.decision, 'quarantine');
}
testHealthyBrokerNoRecovery();
testOrphanedInDevHeadTriggersRollback();
testNoVersionRefSuggestsReseed();
testLeaseOnPublishedStreamTriggersQuarantine();
console.log('runner bootstrap tests: ok');
