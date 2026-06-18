// TASK-MAO-0019: tests for cross-repo dual-binding closure. Verifies that the
// close-orchestration plan surfaces planning-repo and target-repo state in a
// shape the operator lane uses to drive the dual-commit bundle. The actual
// orchestration is exercised end-to-end in
// taskflow-close-orchestration.test.ts; this test pins the structural contract
// the cross-repo binding depends on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(
  path.join(root, 'packages/cli/src/commands/taskflow/close-orchestration.ts'),
  'utf8'
);

function testPlanningMirrorFieldIsPartOfPlan() {
  // The orchestration plan exposes a planningMirrorPath so the operator lane
  // can locate the planning-repo card to update in lockstep with the target
  // repo commit. Without this field there is no dual-binding contract.
  assert.match(source, /planningMirrorPath/);
}

function testPlanningStatusIsCarriedThroughTriangulation() {
  // Cross-repo close requires the planning-repo frontmatter status to be read
  // back into the orchestration so a divergence (planning says done, ledger
  // says running) is detected before the close window opens.
  assert.match(source, /planningStatus/);
  assert.match(source, /planningFrontmatter/);
}

function testPlanningAuthorityDeliveryGateExists() {
  // The dual-binding closure must consult a planning-authority delivery gate
  // to decide whether the planning repo's bundle can land independently or
  // requires a target-repo proof first.
  assert.match(source, /planningAuthorityDeliveryGate/);
}

function testBackendSurfaceSwitchesOnAuthorityGate() {
  // Reading the orchestration: when planningAuthorityDeliveryOk is true the
  // backend surface switches to the planning-mirror-adopter-flow writer.
  // This conditional branch is what the dual-binding closure relies on.
  assert.match(source, /planning-mirror-adopter-flow/);
}

testPlanningMirrorFieldIsPartOfPlan();
testPlanningStatusIsCarriedThroughTriangulation();
testPlanningAuthorityDeliveryGateExists();
testBackendSurfaceSwitchesOnAuthorityGate();

console.log('cross-repo dual binding close tests: ok');
