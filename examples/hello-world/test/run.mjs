import assert from 'node:assert/strict';
import { run } from '../src/hello-world.atom.mjs';

const result = run({ name: 'ATM' });

assert.equal(result.message, 'Hello, ATM!');
assert.equal(result.atomId, 'atom.example.hello-world');

console.log('[example:hello-world] ok');