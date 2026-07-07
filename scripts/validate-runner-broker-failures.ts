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
import {
  createRunnerVersionStream,
  transitionRunnerVersion,
  type RunnerVersionStreamRecord
} from '../packages/core/src/broker/runner-version-state.ts';

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
const scenarioFamilies = new Set<string>();

function passScenario(family: string): void {
  scenarioFamilies.add(family);
  passed += 1;
}

function assertSubmitScenario(input: {
  readonly family: string;
  readonly envelope: ReturnType<typeof annotateForAtmCore>;
  readonly refStore?: ReturnType<typeof createEmptyRunnerRefStore>;
  readonly frozenRefs?: readonly string[];
  readonly expectedVerdict: string;
  readonly expectedNextActionIncludes?: string;
}): void {
  total += 1;
  const decision = submitRunnerPatch({
    envelope: input.envelope,
    refStore: input.refStore ?? createEmptyRunnerRefStore(),
    frozenRefs: input.frozenRefs
  });
  if (decision.verdict !== input.expectedVerdict) {
    fail(`scenario ${input.family}: expected verdict ${input.expectedVerdict}, got ${decision.verdict}`);
  }
  if (
    input.expectedNextActionIncludes &&
    !decision.suggestedNextAction.includes(input.expectedNextActionIncludes)
  ) {
    fail(`scenario ${input.family}: expected next action to include ${input.expectedNextActionIncludes}`);
  }
  passScenario(input.family);
}

function assertBootstrapScenario(input: {
  readonly family: string;
  readonly stream: RunnerVersionStreamRecord;
  readonly refStore?: ReturnType<typeof createEmptyRunnerRefStore>;
  readonly reachableSourceCommits?: readonly string[];
  readonly expectedDecision: string;
  readonly expectedFinding?: string;
  readonly expectedNextActionIncludes?: string;
}): void {
  total += 1;
  const plan = analyzeBootstrap({
    refStore: input.refStore ?? createEmptyRunnerRefStore(),
    stream: input.stream,
    reachableSourceCommits: new Set(input.reachableSourceCommits ?? [])
  });
  if (plan.decision !== input.expectedDecision) {
    fail(`scenario ${input.family}: expected decision ${input.expectedDecision}, got ${plan.decision}`);
  }
  if (input.expectedFinding && !plan.findings.some((finding) => finding.code === input.expectedFinding)) {
    fail(`scenario ${input.family}: expected finding ${input.expectedFinding} missing`);
  }
  if (
    input.expectedNextActionIncludes &&
    !plan.suggestedNextAction.includes(input.expectedNextActionIncludes)
  ) {
    fail(`scenario ${input.family}: expected next action to include ${input.expectedNextActionIncludes}`);
  }
  passScenario(input.family);
}
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
    passScenario(fixture.fixtureId ?? entry.replace(/\.json$/, ''));
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
    passScenario(fixture.fixtureId ?? entry.replace(/\.json$/, ''));
  }
}

assertSubmitScenario({
  family: 'release-only-textual-diff',
  envelope: annotateForAtmCore(
    createPatchEnvelope({
      taskId: 'T',
      actorId: 'a',
      freezeId: 'f',
      targetFiles: ['release/atm-onefile/atm.mjs'],
      patchText: 'diff --git a/release/atm-onefile/atm.mjs b/release/atm-onefile/atm.mjs',
      wipState: 'complete',
      confidence: 'high'
    }),
    {
      scopeClass: 'release-only',
      publishIntent: 'patch-only'
    }
  ),
  expectedVerdict: 'reject-malformed'
});

assertSubmitScenario({
  family: 'bad-in-dev-target',
  envelope: annotateForAtmCore(buildSubmitEnvelope({}).base, {
    scopeClass: 'atm-core',
    publishIntent: 'in-dev-bump',
    targetRunnerRef: 'v0.1.0'
  }),
  expectedVerdict: 'reject-malformed'
});

assertSubmitScenario({
  family: 'version-publish-missing-target',
  envelope: annotateForAtmCore(buildSubmitEnvelope({}).base, {
    scopeClass: 'atm-core',
    publishIntent: 'version-publish'
  }),
  expectedVerdict: 'reject-malformed'
});

assertSubmitScenario({
  family: 'steward-required-accepted-patch',
  envelope: annotateForAtmCore(buildSubmitEnvelope({}).base, {
    scopeClass: 'atm-core',
    publishIntent: 'patch-only'
  }),
  expectedVerdict: 'accept',
  expectedNextActionIncludes: 'steward rebuild lane'
});

const publishedStream = transitionRunnerVersion(
  transitionRunnerVersion(
    transitionRunnerVersion(createRunnerVersionStream('runner'), 'cut-rc', 'steward').record,
    'freeze-rc',
    'steward'
  ).record,
  'publish',
  'steward'
).record;
assertBootstrapScenario({
  family: 'human-required-stale-published-lease',
  stream: {
    ...publishedStream,
    lease: { heldBy: 'stale-steward', heldUntil: '2099-01-01T00:00:00.000Z' }
  },
  refStore: publishRunnerRef(createEmptyRunnerRefStore(), {
    refName: 'v0.1.0',
    kind: 'version',
    sourceCommit: 'published',
    artifactSha256: 'sha256:p',
    publisherActorId: 'steward'
  }).store,
  reachableSourceCommits: ['published'],
  expectedDecision: 'quarantine',
  expectedFinding: 'lease-held-but-state-published',
  expectedNextActionIncludes: 'audit'
});

assertBootstrapScenario({
  family: 'healthy-bootstrap-no-recovery',
  stream: createRunnerVersionStream('runner'),
  refStore: publishRunnerRef(createEmptyRunnerRefStore(), {
    refName: 'v0.1.0',
    kind: 'version',
    sourceCommit: 'published',
    artifactSha256: 'sha256:p',
    publisherActorId: 'steward'
  }).store,
  reachableSourceCommits: ['published'],
  expectedDecision: 'no-recovery-needed'
});

if (scenarioFamilies.size < 9) {
  fail(`expected at least 9 failure scenario families, got ${scenarioFamilies.size}`);
}

const requiredFamilies = [
  'malformed-envelope',
  'stale-base',
  'frozen-target',
  'orphan-head-recovery',
  'release-only-textual-diff',
  'steward-required-accepted-patch',
  'human-required-stale-published-lease'
];
for (const family of requiredFamilies) {
  if (!scenarioFamilies.has(family)) {
    fail(`required scenario family missing: ${family}`);
  }
}

console.log(`[validate-runner-broker-failures] ok (${passed}/${total} scenarios; ${scenarioFamilies.size} families)`);
