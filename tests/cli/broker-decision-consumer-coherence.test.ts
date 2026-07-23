import assert from 'node:assert/strict';
import { resolveCanonicalDecisionClass } from '../../packages/cli/src/commands/broker/replay/closure-policy.ts';

assert.equal(
  resolveCanonicalDecisionClass({
    verdict: 'needs-physical-split',
    admissionState: 'composer-routed'
  }),
  'composer-routed',
  'composer-routed admission must win over legacy needs-physical-split'
);

assert.equal(
  resolveCanonicalDecisionClass({
    verdict: 'needs-physical-split',
    admissionState: 'parked-for-rearbitration'
  }),
  'must-serialize',
  'parked same-file rearbitration remains must-serialize'
);

assert.equal(
  resolveCanonicalDecisionClass({
    verdict: 'blocked-cid-conflict',
    admissionState: 'blocked-before-write'
  }),
  'must-serialize'
);

assert.equal(
  resolveCanonicalDecisionClass({
    verdict: 'needs-physical-split',
    admissionState: null
  }),
  'unclassified',
  'legacy top-level needs-physical-split alone must not imply serialization'
);

assert.equal(
  resolveCanonicalDecisionClass({
    verdict: 'blocked-shared-surface',
    admissionState: 'not-required'
  }),
  'blocked'
);

console.log('[broker-decision-consumer-coherence.test] ok');
