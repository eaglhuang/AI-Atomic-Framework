import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIdentitySetRequiredCommand, readGitConfig, writeGitConfig } from './identity-check-command.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-git-identity-'));
execFileSync('git', ['init', '--quiet'], { cwd });
writeGitConfig(cwd, 'user.name', 'ATM Test Author');
writeGitConfig(cwd, 'user.email', 'atm-test-author@example.local');
assert.equal(readGitConfig(cwd, 'user.name'), 'ATM Test Author');
assert.equal(readGitConfig(cwd, 'user.email'), 'atm-test-author@example.local');
assert.equal(
  buildIdentitySetRequiredCommand(cwd, 'unregistered-actor'),
  'node atm.mjs identity set --actor "unregistered-actor" --git-name "<git user.name>" --git-email "<git user.email>" --json',
  'remediation must not copy a local identity into another actor profile',
);

console.log('identity-check-command: ok');
