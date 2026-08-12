import assert from 'node:assert/strict';
import { compileDependencyGraphBypassGate, replayDependencyGraphBypassGate, validateDependencyGraphBypassGate } from '../../packages/core/src/evidence/dependency-graph-bypass-gate.ts';

const authority = { authorityId: 'dependency-graph-fixture', digest: 'sha256:graph', sealed: true as const };
const result = compileDependencyGraphBypassGate({
  runId: 'dependency-graph-success', authority, observedAuthorityDigest: authority.digest,
  nodes: ['caller', 'public-api', 'service'],
  edges: [['caller', 'public-api'], ['public-api', 'service']],
  publicInterfaces: ['public-api']
});

assert.equal(result.status, 'proven');
assert.deepEqual(replayDependencyGraphBypassGate(result), result);
assert.equal(validateDependencyGraphBypassGate(result).ok, true);
console.log('plan4 dependency graph bypass gate: ok');
