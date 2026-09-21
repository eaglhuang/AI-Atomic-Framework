import assert from 'node:assert/strict';
import { compileDependencyGraphBypassGate, validateDependencyGraphBypassGate } from '../../packages/core/src/evidence/dependency-graph-bypass-gate.ts';

const authority = { authorityId: 'dependency-graph-fixture', digest: 'sha256:graph', sealed: true as const };
const bypass = compileDependencyGraphBypassGate({
  runId: 'dependency-graph-bypass', authority, observedAuthorityDigest: authority.digest,
  nodes: ['caller', 'public-api', 'service'],
  edges: [['caller', 'public-api'], ['public-api', 'service'], ['caller', 'service']],
  publicInterfaces: ['public-api']
});
assert.equal(bypass.status, 'blocked');
assert.deepEqual(bypass.violations, ['public-interface-bypass:caller->public-api->service']);
assert.equal(validateDependencyGraphBypassGate(bypass).ok, false);

const stale = compileDependencyGraphBypassGate({
  runId: 'dependency-graph-stale', authority, observedAuthorityDigest: 'sha256:stale',
  nodes: ['caller', 'service'], edges: [['caller', 'service']], forbiddenEdges: [['caller', 'service']]
});
assert.equal(stale.status, 'stale');
assert.equal(validateDependencyGraphBypassGate(stale).ok, false);
console.log('plan4 dependency graph bypass gate negative: ok');
