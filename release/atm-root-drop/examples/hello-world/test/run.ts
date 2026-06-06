import assert from 'node:assert/strict';
import { run } from '../src/hello-world.atom.ts';

const result = run({ name: 'ATM' });

assert.equal(result.message, 'Hello, ATM!');
assert.equal(result.atomId, 'ATM-EXAMPLE-0001');

console.log('[example:hello-world] ok');