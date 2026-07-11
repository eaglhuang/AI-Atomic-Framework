import assert from 'node:assert/strict';
import { runPolymorphPolice } from '../roles/polymorph.ts';
import { buildPolymorphSuppressionKey, DEFAULT_POLYMORPH_VARIANT_THRESHOLD } from '../suppression-keys.ts';

const under = runPolymorphPolice({
  template: { templateId: 't1', templateVersion: '1.0.0' },
  instances: Array.from({ length: DEFAULT_POLYMORPH_VARIANT_THRESHOLD - 1 }, (_, i) => ({
    instanceId: `i${i}`,
    templateId: 't1',
    inheritedTemplateVersion: '1.0.0',
    variantKey: `v${i}`
  }))
});
assert.ok(!under.findings.some((f) => f.trigger === 'variant-explosion'));

const over = runPolymorphPolice({
  template: { templateId: 't1', templateVersion: '1.0.0' },
  instances: Array.from({ length: DEFAULT_POLYMORPH_VARIANT_THRESHOLD + 1 }, (_, i) => ({
    instanceId: `i${i}`,
    templateId: 't1',
    inheritedTemplateVersion: '1.0.0',
    variantKey: `v${i}`
  }))
});
assert.ok(over.findings.some((f) => f.trigger === 'variant-explosion'));

const key = buildPolymorphSuppressionKey({
  templateId: 't1',
  signalKind: 'variant-explosion',
  templateVersion: '1.0.0'
});
const suppressed = runPolymorphPolice({
  template: { templateId: 't1', templateVersion: '1.0.0' },
  instances: Array.from({ length: DEFAULT_POLYMORPH_VARIANT_THRESHOLD + 1 }, (_, i) => ({
    instanceId: `i${i}`,
    templateId: 't1',
    inheritedTemplateVersion: '1.0.0',
    variantKey: `v${i}`
  })),
  suppressedKeys: [key]
});
assert.ok(!suppressed.findings.some((f) => f.trigger === 'variant-explosion'));

console.log('polymorph.spec.ts: ok');
