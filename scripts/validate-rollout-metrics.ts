/**
 * ATM M8 — Rollout Metrics Validator
 *
 * Verifies the rollout-metrics-report schema and sample fixture.
 *
 * Checklist items validated:
 * - Proposal acceptance rate 可量測          → proposalMetrics.acceptanceRate
 * - Proposal precision report 可量測        → proposalMetrics.precisionRate
 * - False-positive review report 可量測     → proposalMetrics.falsePositiveReview
 * - Stale rate 可量測                        → proposalMetrics.staleRate
 * - Blocked reasons 可分類                   → proposalMetrics.blockedReasonCounts
 * - Curator merge accuracy 可由 human review 抽查 → curatorMetrics.humanReviewSampled + mergeAccuracyEstimate
 * - Promotion latency report 可量測          → proposalMetrics.promotionLatencyP50Ms + promotionLatencyP95Ms
 * - Rollback rate report 可量測              → curatorMetrics.rollbackRate
 * - Daily proposal cap 可配置                → configuration.dailyProposalCap
 * - Host usage data 可補 cost/budget report  → costBudgetMetrics
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
function asRecord(value: unknown, msg: string): Record<string, unknown> {
  check(typeof value === 'object' && value !== null && !Array.isArray(value), msg);
  return value as Record<string, unknown>;
}
function asNumber(value: unknown, msg: string): number {
  check(typeof value === 'number' && Number.isFinite(value), msg);
  return value as number;
}
function checkInteger(value: number, msg: string): void {
  check(Number.isInteger(value), msg);
}
function sumCounts(record: Record<string, unknown>, msg: string): number {
  return Object.entries(record).reduce((sum, [key, value]) => {
    const numericValue = asNumber(value, `${msg}: ${key} must be a number`);
    checkInteger(numericValue, `${msg}: ${key} must be an integer`);
    check(numericValue >= 0, `${msg}: ${key} must be >= 0`);
    return sum + numericValue;
  }, 0);
}
function expectedRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
function checkApprox(actual: number, expected: number, msg: string): void {
  check(Math.abs(actual - expected) <= 0.001, `${msg}: expected ${expected.toFixed(3)}, got ${actual}`);
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
check(proposalMetricsProps?.precisionRate, 'schema must expose precisionRate (proposal precision report 可量測)');
check(proposalMetricsProps?.staleRate, 'schema must expose staleRate (stale rate 可量測)');
check(proposalMetricsProps?.blockedReasonCounts, 'schema must expose blockedReasonCounts (blocked reasons 可分類)');
check(proposalMetricsProps?.falsePositiveReview, 'schema must expose falsePositiveReview (false-positive review report 可量測)');
check(proposalMetricsProps?.promotionLatencyP50Ms, 'schema must expose promotionLatencyP50Ms (promotion latency report 可量測)');
check(proposalMetricsProps?.promotionLatencyP95Ms, 'schema must expose promotionLatencyP95Ms (promotion latency report 可量測)');
check(curatorMetricsProps?.humanReviewSampled, 'schema must expose humanReviewSampled (curator merge accuracy 可由 human review 抽查)');
check(curatorMetricsProps?.mergeAccuracyEstimate, 'schema must expose mergeAccuracyEstimate (curator merge accuracy 可量測)');
check(curatorMetricsProps?.rollbackRate, 'schema must expose rollbackRate (rollback rate report 可量測)');
check(configProps?.dailyProposalCap, 'schema must expose dailyProposalCap (daily proposal cap 可配置)');
check(pmProps.costBudgetMetrics, 'schema must expose costBudgetMetrics (host cost/budget report 可補)');

// Validate fixture against schema
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const sample = readJson(fixtureRel);
const valid = validate(sample);
check(valid, `sample fixture failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`);

// Verify fixture content covers all M8 measurement dimensions
const sampleAny = sample as Record<string, unknown>;
const propMetrics = asRecord(sampleAny.proposalMetrics, 'sample fixture must include proposalMetrics');
const curMetrics = asRecord(sampleAny.curatorMetrics, 'sample fixture must include curatorMetrics');
const config = asRecord(sampleAny.configuration, 'sample fixture must include configuration');
const costBudgetMetrics = asRecord(sampleAny.costBudgetMetrics, 'sample fixture must include costBudgetMetrics');

const totalProposed = asNumber(propMetrics.totalProposed, 'sample fixture must record totalProposed');
const accepted = asNumber(propMetrics.accepted, 'sample fixture must record accepted');
const blocked = asNumber(propMetrics.blocked, 'sample fixture must record blocked');
const pending = asNumber(propMetrics.pending, 'sample fixture must record pending');
const stale = asNumber(propMetrics.stale, 'sample fixture must record stale');
for (const [label, value] of Object.entries({ totalProposed, accepted, blocked, pending, stale })) {
  checkInteger(value, `sample fixture ${label} must be an integer`);
}

check(totalProposed === accepted + blocked + pending, 'sample fixture totalProposed must equal accepted + blocked + pending');
check(stale <= blocked, 'sample fixture stale count must be a subset of blocked proposals');

const blockedReasonCounts = asRecord(propMetrics.blockedReasonCounts, 'sample fixture must record blockedReasonCounts');
check(Object.keys(blockedReasonCounts).length >= 1, 'sample fixture must classify at least one blocked reason');
check(sumCounts(blockedReasonCounts, 'blockedReasonCounts') === blocked, 'sample fixture blockedReasonCounts must sum to blocked');

check(typeof propMetrics.acceptanceRate === 'number', 'sample fixture must record acceptanceRate');
check(typeof propMetrics.precisionRate === 'number', 'sample fixture must record precisionRate');
check(typeof propMetrics.staleRate === 'number', 'sample fixture must record staleRate');
checkApprox(propMetrics.acceptanceRate as number, expectedRate(accepted, totalProposed), 'sample fixture acceptanceRate must equal accepted / totalProposed');
checkApprox(propMetrics.staleRate as number, expectedRate(stale, totalProposed), 'sample fixture staleRate must equal stale / totalProposed');

const falsePositiveReview = asRecord(propMetrics.falsePositiveReview, 'sample fixture must record falsePositiveReview');
const reviewed = asNumber(falsePositiveReview.reviewed, 'sample fixture falsePositiveReview.reviewed must be a number');
const confirmedFalsePositive = asNumber(falsePositiveReview.confirmedFalsePositive, 'sample fixture falsePositiveReview.confirmedFalsePositive must be a number');
checkInteger(reviewed, 'sample fixture falsePositiveReview.reviewed must be an integer');
checkInteger(confirmedFalsePositive, 'sample fixture falsePositiveReview.confirmedFalsePositive must be an integer');
check(confirmedFalsePositive <= reviewed, 'sample fixture confirmedFalsePositive must be <= reviewed');
checkApprox(falsePositiveReview.falsePositiveRate as number, expectedRate(confirmedFalsePositive, reviewed), 'sample fixture falsePositiveRate must equal confirmedFalsePositive / reviewed');
checkApprox(propMetrics.precisionRate as number, expectedRate(reviewed - confirmedFalsePositive, reviewed), 'sample fixture precisionRate must equal (reviewed - confirmedFalsePositive) / reviewed');
const falsePositiveReasonCounts = asRecord(falsePositiveReview.reasonCounts, 'sample fixture falsePositiveReview.reasonCounts must be an object');
check(sumCounts(falsePositiveReasonCounts, 'falsePositiveReview.reasonCounts') === confirmedFalsePositive, 'sample fixture falsePositiveReview.reasonCounts must sum to confirmedFalsePositive');

const latencyP50 = asNumber(propMetrics.promotionLatencyP50Ms, 'sample fixture must record promotionLatencyP50Ms');
const latencyP95 = asNumber(propMetrics.promotionLatencyP95Ms, 'sample fixture must record promotionLatencyP95Ms');
check(latencyP95 >= latencyP50, 'sample fixture promotionLatencyP95Ms must be >= promotionLatencyP50Ms');

check(typeof curMetrics.humanReviewSampled === 'number', 'sample fixture must record humanReviewSampled');
check(typeof curMetrics.mergeAccuracyEstimate === 'number', 'sample fixture must record mergeAccuracyEstimate');
const mergeProposalsTotal = asNumber(curMetrics.mergeProposalsTotal, 'sample fixture must record mergeProposalsTotal');
const rollbackCount = asNumber(curMetrics.rollbackCount, 'sample fixture must record rollbackCount');
checkInteger(mergeProposalsTotal, 'sample fixture mergeProposalsTotal must be an integer');
checkInteger(rollbackCount, 'sample fixture rollbackCount must be an integer');
check(rollbackCount <= mergeProposalsTotal, 'sample fixture rollbackCount must be <= mergeProposalsTotal');
checkApprox(curMetrics.rollbackRate as number, expectedRate(rollbackCount, mergeProposalsTotal), 'sample fixture rollbackRate must equal rollbackCount / mergeProposalsTotal');

check(
  typeof config.dailyProposalCap === 'number' && (config.dailyProposalCap as number) >= 1,
  'sample fixture must configure dailyProposalCap >= 1'
);

const budgetLimit = asNumber(costBudgetMetrics.budgetLimit, 'sample fixture must record costBudgetMetrics.budgetLimit');
const actualUsage = asNumber(costBudgetMetrics.actualUsage, 'sample fixture must record costBudgetMetrics.actualUsage');
const remainingBudget = asNumber(costBudgetMetrics.remainingBudget, 'sample fixture must record costBudgetMetrics.remainingBudget');
checkApprox(remainingBudget, Math.max(0, budgetLimit - actualUsage), 'sample fixture remainingBudget must equal max(0, budgetLimit - actualUsage)');
check(costBudgetMetrics.overBudget === actualUsage > budgetLimit, 'sample fixture overBudget must match actualUsage > budgetLimit');

console.log(`[rollout-metrics:${mode}] ok (schema and sample verified: precision, false-positive review, acceptance/stale rates, blocked reasons, latency, rollback, daily cap, cost/budget)`);
