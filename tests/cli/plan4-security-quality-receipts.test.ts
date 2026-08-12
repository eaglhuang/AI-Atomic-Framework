import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileSecurityQualityReceipts, replaySecurityQualityReceipts, validateSecurityQualityReceipts } from '../../packages/core/src/evidence/security-quality-receipts.ts';

const authority = { authorityId: 'sec-1', digest: 'sha256:a', sealed: true as const };
const receipt = compileSecurityQualityReceipts({ runId: 'r', generatedAt: '2026-08-09', authority, observedAuthorityDigest: authority.digest, requiredSurfaces: ['api'], findings: [{ findingId: 'f', surface: 'api', severity: 'low', status: 'pass', digest: 'sha256:f' }], provenance: { producer: 'focused-test' } });
const schema = JSON.parse(readFileSync(new URL('../../schemas/evidence/security-quality-receipts.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
assert.equal(receipt.status, 'proven');
assert.equal(validateSchema(receipt), true, JSON.stringify(validateSchema.errors));
assert.deepEqual(replaySecurityQualityReceipts(receipt), receipt);
assert.deepEqual(validateSecurityQualityReceipts(receipt), { ok: true, diagnostics: [] });
assert.deepEqual(validateSecurityQualityReceipts({ ...receipt, projection: { ...receipt.projection, findingCount: 99 } }), { ok: false, diagnostics: ['result-digest-mismatch'] });
console.log('plan4 security quality receipts: ok');
