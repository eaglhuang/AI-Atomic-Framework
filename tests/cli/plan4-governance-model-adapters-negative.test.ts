import assert from 'node:assert/strict';
import { adaptGovernanceModels } from '../../packages/core/src/evidence/governance-model-adapters.ts';
const result = adaptGovernanceModels({ runId: 'fixture', authority: { authorityId: 'fixture-v1', sealed: false, digest: '' }, models: [{ modelId: 'x', kind: 'unknown', state: 'ready' }] }); assert.equal(result.status, 'stale'); assert.ok(result.diagnostics.some((entry) => entry.code === 'ATM_GOV_ADAPTER_KIND_UNSUPPORTED')); console.log('plan4 governance model adapters negative: PASS');
