import assert from 'node:assert/strict';
import { run } from './compute-atom.js';

assert.equal(run('fixture'), 'registry:fixture');
process.stdout.write('Registry fixture test passed.\n');