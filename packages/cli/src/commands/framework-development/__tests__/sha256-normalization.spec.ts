import assert from 'node:assert/strict';
import { normalizeSha256DigestValue, normalizeSha256FieldsDeep } from '../sha256-normalization.ts';

const upperHex = 'A'.repeat(64);
const lowerHex = 'a'.repeat(64);

assert.equal(normalizeSha256DigestValue(`sha256:${upperHex}`), `sha256:${lowerHex}`);
assert.equal(normalizeSha256DigestValue(lowerHex), lowerHex);

assert.deepEqual(
  normalizeSha256FieldsDeep({
    outer: {
      stdoutSha256: `sha256:${upperHex}`,
      list: [`sha256:${upperHex}`]
    }
  }),
  {
    outer: {
      stdoutSha256: `sha256:${lowerHex}`,
      list: [`sha256:${lowerHex}`]
    }
  }
);

assert.equal(normalizeSha256DigestValue('sha256:not-a-valid-digest'), 'sha256:not-a-valid-digest');

console.log('[framework-development-sha256-normalization:test] ok');
