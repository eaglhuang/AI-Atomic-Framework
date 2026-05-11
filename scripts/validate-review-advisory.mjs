import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  appendMachineFindings,
  createStubReviewAdvisoryReport,
  createUnavailableAdvisoryReport,
  normalizeProviderPayload
} from '../packages/plugin-review-advisory/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function check(condition, message) {
  if (!condition) {
    throw new Error(`[review-advisory:${mode}] ${message}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

for (const relativePath of [
  'packages/plugin-review-advisory/package.json',
  'packages/plugin-review-advisory/src/index.ts',
  'packages/cli/src/commands/review-advisory.mjs',
  'schemas/review-advisory/review-advisory-report.schema.json',
  'fixtures/review-advisory/stub-pass.json',
  'fixtures/review-advisory/stub-warn.json',
  'fixtures/review-advisory/malformed-provider-response.json',
  'fixtures/review-advisory/no-provider-dry-run.json'
]) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const schema = readJson('schemas/review-advisory/review-advisory-report.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateReport = ajv.compile(schema);

const stubPass = readJson('fixtures/review-advisory/stub-pass.json');
check(validateReport(stubPass) === true, `stub-pass fixture schema validation failed: ${JSON.stringify(validateReport.errors)}`);

const stubWarn = readJson('fixtures/review-advisory/stub-warn.json');
check(validateReport(stubWarn) === true, `stub-warn fixture schema validation failed: ${JSON.stringify(validateReport.errors)}`);
check(stubWarn.needsReview === true, 'stub-warn fixture must mark needsReview=true');

const malformed = readJson('fixtures/review-advisory/malformed-provider-response.json');
const malformedNormalized = normalizeProviderPayload(malformed, {
  reportId: 'review-advisory.malformed',
  provider: {
    mode: 'external-cli',
    providerId: 'external-cli-provider',
    providerVersion: '1.0.0',
    transport: 'child-process'
  },
  target: {
    kind: 'scope',
    id: 'malformed-provider-response'
  }
});
check(malformedNormalized.ok === false, 'malformed provider response must not normalize as ok');
check(malformedNormalized.report.advisoryUnavailable === true, 'malformed provider response must degrade to advisory-unavailable');
check(validateReport(malformedNormalized.report) === true, `normalized malformed report schema validation failed: ${JSON.stringify(validateReport.errors)}`);

const unavailableFixture = readJson('fixtures/review-advisory/no-provider-dry-run.json');
check(validateReport(unavailableFixture) === true, `no-provider-dry-run fixture schema validation failed: ${JSON.stringify(validateReport.errors)}`);
check(unavailableFixture.status === 'advisory-unavailable', 'no-provider-dry-run status must be advisory-unavailable');
check(unavailableFixture.needsReview === true, 'no-provider-dry-run must mark needsReview=true');

const unavailableReport = createUnavailableAdvisoryReport({
  reportId: 'review-advisory.provider-missing',
  provider: {
    mode: 'agent-bridge',
    providerId: 'agent-bridge-provider',
    providerVersion: '1.0.0',
    transport: 'json-file'
  },
  target: {
    kind: 'scope',
    id: 'dry-run'
  },
  reason: 'provider-missing'
});
check(validateReport(unavailableReport) === true, `createUnavailableAdvisoryReport must emit schema-valid output: ${JSON.stringify(validateReport.errors)}`);
check(unavailableReport.needsReview === true, 'unavailable advisory must route to needsReview=true');

const stubPassGenerated = createStubReviewAdvisoryReport({
  profile: 'pass',
  reportId: 'review-advisory.stub.pass.generated',
  target: {
    kind: 'proposal',
    id: 'proposal.sample'
  }
});
check(validateReport(stubPassGenerated) === true, `createStubReviewAdvisoryReport(pass) must emit schema-valid output: ${JSON.stringify(validateReport.errors)}`);

const mergedWithMachineFindings = appendMachineFindings(stubPassGenerated, [
  {
    id: 'machine.high-risk.delta',
    severity: 'high',
    message: 'Machine finding indicates high-risk behavior delta.',
    routeHint: 'human-review.required',
    evidenceRef: 'machine.finding.delta'
  }
]);
check(validateReport(mergedWithMachineFindings) === true, `appendMachineFindings output schema validation failed: ${JSON.stringify(validateReport.errors)}`);
check(mergedWithMachineFindings.status === 'warn', 'high severity machine finding must escalate report status to warn');
check(mergedWithMachineFindings.needsReview === true, 'machine finding merge must keep needsReview=true when severity is high');

console.log('[review-advisory:' + mode + '] ok (provider modes, fallback behavior, machine-finding ingest, and schema fixtures verified)');
