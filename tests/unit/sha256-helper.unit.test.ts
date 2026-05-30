/**
 * Unit tests for `sha256` helper.
 */
import assert from 'node:assert/strict';
import { sha256 } from '../../packages/cli/src/commands/tasks/sha256-helper.ts';

// 8+ test cases
assert.equal(sha256(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
assert.equal(sha256('hello').startsWith('sha256:'), true);
assert.equal(sha256('hello'), 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
assert.equal(sha256('hello').length, 71); // 'sha256:' (7 chars) + 64 hex chars = 71 chars
assert.equal(sha256('test'), 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
assert.equal(sha256('123'), 'sha256:a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3');
assert.equal(sha256(' '), 'sha256:36a9e7f1c95b82ffb99743e0c5c4ce95d83c9a430aac59f84ef3cbfab6145068');
assert.equal(sha256('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

console.log('[unit:sha256-helper] ok (8 assertions)');
