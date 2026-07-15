import assert from 'node:assert/strict';
import {
  buildTeamProviderPreflight,
  selectCheapestEligibleProviderPlan,
  type TeamProviderPlan
} from '../../packages/cli/src/commands/team/provider-preflight.ts';

const plans: TeamProviderPlan[] = [
  {
    providerId: 'openai',
    modelId: 'gpt-5-mini',
    planId: 'standard',
    catalogVersion: '2026-07-14',
    projectedSpendCeilingUsd: 0.42,
    estimatedSpendUsd: 0.21,
    currency: 'USD',
    catalogFresh: true,
    capabilities: ['code', 'review'],
    maxRisk: 'medium',
    dataPolicies: ['standard']
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5',
    planId: 'standard',
    catalogVersion: '2026-07-14',
    projectedSpendCeilingUsd: 1.4,
    estimatedSpendUsd: 0.9,
    currency: 'USD',
    catalogFresh: true,
    capabilities: ['code', 'review', 'high-risk'],
    maxRisk: 'high',
    dataPolicies: ['standard', 'restricted']
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-sonnet',
    planId: 'enterprise',
    catalogVersion: '2026-07-01',
    projectedSpendCeilingUsd: 0.6,
    estimatedSpendUsd: 0.3,
    currency: 'EUR',
    catalogFresh: false,
    capabilities: ['code'],
    maxRisk: 'medium',
    dataPolicies: ['standard']
  }
];

const cheapest = selectCheapestEligibleProviderPlan({
  candidates: plans,
  requiredCapabilities: ['code'],
  risk: 'medium',
  dataPolicy: 'standard'
});
assert.equal(cheapest?.modelId, 'gpt-5-mini', 'routing should prefer the cheapest eligible model');

const ok = buildTeamProviderPreflight({
  requestedProviderId: 'openai',
  requestedPlanId: 'standard',
  requiredCapabilities: ['code'],
  risk: 'medium',
  dataPolicy: 'standard',
  candidates: plans,
  checks: { authOk: true, schemaOk: true, quotaOk: true, billingOk: true }
});
assert.equal(ok.ok, true);
assert.equal(ok.modelId, 'gpt-5-mini');
assert.equal(ok.catalogVersion, '2026-07-14');
assert.equal(ok.projectedSpendCeilingUsd, 0.42);
assert.equal(ok.cheapestEligibleModelId, 'gpt-5-mini');

const blocked = buildTeamProviderPreflight({
  requestedProviderId: 'anthropic',
  requestedModelId: 'claude-sonnet',
  requestedPlanId: 'standard',
  requiredCapabilities: ['code', 'vision'],
  risk: 'high',
  dataPolicy: 'restricted',
  candidates: plans,
  checks: { authOk: false, schemaOk: false, quotaOk: false, billingOk: false }
});
assert.deepEqual(blocked.failureClasses, ['auth', 'schema', 'quota', 'billing', 'model', 'stale-price', 'currency', 'plan']);

console.log('[team-provider-preflight.test] ok');
