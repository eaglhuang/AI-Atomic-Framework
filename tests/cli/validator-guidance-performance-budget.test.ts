import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const config = JSON.parse(readFileSync(path.join(root, 'scripts/validators.config.json'), 'utf8')) as {
  validators: Array<Record<string, unknown>>;
};

for (const name of ['validate-guidance', 'validate-guide']) {
  const validator = config.validators.find((entry) => entry.name === name);
  assert.ok(validator, `${name} must remain registered`);
  assert.equal(validator.slow, true, `${name} must use the measured slow-path budget`);
  assert.ok(
    typeof validator.observedSlowPathMs === 'number' && validator.observedSlowPathMs > 10_000,
    `${name} must retain a measured successful slow-path duration`
  );
  assert.equal(typeof validator.observedSlowPathNote, 'string');
}

console.log('[validator-guidance-performance-budget] ok');
