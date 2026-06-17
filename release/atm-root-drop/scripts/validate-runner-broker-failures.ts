// TASK-MAO-0021: failure-mode coverage validator. Loads each fixture under
// scripts/fixtures/runner-broker-failures/ and confirms the broker primitives
// reach the documented decision. Silent on success; throws on first mismatch.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPatchEnvelope } from '../packages/core/src/broker/patch-envelope.ts';
import { annotateForAtmCore } from '../packages/core/src/broker/patch-envelope-atm-core.ts';
import {
  createEmptyRunnerRefStore,
  publishRunnerRef
} from '../packages/core/src/broker/runner-ref-store.ts';
import { submitRunnerPatch } from '../packages/core/src/broker/runner-submit-pipeline.ts';
import { analyzeBootstrap } from '../packages/core/src/broker/runner-bootstrap.ts';
import { createRunnerVersionStream } from '../packages/core/src/broker/runner-version-state.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'scripts/fixtures/runner-broker-failures');

function fail(msg: string): never {
  console.error(`[validate-runner-broker-failures] ${msg}`);
  process.exit(1);
}

if (!existsSync(fixtureDir)) fail(`fixture dir not found: ${fixtureDir}`);

function buildSubmitEnvelope(fixture: any) {
  const annotated = annotateForAtmCore(
    createPatchEnvelope({
      taskId: 'T',
      actorId: 'a',
      freezeId: 'f',
      patchText: 'd',
      targetFiles: ['x'],
      wipState: 'complete',
      confidence: 'high'
    }),
    {
      scopeClass: fixture.envelope?.scopeClass ?? 'atm-core',
      publishIntent: fixture.envelope?.publishIntent ?? 'patch-only',
      targetRunnerRef: fixture.envelope?.targetRunnerRef ?? null,
      declaredSourceCommit: fixture.envelope?.declaredSourceCommit ?? null
    }
  );
  return annotated;
}

let total = 0;
let passed = 0;
for (const entry of readdirSync(fixtureDir)) {
  if (!entry.endsWith('.json')) continue;
  total += 1;
  const fixture = JSON.parse(readFileSync(path.join(fixtureDir, entry), 'utf8'));

  if (fixture.expectedVerdict) {
    // submit-pipeline scenario
    const store = fixture.storeHead
      ? publishRunnerRef(createEmptyRunnerRefStore(), {
          refName: 'in-dev/HEAD',
          kind: 'control',
          sourceCommit: fixture.storeHead,
          artifactSha256: 'sha256:x',
          publisherActorId: 's'
        }).store
      : createEmptyRunnerRefStore();

    const env =
      fixture.fixtureId === 'stale-base'
        ? annotateForAtmCore(
            createPatchEnvelope({
              taskId: 'T',
              actorId: 'a',
              freezeId: 'f',
              patchText: 'd',
              targetFiles: ['x'],
              wipState: 'complete',
              confidence: 'high'
            }),
            {
              scopeClass: 'atm-core',
              publishIntent: 'in-dev-bump',
              targetRunnerRef: 'in-dev/HEAD',
              declaredSourceCommit: fixture.declaredCommit
            }
          )
        : fixture.targetRef === 'in-dev/HEAD'
        ? annotateForAtmCore(
            createPatchEnvelope({
              taskId: 'T',
              actorId: 'a',
              freezeId: 'f',
              patchText: 'd',
              targetFiles: ['x'],
              wipState: 'complete',
              confidence: 'high'
            }),
            {
              scopeClass: 'atm-core',
              publishIntent: 'in-dev-bump',
              targetRunnerRef: 'in-dev/HEAD'
            }
          )
        : buildSubmitEnvelope(fixture);
    const decision = submitRunnerPatch({
      envelope: env,
      refStore: store,
      frozenRefs: fixture.frozenRefs ?? []
    });
    if (decision.verdict !== fixture.expectedVerdict) {
      fail(`fixture ${fixture.fixtureId}: expected verdict ${fixture.expectedVerdict}, got ${decision.verdict}`);
    }
    passed += 1;
  } else if (fixture.expectedDecision) {
    // bootstrap-recovery scenario
    let store = createEmptyRunnerRefStore();
    if (fixture.inDevHeadCommit) {
      store = publishRunnerRef(store, {
        refName: 'in-dev/HEAD',
        kind: 'control',
        sourceCommit: fixture.inDevHeadCommit,
        artifactSha256: 'sha256:x',
        publisherActorId: 's'
      }).store;
      store = publishRunnerRef(store, {
        refName: 'v0.1.0',
        kind: 'version',
        sourceCommit: 'a',
        artifactSha256: 'sha256:a',
        publisherActorId: 's'
      }).store;
    }
    const plan = analyzeBootstrap({
      refStore: store,
      stream: createRunnerVersionStream('runner'),
      reachableSourceCommits: new Set(fixture.reachableCommits ?? [])
    });
    if (plan.decision !== fixture.expectedDecision) {
      fail(`fixture ${fixture.fixtureId}: expected decision ${fixture.expectedDecision}, got ${plan.decision}`);
    }
    if (fixture.expectedFinding && !plan.findings.some((f) => f.code === fixture.expectedFinding)) {
      fail(`fixture ${fixture.fixtureId}: expected finding ${fixture.expectedFinding} missing`);
    }
    passed += 1;
  }
}

console.log(`[validate-runner-broker-failures] ok (${passed}/${total} fixtures)`);
