import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const workflow = readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const runner = readFileSync(path.join(root, 'scripts', 'run-validators', 'implementation.ts'), 'utf8');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[standard-validator-timeout] ${message}`);
}

assert(/atm-dogfood:\s+[\s\S]*?timeout-minutes:\s*20/.test(workflow), 'ATM Dogfood must have a 20-minute outer timeout');
assert(/- name: Validate Standard\s+timeout-minutes:\s*15/.test(workflow), 'Validate Standard must have a 15-minute step timeout');
assert(runner.includes('ATM_VALIDATOR_TIMEOUT'), 'validator runner must retain the stable timeout diagnostic code');
assert(runner.includes('atm.validatorTimeoutDiagnostic.v1'), 'validator runner must retain the timeout diagnostic schema');

console.log('standard-validator-timeout: 4/4 passed');
