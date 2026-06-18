// TASK-MAO-0022: external core contributor pipeline gate. Used in CI to admit
// or reject contributor patches before they enter the steward rebuild lane.
// Each fixture under tests/fixtures/external-core-pipeline/ describes a PR
// scenario; this validator confirms the runner-submit pipeline reaches the
// documented verdict.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'tests/fixtures/external-core-pipeline');

function fail(msg: string): never {
  console.error(`[validate-external-core-pipeline] ${msg}`);
  process.exit(1);
}

if (!existsSync(fixtureDir)) fail(`fixture dir not found: ${fixtureDir}`);

let total = 0;
let passed = 0;

for (const entry of readdirSync(fixtureDir)) {
  if (!entry.endsWith('.json')) continue;
  total += 1;
  const fixture = JSON.parse(readFileSync(path.join(fixtureDir, entry), 'utf8'));

  const store = fixture.upstreamInDevHead
    ? publishRunnerRef(createEmptyRunnerRefStore(), {
        refName: 'in-dev/HEAD',
        kind: 'control',
        sourceCommit: fixture.upstreamInDevHead,
        artifactSha256: 'sha256:upstream',
        publisherActorId: 'upstream-steward'
      }).store
    : createEmptyRunnerRefStore();

  const base = createPatchEnvelope({
    taskId: 'EXTERNAL',
    actorId: 'contributor',
    freezeId: 'freeze-x',
    patchText: 'd',
    targetFiles: ['x'],
    wipState: 'complete',
    confidence: 'medium'
  });

  const annotated = annotateForAtmCore(base, {
    scopeClass: fixture.patchEnvelope.scopeClass,
    publishIntent: fixture.patchEnvelope.publishIntent,
    targetRunnerRef: fixture.patchEnvelope.targetRunnerRef ?? null,
    declaredSourceCommit: fixture.patchEnvelope.declaredSourceCommit ?? null
  });

  const decision = submitRunnerPatch({ envelope: annotated, refStore: store });
  if (decision.verdict !== fixture.expectedVerdict) {
    fail(
      `fixture ${fixture.fixtureId}: expected verdict ${fixture.expectedVerdict}, got ${decision.verdict} (reason: ${decision.reason})`
    );
  }
  passed += 1;
}

console.log(`[validate-external-core-pipeline] ok (${passed}/${total} fixtures)`);
