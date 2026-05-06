import assert from 'node:assert/strict';
import { run } from '../src/greeting.atom.mjs';

const result = run({ name: 'team' });

assert.equal(result.greeting, 'Welcome back, team.');
assert.equal(result.source, 'legacy-system');
assert.equal(result.atomId, 'atom.example.legacy-greeting');
assert.equal(result.wrapped, true);

console.log('[example:legacy-strangler-minimal] ok');