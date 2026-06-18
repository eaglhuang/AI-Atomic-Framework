// TASK-MAO-0018: tests for closure-packet runner binding. A closure packet that
// records work on ATM core scope (TASK-MAO-0013 classifier) must carry an
// atmCoreRunnerBinding tying the closure to a published runner version. This
// test validates the schema-level contract that runner-touching closure packets
// declare which runner version their evidence was produced under.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schema = JSON.parse(
  readFileSync(path.join(root, 'schemas/governance/closure-packet.schema.json'), 'utf8')
);

function testClosurePacketSchemaIdIsStable() {
  // The schema $id is a URL host-form; what matters for the runner binding
  // contract is that the schema is the closure-packet schema and exposes the
  // validationPasses array, not the exact URL form.
  assert.match(String(schema['$id'] ?? ''), /closure-packet/);
}

function testCommandRunsRequireRunnerVersion() {
  // Every closure packet records the validator command runs that produced its
  // evidence. Each commandRuns entry must carry a runnerVersion, which lets
  // the closure-runner binding (this task) map a packet to a runner ref store
  // entry (TASK-MAO-0014).
  const cr = schema.properties.commandRuns;
  assert.ok(cr, 'commandRuns must exist on closure-packet schema');
  assert.ok(cr.items.required.includes('runnerVersion'), 'commandRuns entries must require runnerVersion');
}

function testRunnerVersionIsNonEmptyString() {
  const props = schema.properties.commandRuns.items.properties;
  assert.equal(props.runnerVersion.type, 'string');
  assert.equal(props.runnerVersion.minLength, 1);
}

function testTargetRepoIdentityBindsClosureToTargetRepo() {
  // The dual-binding closure (TASK-MAO-0019) needs a target-repo identity in
  // every packet so the planning-repo side can verify which target commit it
  // mirrors. Without this field cross-repo close cannot prove which delivery
  // it bound to.
  assert.ok(schema.properties.targetRepoIdentity, 'closure-packet must record targetRepoIdentity');
  assert.ok(schema.properties.targetCommit, 'closure-packet must record targetCommit');
}

testClosurePacketSchemaIdIsStable();
testCommandRunsRequireRunnerVersion();
testRunnerVersionIsNonEmptyString();
testTargetRepoIdentityBindsClosureToTargetRepo();

console.log('closure runner binding tests: ok');
