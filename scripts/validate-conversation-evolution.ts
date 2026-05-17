import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  ConversationDrivenExtractionError,
  extractEvidenceFromConversations,
  type ConversationEvidenceExtractionInput,
  type ConversationEvidenceExtractionReport
} from '../packages/plugin-sdk/src/conversation/conversation-evidence-extractor.ts';
import { detectEvidencePatterns } from '../packages/plugin-sdk/src/detector/evidence-pattern-detector.ts';
import { createValidator } from './lib/validator-harness.ts';
import type { AnySchema } from 'ajv';

const validator = createValidator('conversation-evolution');
const { createAjv, readJson, repoPath, assert: check, ok } = validator;

type ConversationDrivenFixture = {
  readonly description?: string;
  readonly input: ConversationEvidenceExtractionInput;
  readonly expectedReport?: ConversationEvidenceExtractionReport;
  readonly expectError?: {
    readonly code: 'unredacted-input' | 'sensitive-without-redaction-report';
    readonly sessionId: string;
  };
  readonly detector?: {
    readonly input: Omit<Parameters<typeof detectEvidencePatterns>[0], 'evidence'>;
    readonly expectedReport: ReturnType<typeof detectEvidencePatterns>;
  };
  readonly assertions?: {
    readonly noAtomIdLeak?: boolean;
    readonly downgradedToHostLocal?: boolean;
  };
};

const detectorSchema = readJson<AnySchema>('schemas/governance/detector-report.schema.json');
const ajv = createAjv();
const validateDetectorReport = ajv.compile(detectorSchema);

const fixtureRoot = repoPath('fixtures', 'evolution', 'conversation-driven');
const fixtureFiles = readdirSync(fixtureRoot)
  .filter((entry) => entry.endsWith('.json'))
  .sort();

check(fixtureFiles.length >= 7, `expected at least 7 conversation-driven fixtures, found ${fixtureFiles.length}`);

let extractedCount = 0;
let detectorCount = 0;
let errorCaseCount = 0;

for (const fixtureFile of fixtureFiles) {
  const relativePath = path
    .join('fixtures', 'evolution', 'conversation-driven', fixtureFile)
    .replace(/\\/g, '/');
  const fixture = readJson<ConversationDrivenFixture>(relativePath);

  if (fixture.expectError) {
    let caught: unknown;
    try {
      extractEvidenceFromConversations(fixture.input);
    } catch (error) {
      caught = error;
    }
    check(
      caught instanceof ConversationDrivenExtractionError,
      `${fixtureFile} must throw ConversationDrivenExtractionError; got ${caught === undefined ? 'no throw' : Object.getPrototypeOf(caught)?.constructor?.name}`
    );
    const err = caught as ConversationDrivenExtractionError;
    check(
      err.code === fixture.expectError.code,
      `${fixtureFile} error code mismatch: expected ${fixture.expectError.code}, got ${err.code}`
    );
    check(
      err.sessionId === fixture.expectError.sessionId,
      `${fixtureFile} error sessionId mismatch: expected ${fixture.expectError.sessionId}, got ${err.sessionId}`
    );
    errorCaseCount += 1;
    continue;
  }

  check(fixture.expectedReport !== undefined, `${fixtureFile} must declare expectedReport or expectError`);
  const generatedReport = extractEvidenceFromConversations(fixture.input);
  assert.deepEqual(
    generatedReport,
    fixture.expectedReport,
    `${fixtureFile} extractor report must deep-equal expectedReport`
  );
  extractedCount += 1;

  // Optional structural assertions
  if (fixture.assertions?.noAtomIdLeak === true) {
    for (const evidence of generatedReport.evidence) {
      check(
        evidence.atomId === undefined,
        `${fixtureFile} downgraded evidence must not carry atomId (got ${evidence.atomId})`
      );
      check(
        evidence.atomMapId === undefined,
        `${fixtureFile} downgraded evidence must not carry atomMapId (got ${evidence.atomMapId})`
      );
    }
  }
  if (fixture.assertions?.downgradedToHostLocal === true) {
    for (const evidence of generatedReport.evidence) {
      check(
        evidence.signalScope === 'host-local',
        `${fixtureFile} downgraded evidence must have signalScope=host-local (got ${evidence.signalScope})`
      );
    }
  }

  // Pipe the extracted evidence through the detector and deep-equal the expected detector report.
  if (fixture.detector) {
    const detectorInput = {
      ...fixture.detector.input,
      evidence: generatedReport.evidence
    } as Parameters<typeof detectEvidencePatterns>[0];
    const detectorReport = detectEvidencePatterns(detectorInput);
    check(
      validateDetectorReport(detectorReport) === true,
      `${fixtureFile} detector report failed schema validation: ${JSON.stringify(validateDetectorReport.errors)}`
    );
    check(
      validateDetectorReport(fixture.detector.expectedReport) === true,
      `${fixtureFile} expected detector report failed schema validation: ${JSON.stringify(validateDetectorReport.errors)}`
    );
    assert.deepEqual(
      detectorReport,
      fixture.detector.expectedReport,
      `${fixtureFile} detector report must deep-equal fixture.detector.expectedReport`
    );
    detectorCount += 1;
  }
}

check(errorCaseCount >= 1, 'expected at least one expectError fixture (C3 sensitive-without-redaction)');
check(detectorCount >= 5, `expected at least 5 fixtures with detector pipeline, got ${detectorCount}`);

ok(
  `validated ${fixtureFiles.length} conversation-driven fixtures ` +
    `(extracted=${extractedCount}, detector=${detectorCount}, errorCases=${errorCaseCount})`
);
