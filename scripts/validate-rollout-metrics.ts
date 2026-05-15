/**
 * ATM M8 — Rollout Metrics Validator
 *
 * Verifies the rollout-metrics-report schema and sample fixture.
 *
 * Checklist items validated:
 * - Proposal acceptance rate 可量測          → proposalMetrics.acceptanceRate
 * - Stale rate 可量測                        → proposalMetrics.staleRate
 * - Blocked reasons 可分類                   → proposalMetrics.blockedReasonCounts
 * - Curator merge accuracy 可由 human review 抽查 → curatorMetrics.humanReviewSampled + mergeAccuracyEstimate
 * - Daily proposal cap 可配置                → configuration.dailyProposalCap
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(msg: string): never {
  throw new Error(`[rollout-metrics:${mode}] FAIL: ${msg}`);
}
function check(condition: unknown, msg: string): void {
  if (!condition) fail(msg);
}
function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>;
}

const schemaRel = 'schemas/governance/rollout-metrics-report.schema.json';
const fixtureRel = 'fixtures/rollout-metrics/sample-rollout-metrics.json';

check(existsSync(path.join(root, schemaRel)), `missing schema: ${schemaRel}`);
check(existsSync(path.join(root, fixtureRel)), `missing fixture: ${fixtureRel}`);

const schema = readJson(schemaRel);

// Verify all M8 measurability dimensions are present in the schema
const pm = (schema as Record<string, unknown> & { properties?: Record<string, unknown> }).properties;
check(pm, 'schema must have top-level properties');

const pmProps = (pm as Record<string, Record<string, unknown>>);
const proposalMetricsProps = (pmProps.proposalMetrics as { properties?: Record<string, unknown> })?.properties;
const curatorMetricsProps = (pmProps.curatorMetrics as { properties?: Record<string, unknown> })?.properties;
const configProps = (pmProps.configuration as { properties?: Record<string, unknown> })?.properties;

check(proposalMetricsProps?.acceptanceRate, 'schema must expose acceptanceRate (proposal acceptance rate 可量測)');
check(proposalMetricsProps?.staleRate, 'schema must expose staleRate (stale rate 可量測)');
check(proposalMetricsProps?.blockedReasonCounts, 'schema must expose blockedReasonCounts (blocked reasons 可分類)');
check(curatorMetricsProps?.humanReviewSampled, 'schema must expose humanReviewSampled (curator merge accuracy 可由 human review 抽查)');
check(curatorMetricsProps?.mergeAccuracyEstimate, 'schema must expose mergeAccuracyEstimate (curator merge accuracy 可量測)');
check(configProps?.dailyProposalCap, 'schema must expose dailyProposalCap (daily proposal cap 可配置)');

// Validate fixture against schema
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const sample = readJson(fixtureRel);
const valid = validate(sample);
check(valid, `sample fixture failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`);

// Verify fixture content covers all M8 measurement dimensions
const sampleAny = sample as Record<string, unknown>;
const propMetrics = sampleAny.proposalMetrics as Record<string, unknown>;
const curMetrics = sampleAny.curatorMetrics as Record<string, unknown>;
const config = sampleAny.configuration as Record<string, unknown>;

check(typeof propMetrics.acceptanceRate === 'number', 'sample fixture must record acceptanceRate');
check(typeof propMetrics.staleRate === 'number', 'sample fixture must record staleRate');
check(
  typeof propMetrics.blockedReasonCounts === 'object' &&
  propMetrics.blockedReasonCounts !== null &&
  Object.keys(propMetrics.blockedReasonCounts as object).length >= 1,
  'sample fixture must classify at least one blocked reason'
);
check(typeof curMetrics.humanReviewSampled === 'number', 'sample fixture must record humanReviewSampled');
check(typeof curMetrics.mergeAccuracyEstimate === 'number', 'sample fixture must record mergeAccuracyEstimate');
check(
  typeof config.dailyProposalCap === 'number' && (config.dailyProposalCap as number) >= 1,
  'sample fixture must configure dailyProposalCap >= 1'
);

console.log(`[rollout-metrics:${mode}] ok (schema verified: acceptanceRate, staleRate, blockedReasonCounts, humanReviewSampled, dailyProposalCap)`);
