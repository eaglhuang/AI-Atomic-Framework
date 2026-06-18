// TASK-MAO-0016: deterministic self-check for the runner submit-patch pipeline.
import { createPatchEnvelope } from '../packages/core/src/broker/patch-envelope.ts';
import { annotateForAtmCore } from '../packages/core/src/broker/patch-envelope-atm-core.ts';
import { createEmptyRunnerRefStore, publishRunnerRef } from '../packages/core/src/broker/runner-ref-store.ts';
import { submitRunnerPatch } from '../packages/core/src/broker/runner-submit-pipeline.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`[validate-runner-submit-pipeline] ${msg}`);
    process.exit(1);
  }
}

const store = publishRunnerRef(createEmptyRunnerRefStore(), {
  refName: 'in-dev/HEAD',
  kind: 'control',
  sourceCommit: 'commit-a',
  artifactSha256: 'sha256:x',
  publisherActorId: 'steward'
}).store;

const ok = submitRunnerPatch({
  envelope: annotateForAtmCore(
    createPatchEnvelope({
      taskId: 'T',
      actorId: 'a',
      freezeId: 'f',
      patchText: 'd',
      targetFiles: ['x'],
      wipState: 'complete',
      confidence: 'high'
    }),
    { scopeClass: 'atm-core', publishIntent: 'in-dev-bump', targetRunnerRef: 'in-dev/HEAD', declaredSourceCommit: 'commit-a' }
  ),
  refStore: store
});
assert(ok.verdict === 'accept', 'matching base must accept');

const stale = submitRunnerPatch({
  envelope: annotateForAtmCore(
    createPatchEnvelope({
      taskId: 'T',
      actorId: 'a',
      freezeId: 'f',
      patchText: 'd',
      targetFiles: ['x'],
      wipState: 'complete',
      confidence: 'high'
    }),
    { scopeClass: 'atm-core', publishIntent: 'in-dev-bump', targetRunnerRef: 'in-dev/HEAD', declaredSourceCommit: 'OLD' }
  ),
  refStore: store
});
assert(stale.verdict === 'reject-stale-base', 'stale base must reject');

console.log('[validate-runner-submit-pipeline] ok (accept / reject-stale)');
