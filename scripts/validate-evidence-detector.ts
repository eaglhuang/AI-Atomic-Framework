import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { detectEvidencePatterns } from '../packages/plugin-sdk/src/detector/evidence-pattern-detector.ts';
import { createValidator } from './lib/validator-harness.ts';
import type { AnySchema } from 'ajv';

const validator = createValidator('evidence-detector');
const { createAjv, readJson, repoPath, assert: check, ok } = validator;

type DetectorFixture = {
  readonly input: Parameters<typeof detectEvidencePatterns>[0];
  readonly expectedReport: ReturnType<typeof detectEvidencePatterns>;
};

const schema = readJson<AnySchema>('schemas/governance/detector-report.schema.json');
const ajv = createAjv();
const validateReport = ajv.compile(schema);
const fixtureRoot = repoPath('fixtures', 'evolution', 'evidence-patterns');
const fixtureFiles = readdirSync(fixtureRoot)
  .filter((entry) => entry.endsWith('.json'))
  .sort();

check(fixtureFiles.length >= 5, 'expected evidence pattern detector fixtures');

const reports = new Map<string, ReturnType<typeof detectEvidencePatterns>>();

for (const fixtureFile of fixtureFiles) {
  const relativePath = path.join('fixtures', 'evolution', 'evidence-patterns', fixtureFile).replace(/\\/g, '/');
  const fixture = readJson<DetectorFixture>(relativePath);
  const generatedReport = detectEvidencePatterns(fixture.input);
  check(validateReport(generatedReport) === true, `${fixtureFile} generated report failed schema validation: ${JSON.stringify(validateReport.errors)}`);
  check(validateReport(fixture.expectedReport) === true, `${fixtureFile} expected report failed schema validation: ${JSON.stringify(validateReport.errors)}`);
  assert.deepEqual(generatedReport, fixture.expectedReport, `${fixtureFile} generated report must match fixture`);
  reports.set(fixtureFile, generatedReport);
}

check(reports.get('no-signal.json')?.empty === true, 'no-signal fixture must produce empty report');
check(reports.get('recurring-failure-candidate.json')?.proposalCandidateGroupIds.length === 1, 'recurring failure fixture must produce one proposal candidate');
check(reports.get('confidence-threshold.json')?.rejectedEvidenceIds.includes('evidence.confidence.low'), 'confidence fixture must reject low-confidence evidence');
check(reports.get('recurrence-window-test.json')?.rejectedEvidenceIds.includes('evidence.window.previous'), 'window fixture must reject evidence from another recurrence window');

const atomMapGrouping = reports.get('atom-map-grouping.json');
check(Boolean(atomMapGrouping?.groups.some((group) => group.targetKind === 'atom' && group.targetId === 'ATM-CORE-0001')), 'grouping fixture must include atom grouping');
check(Boolean(atomMapGrouping?.groups.some((group) => group.targetKind === 'atom-map' && group.targetId === 'ATM-MAP-0001')), 'grouping fixture must include atom-map grouping');

ok(`validated ${fixtureFiles.length} evidence pattern fixtures`);