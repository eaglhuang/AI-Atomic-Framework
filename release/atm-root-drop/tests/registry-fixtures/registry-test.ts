import assert from 'node:assert/strict';
// @ts-expect-error local fixture module has no declaration file
import { run } from './compute-atom.js';

assert.equal(run('fixture'), 'registry:fixture');
process.stdout.write('Registry fixture test passed.\n');
