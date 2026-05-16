import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacySkillRelativePath = path.join('integrations', 'codex-skills', 'atm-legacy-atomization-guidance', 'SKILL.md');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: any) {
  console.error(`[root-drop-release:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function runAtm(cwd: any, args: any) {
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

const tempRoot = createTempWorkspace('atm-root-drop-release-');
try {
  const release = buildRootDropRelease({
    repositoryRoot: root,
    releaseRoot: path.join(tempRoot, 'release', 'atm-root-drop')
  });
  const manifest = JSON.parse(readFileSync(release.manifestPath, 'utf8'));
  assert(existsSync(release.entrypointPath), 'release bundle must emit atm.mjs');
  assert(existsSync(path.join(release.releaseRoot, 'packages', 'cli', 'dist', 'atm.mjs')), 'release bundle must include CLI dist entrypoint');
  assert(existsSync(path.join(release.releaseRoot, legacySkillRelativePath)), 'release bundle must include ATM legacy atomization skill');
  assert(manifest.entries.includes('integrations'), 'release manifest must include integrations');
  assert(manifest.entrypoint === 'atm.mjs', 'release manifest must preserve atm.mjs entrypoint');

  const bundleRepo = path.join(tempRoot, 'bundle-repo');
  mkdirSync(bundleRepo, { recursive: true });
  cpSync(release.releaseRoot, bundleRepo, { recursive: true });
  initializeGitRepository(bundleRepo);

  const bundleDoctor = runAtm(bundleRepo, ['doctor', '--json']);
  assert(bundleDoctor.exitCode === 0, 'release bundle doctor must exit 0');
  assert(bundleDoctor.parsed.ok === true, 'release bundle doctor must report ok=true');

  const bundleSelfHost = runAtm(bundleRepo, ['self-host-alpha', '--verify', '--json']);
  assert(bundleSelfHost.exitCode === 0, 'release bundle self-host-alpha must exit 0');
  assert(bundleSelfHost.parsed.ok === true, 'release bundle self-host-alpha must report ok=true');

  const blankRepo = path.join(tempRoot, 'blank-repo');
  mkdirSync(blankRepo, { recursive: true });
  cpSync(release.releaseRoot, blankRepo, { recursive: true });
  initializeGitRepository(blankRepo);

  const nextBeforeBootstrap = runAtm(blankRepo, ['next', '--json']);
  assert(nextBeforeBootstrap.exitCode === 1, 'blank root-drop repo next must exit 1 before bootstrap');
  assert(nextBeforeBootstrap.parsed.evidence?.nextAction?.status === 'needs-bootstrap', 'blank root-drop repo must recommend bootstrap first');

  const orient = runAtm(blankRepo, ['orient', '--cwd', '.', '--json']);
  assert(orient.exitCode === 0, 'blank root-drop repo orient must exit 0');
  assert(orient.parsed.ok === true, 'blank root-drop repo orient must report ok=true');
  assert(orient.parsed.evidence?.orientation?.schemaId === 'atm.projectOrientationReport', 'blank root-drop repo orient must emit orientation report');

  const start = runAtm(blankRepo, ['start', '--cwd', '.', '--goal', 'Bootstrap release bundle repo', '--json']);
  assert(start.exitCode === 0, 'blank root-drop repo start must exit 0');
  assert(start.parsed.ok === true, 'blank root-drop repo start must report ok=true');
  assert(start.parsed.evidence?.guidancePacket?.nextCommand, 'blank root-drop repo start must emit guidance packet');

  const explain = runAtm(blankRepo, ['explain', '--cwd', '.', '--why', 'blocked', '--json']);
  assert(explain.exitCode === 0, 'blank root-drop repo explain must exit 0 with active guidance session');
  assert(explain.parsed.ok === true, 'blank root-drop repo explain must report ok=true');

  const bootstrap = runAtm(blankRepo, ['bootstrap', '--cwd', '.', '--task', 'Bootstrap ATM in this repository', '--json']);
  assert(bootstrap.exitCode === 0, 'blank root-drop repo bootstrap must exit 0');
  assert(bootstrap.parsed.ok === true, 'blank root-drop repo bootstrap must report ok=true');

  const installSkill = runAtm(blankRepo, ['guide', 'install-skill', '--cwd', '.', '--target', 'host', '--json']);
  assert(installSkill.exitCode === 0, 'blank root-drop repo guide install-skill must exit 0');
  assert(installSkill.parsed.ok === true, 'blank root-drop repo guide install-skill must report ok=true');
  assert(existsSync(path.join(blankRepo, '.agents', 'skills', 'atm-legacy-atomization-guidance', 'SKILL.md')),
    'blank root-drop repo guide install-skill must install the legacy atomization skill');

  const doctorAfterBootstrap = runAtm(blankRepo, ['doctor', '--json']);
  assert(doctorAfterBootstrap.exitCode === 0, 'blank root-drop repo doctor must exit 0 after bootstrap');
  assert(doctorAfterBootstrap.parsed.ok === true, 'blank root-drop repo doctor must report ok=true after bootstrap');
  assert(doctorAfterBootstrap.parsed.evidence.layoutVersion === 2, 'blank root-drop repo doctor must report layoutVersion=2');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[root-drop-release:' + mode + '] ok (release bundle build, self-host, and blank-repo bootstrap verified)');
}
