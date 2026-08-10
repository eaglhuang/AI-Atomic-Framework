import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGitConfig, writeGitConfig } from './identity-check-command.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-git-identity-'));
execFileSync('git', ['init', '--quiet'], { cwd });
writeGitConfig(cwd, 'user.name', 'ATM Test Author');
writeGitConfig(cwd, 'user.email', 'atm-test-author@example.local');
assert.equal(readGitConfig(cwd, 'user.name'), 'ATM Test Author');
assert.equal(readGitConfig(cwd, 'user.email'), 'atm-test-author@example.local');

console.log('identity-check-command: ok');
