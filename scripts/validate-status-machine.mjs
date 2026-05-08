import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  evaluateRegistryTransition,
  evaluateReviewDisposition,
  registryEntryStatuses,
  registryGovernanceTiers,
  registryTransitionActions,
  registryTransitionRules,
  resolveRegistryDefaultGovernanceTier
} from '../packages/core/src/registry/status-machine.ts';
import { migrateRegistryEntryRecord, migrateRegistryStatus } from '../packages/core/src/registry/status-migration.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixtureRoot = 'fixtures/registry/status';
const legalFixture = readJson(path.join(fixtureRoot, 'legal-transition.json'));
const illegalFixture = readJson(path.join(fixtureRoot, 'illegal-transition.json'));
const legacyMigrationFixture = readJson(path.join(fixtureRoot, 'legacy-map-migration.json'));
const reviewFixture = readJson(path.join(fixtureRoot, 'review-reject-pending-quarantine.json'));

function fail(message) {
  console.error(`[status-machine:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  assert(existsSync(filePath), `missing status machine fixture: ${relativePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function assertDeepEqual(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function compactRule(rule) {
  const compacted = {
    entryTypes: [...rule.entryTypes],
    fromStatuses: [...rule.fromStatuses],
    toStatus: rule.toStatus
  };

  if (Array.isArray(rule.secondaryStatuses) && rule.secondaryStatuses.length > 0) {
    compacted.secondaryStatuses = [...rule.secondaryStatuses];
  }
  if (typeof rule.minSourceCount === 'number') {
    compacted.minSourceCount = rule.minSourceCount;
  }
  if (typeof rule.maxSourceCount === 'number') {
    compacted.maxSourceCount = rule.maxSourceCount;
  }
  if (rule.policeOnly === true) {
    compacted.policeOnly = true;
  }
  if (rule.requiresZeroCallers === true) {
    compacted.requiresZeroCallers = true;
  }
  if (rule.requiresTtlExpired === true) {
    compacted.requiresTtlExpired = true;
  }
  if (Array.isArray(rule.allowedMutabilityPolicies) && rule.allowedMutabilityPolicies.length > 0) {
    compacted.allowedMutabilityPolicies = [...rule.allowedMutabilityPolicies];
  }

  return compacted;
}

function ensureExpectedIssues(actualIssues, expectedIssues, label) {
  for (const expectedIssue of expectedIssues) {
    assert(actualIssues.includes(expectedIssue), `${label} must include issue ${expectedIssue}`);
  }
}

const coveredStatuses = new Set();
const coveredGovernanceTiers = new Set();

assertDeepEqual(legalFixture.entryStatuses, registryEntryStatuses, 'registry status enum must match legal-transition fixture');
assertDeepEqual(legalFixture.governanceTiers, registryGovernanceTiers, 'registry governance tiers must match legal-transition fixture');
assertDeepEqual(
  registryTransitionActions,
  legalFixture.rules.map((rule) => rule.action),
  'registry transition actions must match legal-transition fixture order'
);
assertDeepEqual(
  Object.entries(registryTransitionRules).map(([action, rule]) => ({ action, ...compactRule(rule) })),
  legalFixture.rules,
  'registry transition matrix must match legal-transition fixture'
);

for (const testCase of legalFixture.cases) {
  const result = evaluateRegistryTransition(testCase.input);
  assert(result.ok === true, `${testCase.name} must be legal`);
  assert(result.toStatus === testCase.expect.toStatus, `${testCase.name} must transition to ${testCase.expect.toStatus}`);
  assert(result.governanceTier === testCase.expect.governanceTier, `${testCase.name} must retain governance tier ${testCase.expect.governanceTier}`);
  assert(result.pendingQuarantineRequest === (testCase.expect.pendingQuarantineRequest ?? false), `${testCase.name} pendingQuarantineRequest mismatch`);
  assert(result.policeAction === (testCase.expect.policeAction ?? false), `${testCase.name} policeAction mismatch`);
  ensureExpectedIssues(result.issues, testCase.expect.issues ?? [], testCase.name);
  assert(result.issues.length === (testCase.expect.issues ?? []).length, `${testCase.name} must not emit unexpected issues`);
  if (typeof testCase.input.status === 'string') {
    coveredStatuses.add(testCase.input.status);
  }
  if (typeof result.toStatus === 'string') {
    coveredStatuses.add(result.toStatus);
  }
  if (typeof testCase.input.governanceTier === 'string') {
    coveredGovernanceTiers.add(testCase.input.governanceTier);
  }
  if (typeof result.governanceTier === 'string') {
    coveredGovernanceTiers.add(result.governanceTier);
  }
}

for (const testCase of illegalFixture.cases) {
  const result = evaluateRegistryTransition(testCase.input);
  assert(result.ok === false, `${testCase.name} must be rejected`);
  ensureExpectedIssues(result.issues, testCase.expect.issues, testCase.name);
  if (typeof testCase.input.status === 'string') {
    coveredStatuses.add(testCase.input.status);
  }
  if (typeof testCase.input.governanceTier === 'string') {
    coveredGovernanceTiers.add(testCase.input.governanceTier);
  }
}

for (const testCase of legacyMigrationFixture.recordCases) {
  const migratedStatus = migrateRegistryStatus({
    entryType: testCase.entryType,
    status: testCase.entry.status,
    governanceTier: testCase.entry.governance?.tier ?? null
  });
  const migratedEntry = migrateRegistryEntryRecord(testCase.entry, testCase.entryType);
  assert(migratedStatus.status === testCase.expect.status, `${testCase.name} migrated status mismatch`);
  assert(migratedStatus.governance.tier === testCase.expect.governanceTier, `${testCase.name} migrated governance tier mismatch`);
  assert(migratedStatus.legacyStatus === testCase.expect.legacyStatus, `${testCase.name} legacy status mismatch`);
  assert(migratedEntry.status === testCase.expect.status, `${testCase.name} record migration status mismatch`);
  assert(migratedEntry.governance.tier === testCase.expect.governanceTier, `${testCase.name} record migration governance mismatch`);
  assertDeepEqual(migratedEntry.versions, testCase.entry.versions, `${testCase.name} must preserve versions[]`);
  if (typeof migratedEntry.status === 'string') {
    coveredStatuses.add(migratedEntry.status);
  }
  if (typeof migratedEntry.governance?.tier === 'string') {
    coveredGovernanceTiers.add(migratedEntry.governance.tier);
  }
}

for (const testCase of legacyMigrationFixture.statusCases) {
  const migrated = migrateRegistryStatus(testCase.input);
  assert(migrated.status === testCase.expect.status, `${testCase.name} migrated status mismatch`);
  assert(migrated.governance.tier === testCase.expect.governanceTier, `${testCase.name} migrated governance tier mismatch`);
  assert(migrated.legacyStatus === testCase.expect.legacyStatus, `${testCase.name} legacy status mismatch`);
  if (typeof migrated.status === 'string') {
    coveredStatuses.add(migrated.status);
  }
  if (typeof migrated.governance.tier === 'string') {
    coveredGovernanceTiers.add(migrated.governance.tier);
  }
}

for (const testCase of reviewFixture.cases) {
  const result = evaluateReviewDisposition(testCase.input);
  assert(result.ok === true, `${testCase.name} must be a recognized review disposition`);
  assert(result.fromStatus === testCase.expect.fromStatus, `${testCase.name} must start from ${testCase.expect.fromStatus}`);
  assert(result.toStatus === testCase.expect.toStatus, `${testCase.name} must end at ${testCase.expect.toStatus}`);
  assert(result.governanceTier === testCase.expect.governanceTier, `${testCase.name} must retain governance tier ${testCase.expect.governanceTier}`);
  assert(result.pendingQuarantineRequest === testCase.expect.pendingQuarantineRequest, `${testCase.name} pendingQuarantineRequest mismatch`);
  ensureExpectedIssues(result.issues, testCase.expect.issues ?? [], testCase.name);
  assert(result.issues.length === (testCase.expect.issues ?? []).length, `${testCase.name} must not emit unexpected issues`);
  if (typeof testCase.input.status === 'string') {
    coveredStatuses.add(testCase.input.status);
  }
  if (typeof result.toStatus === 'string') {
    coveredStatuses.add(result.toStatus);
  }
  if (typeof testCase.input.governanceTier === 'string') {
    coveredGovernanceTiers.add(testCase.input.governanceTier);
  }
  if (typeof result.governanceTier === 'string') {
    coveredGovernanceTiers.add(result.governanceTier);
  }
}

assert(resolveRegistryDefaultGovernanceTier('draft', 'map') === 'standard', 'map draft default governance tier must be standard');
assert(resolveRegistryDefaultGovernanceTier('quarantined', 'atom') === 'governed', 'quarantined default governance tier must be governed');

assertDeepEqual([...coveredStatuses].sort(), [...registryEntryStatuses].sort(), 'status coverage must include all seven registry statuses');
assertDeepEqual([...coveredGovernanceTiers].sort(), [...registryGovernanceTiers].sort(), 'governance coverage must include all four governance tiers');

if (!process.exitCode) {
  console.log(`[status-machine:${mode}] ok (${legalFixture.cases.length} legal cases, ${illegalFixture.cases.length} illegal cases, ${legacyMigrationFixture.recordCases.length + legacyMigrationFixture.statusCases.length} migration cases, ${reviewFixture.cases.length} review cases)`);
}