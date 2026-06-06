import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

ajv.addSchema(readJson('schemas/test-report/metrics.schema.json'));
const validate = ajv.compile(readJson('schemas/governance/map-equivalence-report.schema.json'));

const positive = readJson('tests/schema-fixtures/map-equivalence-report/positive.json');
assert.equal(validate(positive), true, formatErrors(validate.errors));

const negative = readJson('tests/schema-fixtures/map-equivalence-report/known-divergence-missing-review-ref.json');
assert.equal(validate(negative), false, 'known divergences without reviewRef must be rejected');
assert.ok(
  (validate.errors || []).some((error: any) => error.keyword === 'required' && error.params?.missingProperty === 'reviewRef'),
  formatErrors(validate.errors)
);

const specValidate = runAtm(['spec', '--validate', 'tests/schema-fixtures/map-equivalence-report/positive.json', '--json']);
assert.equal(specValidate.exitCode, 0, specValidate.raw);
assert.equal(specValidate.parsed.ok, true);
assert.equal(specValidate.parsed.evidence.schemaId, 'atm.mapEquivalenceReport');
assert.equal(specValidate.parsed.evidence.validated[0], 'tests/schema-fixtures/map-equivalence-report/positive.json');

console.log('[map-equivalence-report:test] ok (schema + fixture + spec validate)');

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function formatErrors(errors: unknown) {
  return JSON.stringify(errors ?? [], null, 2);
}

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const raw = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    raw,
    parsed: JSON.parse(raw || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}