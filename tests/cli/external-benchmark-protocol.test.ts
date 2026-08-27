import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const validator = path.join(root, 'scripts', 'validate-external-benchmark-protocol.ts');
const canonical = path.join(root, 'scripts', 'fixtures', 'atm-external-benchmark', 'manifest.json');

execFileSync(process.execPath, ['--strip-types', validator], { cwd: root, stdio: 'pipe' });

const invalid = JSON.parse(readFileSync(canonical, 'utf8'));
invalid.arms.baseline.executionMode = 'modeled-worktree';
const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'atm-external-benchmark-'));
const invalidManifest = path.join(tempDirectory, 'invalid-manifest.json');
writeFileSync(invalidManifest, JSON.stringify(invalid, null, 2), 'utf8');
const invalidRun = spawnSync(process.execPath, ['--strip-types', validator, '--manifest', invalidManifest], { cwd: root, encoding: 'utf8' });
assert.notEqual(invalidRun.status, 0, 'a modeled baseline must fail the protocol validator');
assert.match(`${invalidRun.stdout}${invalidRun.stderr}`, /schema validation failed|baseline must use a real Git worktree/);

console.log('external-benchmark-protocol ok');
