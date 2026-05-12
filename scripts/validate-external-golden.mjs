import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.mjs';
import { createTempWorkspace } from './temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixtureRoot = path.join(root, 'fixtures', 'golden', 'downstream-js-repo');

function fail(message) {
  console.error(`[external-golden:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runAtm(cwd, args) {
  const result = spawnSync(process.execPath, [path.join(cwd, 'atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: payload ? JSON.parse(payload) : {}
  };
}

function copyReleaseBundleIntoHost(sourceRoot, targetRoot) {
  for (const entry of ['atm.mjs', 'atomic-registry.json', 'atomic_workbench', 'docs', 'examples', 'packages', 'schemas', 'scripts', 'specs', 'templates', 'tests', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'eslint.config.mjs', 'tsconfig.json', 'tsconfig.build.json', 'turbo.json']) {
    cpSync(path.join(sourceRoot, entry), path.join(targetRoot, entry), { recursive: true });
  }
}

assert(existsSync(path.join(fixtureRoot, 'package.json')), 'external golden fixture must provide package.json');
assert(existsSync(path.join(fixtureRoot, 'src', 'index.mjs')), 'external golden fixture must provide source file');
const fixtureReadme = readFileSync(path.join(fixtureRoot, 'README.md'), 'utf8');
assert(!fixtureReadme.includes('ATM-CORE-0001'), 'external golden fixture README must not depend on ATM seed identifiers');

const release = buildRootDropRelease({ repositoryRoot: root });
const tempRoot = createTempWorkspace('atm-external-golden-');
try {
  const hostRepo = path.join(tempRoot, 'downstream-js-repo');
  mkdirSync(hostRepo, { recursive: true });
  cpSync(fixtureRoot, hostRepo, { recursive: true });
  copyReleaseBundleIntoHost(release.releaseRoot, hostRepo);

  const hostPackage = JSON.parse(readFileSync(path.join(hostRepo, 'package.json'), 'utf8'));
  assert(hostPackage.name === 'downstream-js-repo-fixture', 'release overlay must preserve downstream package.json');

  const nextBeforeBootstrap = runAtm(hostRepo, ['next', '--json']);
  assert(nextBeforeBootstrap.exitCode === 1, 'external golden next must exit 1 before bootstrap');
  assert(nextBeforeBootstrap.parsed.evidence?.nextAction?.status === 'needs-bootstrap', 'external golden next must recommend bootstrap');

  const bootstrap = runAtm(hostRepo, ['bootstrap', '--cwd', '.', '--task', 'Bootstrap ATM in this repository', '--json']);
  assert(bootstrap.exitCode === 0, 'external golden bootstrap must exit 0');
  assert(bootstrap.parsed.ok === true, 'external golden bootstrap must report ok=true');

  const doctor = runAtm(hostRepo, ['doctor', '--json']);
  assert(doctor.exitCode === 0, 'external golden doctor must exit 0');
  assert(doctor.parsed.ok === true, 'external golden doctor must report ok=true');
  assert(doctor.parsed.evidence.layoutVersion === 2, 'external golden doctor must report layoutVersion=2');

  const handoff = runAtm(hostRepo, ['handoff', 'summarize', '--task', 'BOOTSTRAP-0001', '--json']);
  assert(handoff.exitCode === 0, 'external golden handoff summarize must exit 0');
  assert(handoff.parsed.ok === true, 'external golden handoff summarize must report ok=true');
  assert(existsSync(path.join(hostRepo, '.atm', 'history', 'handoff', 'BOOTSTRAP-0001.md')), 'external golden handoff markdown must exist');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[external-golden:' + mode + '] ok (downstream-neutral fixture bootstrapped through release bundle)');
}
