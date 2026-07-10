import assert from 'node:assert/strict';
import {
  buildPolymorphSuppressionKey,
  buildRollbackSuppressionKey
} from '../suppression-keys.ts';

const polymorphKey = buildPolymorphSuppressionKey({
  templateId: 'tmpl-a',
  signalKind: 'template-drift',
  instanceId: 'inst-1',
  templateVersion: '1.0.0'
});
assert.equal(polymorphKey, 'polymorph::tmpl-a::template-drift::inst-1::1.0.0');

const rollbackKey = buildRollbackSuppressionKey({
  proposalId: 'prop-1',
  signalKind: 'rollback-proof-missing',
  baseVersion: '2.0.0'
});
assert.equal(rollbackKey, 'rollback::prop-1::rollback-proof-missing::2.0.0');

const lower = buildPolymorphSuppressionKey({
  templateId: 'tmpl-a',
  signalKind: 'template-drift',
  instanceId: 'inst-1',
  templateVersion: '1.0.0'
});
const upper = buildPolymorphSuppressionKey({
  templateId: 'TMPL-A',
  signalKind: 'template-drift',
  instanceId: 'inst-1',
  templateVersion: '1.0.0'
});
assert.notEqual(lower, upper, 'case-differing inputs must produce different keys');

console.log('suppression-keys.spec.ts: ok');
