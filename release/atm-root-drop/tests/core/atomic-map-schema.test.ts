import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schema = readJson('schemas/registry/atomic-map.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const v1Fixture = readJson('tests/schema-fixtures/positive/atomic-map-0.1-minimal.json');
const v2Fixture = readJson('tests/schema-fixtures/positive/atomic-map-0.2-replacement.json');

assert.equal(validate(v1Fixture), true, formatErrors(validate.errors));
assert.equal(validate(v2Fixture), true, formatErrors(validate.errors));

const invalidV1WithReplacement = {
  ...v1Fixture,
  members: [
    {
      atomId: 'ATM-FIXTURE-0001',
      version: '0.1.0',
      role: 'entry-adapter'
    }
  ],
  replacement: {
    legacyUris: ['legacy://samples/checkout-mini'],
    mode: 'draft',
    evidenceRefs: []
  }
};
assert.equal(validate(invalidV1WithReplacement), false, '0.1.0 maps must reject replacement-surface fields');

console.log('[atomic-map-schema:test] ok (0.1/0.2 fixtures)');

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function formatErrors(errors: unknown) {
  return JSON.stringify(errors ?? [], null, 2);
}
