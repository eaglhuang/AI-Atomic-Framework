import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildOnefileRelease } from './build-onefile-release.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: any) {
  console.error(`[onefile-release:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function runOnefile(entrypointPath: any, cwd: any, args: any) {
  const result = spawnSync(process.execPath, [entrypointPath, ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: payload ? JSON.parse(payload) : {}
  };
}

const release = buildOnefileRelease({ repositoryRoot: root });
assert(existsSync(release.outputFilePath), 'onefile build must emit release/atm-onefile/atm.mjs');

const tempRoot = createTempWorkspace('atm-onefile-release-');
try {
  const blankRepo = path.join(tempRoot, 'blank-repo');
  mkdirSync(blankRepo, { recursive: true });
  copyFileSync(release.outputFilePath, path.join(blankRepo, 'atm.mjs'));
  initializeGitRepository(blankRepo);
  assert(!existsSync(path.join(blankRepo, 'packages')), 'blank onefile host must not contain packages directory');
  assert(!existsSync(path.join(blankRepo, 'scripts')), 'blank onefile host must not contain scripts directory');

  const nextBeforeBootstrap = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['next', '--json']);
  assert(nextBeforeBootstrap.exitCode === 1, 'onefile next must exit 1 before bootstrap');
  assert(nextBeforeBootstrap.parsed.evidence?.nextAction?.status === 'needs-bootstrap', 'onefile next must recommend bootstrap');

  const bootstrap = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['bootstrap', '--cwd', '.', '--task', 'Bootstrap ATM in this repository', '--json']);
  assert(bootstrap.exitCode === 0, 'onefile bootstrap must exit 0');
  assert(bootstrap.parsed.ok === true, 'onefile bootstrap must report ok=true');

  const doctor = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['doctor', '--json']);
  assert(doctor.exitCode === 0, 'onefile doctor must exit 0 after bootstrap');
  assert(doctor.parsed.ok === true, 'onefile doctor must report ok=true after bootstrap');
  assert(doctor.parsed.evidence.layoutVersion === 2, 'onefile doctor must report layoutVersion=2');

  const selfHostAlpha = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['self-host-alpha', '--verify', '--json']);
  assert(selfHostAlpha.exitCode === 0, 'onefile self-host-alpha must exit 0');
  assert(selfHostAlpha.parsed.ok === true, 'onefile self-host-alpha must report ok=true');

  assert(!existsSync(path.join(blankRepo, 'packages')), 'onefile runtime must not unpack package files into host repository');
  assert(!existsSync(path.join(blankRepo, 'scripts')), 'onefile runtime must not unpack script files into host repository');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[onefile-release:' + mode + '] ok (single-file bootstrap, doctor, and self-host-alpha verified)');
}
