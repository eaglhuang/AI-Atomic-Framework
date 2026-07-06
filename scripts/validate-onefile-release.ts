import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.ts';
import { buildOnefileRelease } from './build-onefile-release.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const governanceRouterSkillRelativePath = path.join('integrations', 'codex-skills', 'atm-governance-router', 'SKILL.md');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const adopterLineageFixture = JSON.parse(readFileSync(path.join(root, 'tests/registry-fixtures/adopter-lineage.fixture.json'), 'utf8'));

function fail(message: any) {
  console.error(`[onefile-release:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function runOnefile(entrypointPath: any, cwd: any, args: any, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [entrypointPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv
    }
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: payload ? JSON.parse(payload) : {}
  };
}

function runGit(cwd: any, args: any) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert(result.status === 0, `git ${args.join(' ')} must exit 0`);
  return result.stdout.trim();
}

function tryReadHeadCommitSha(cwd: any) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function refreshOnboarding(entrypointPath: any, cwd: any) {
  const atmChart = runOnefile(entrypointPath, cwd, ['atm-chart', 'render', '--cwd', '.', '--json']);
  assert(atmChart.exitCode === 0, 'onefile atm-chart render must exit 0 after bootstrap');
  assert(atmChart.parsed.ok === true, 'onefile atm-chart render must report ok=true after bootstrap');

  const welcome = runOnefile(entrypointPath, cwd, ['welcome', '--cwd', '.', '--json']);
  assert(welcome.exitCode === 0, 'onefile welcome must exit 0 after bootstrap');
  assert(welcome.parsed.ok === true, 'onefile welcome must report ok=true after bootstrap');
}

function writeGitHeadEvidence(cwd: any) {
  const commitSha = tryReadHeadCommitSha(cwd);
  if (!commitSha) return;
  const evidencePath = path.join(cwd, '.atm', 'history', 'evidence', 'git-head.jsonl');
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Release validator covered the current Git HEAD before doctor.',
        artifactPaths: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        producedBy: 'validate-onefile-release',
        details: {
          git: { commitSha }
        }
      }
    ]
  })}\n`, 'utf8');
}

function writeHostPackageLockSignals(cwd: any) {
  writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({
    name: 'host-with-package-lock',
    version: '0.0.0'
  }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(cwd, 'package-lock.json'), `${JSON.stringify({
    name: 'host-with-package-lock',
    lockfileVersion: 3
  }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(cwd, 'atomic-registry.json'), `${JSON.stringify({
    schemaId: 'atm.registry.v1',
    specVersion: '0.1.0',
    entries: []
  }, null, 2)}\n`, 'utf8');
}

function writeAdopterBackfillFixture(cwd: any) {
  const lineageLogPath = path.join(cwd, 'atomic_workbench', 'maps', 'ATM-MAP-0001', 'lineage-log.json');
  mkdirSync(path.dirname(lineageLogPath), { recursive: true });
  writeFileSync(path.join(cwd, 'atomic-registry-backfill.json'), `${JSON.stringify(adopterLineageFixture.missingLineageRegistryDocument, null, 2)}\n`, 'utf8');
  writeFileSync(lineageLogPath, `${JSON.stringify({
    schemaId: 'atm.mapLineageLog',
    specVersion: '0.1.0',
    canonicalMapId: 'ATM-MAP-0001',
    generatedAt: '2026-05-20T00:00:00.000Z',
    versionLineage: adopterLineageFixture.registryDocument.entries[0].members[0].versionLineage
  }, null, 2)}\n`, 'utf8');
}

const tempRoot = createTempWorkspace('atm-onefile-release-');
await main();

async function main() {
try {
  const rootDrop = buildRootDropRelease({
    repositoryRoot: root,
    releaseRoot: path.join(tempRoot, 'release', 'atm-root-drop')
  });
  const release = buildOnefileRelease({
    repositoryRoot: root,
    rootDropRoot: rootDrop.releaseRoot,
    outputRoot: path.join(tempRoot, 'release', 'atm-onefile')
  });
  assert(existsSync(path.join(rootDrop.releaseRoot, governanceRouterSkillRelativePath)), 'root-drop source for onefile must include governance router skill');
  assert(existsSync(release.outputFilePath), 'onefile build must emit release/atm-onefile/atm.mjs');

  // TASK-RFT-0015 regression guard: the payload must never embed release/**.
  // A nested release/atm-onefile/atm.mjs makes the extracted launcher recurse
  // into the previous runner generation, silently freezing governance behavior.
  {
    const onefileSource = readFileSync(release.outputFilePath, 'utf8');
    const payloadMatch = onefileSource.match(/payloadBase64 = "([^"]+)"/);
    assert(Boolean(payloadMatch), 'onefile runtime must embed payloadBase64');
    const decodedPayload = JSON.parse(gunzipSync(Buffer.from(payloadMatch![1], 'base64')).toString('utf8'));
    const nestedReleaseEntries = decodedPayload.files.filter((entry: { path: string }) => entry.path.startsWith('release/'));
    assert(nestedReleaseEntries.length === 0, `onefile payload must not embed release/** entries (nested launcher recursion); found: ${nestedReleaseEntries.map((entry: { path: string }) => entry.path).slice(0, 5).join(', ')}`);
    assert(decodedPayload.files.some((entry: { path: string }) => entry.path === 'packages/cli/dist/atm.js'), 'onefile payload must keep packages/cli/dist/atm.js so the extracted launcher has a runnable fallback entrypoint');
  }

  const externalBootstrapRepo = path.join(tempRoot, 'external-bootstrap-repo');
  mkdirSync(externalBootstrapRepo, { recursive: true });
  initializeGitRepository(externalBootstrapRepo);
  const externalBootstrap = runOnefile(release.outputFilePath, externalBootstrapRepo, ['bootstrap', '--cwd', '.', '--task', 'Bootstrap ATM in this repository', '--json']);
  assert(externalBootstrap.exitCode === 0, 'external onefile bootstrap must exit 0');
  assert(externalBootstrap.parsed.ok === true, 'external onefile bootstrap must report ok=true');
  assert(existsSync(path.join(externalBootstrapRepo, 'atm.mjs')), 'external onefile bootstrap must install root atm.mjs into host repo');
  assert(existsSync(path.join(externalBootstrapRepo, '.atm', 'runtime', 'pinned-runner.json')), 'external onefile bootstrap must write pinned runner metadata');
  assert(externalBootstrap.parsed.evidence?.pinnedRunner?.status === 'installed', 'external onefile bootstrap must report pinned runner installed');
  assert(externalBootstrap.parsed.evidence?.pinnedRunner?.sourceKind === 'onefile-launcher', 'external onefile bootstrap must source pinned runner from onefile launcher');
  const externalNext = runOnefile(path.join(externalBootstrapRepo, 'atm.mjs'), externalBootstrapRepo, ['next', '--json']);
  assert(externalNext.exitCode === 0 || externalNext.exitCode === 1, 'installed pinned onefile runner next must exit with ATM next status after external bootstrap');
  assert(externalNext.parsed.evidence?.nextAction?.command, 'installed pinned onefile runner next must emit a governed next action after external bootstrap');
  const externalSecondBootstrap = runOnefile(path.join(externalBootstrapRepo, 'atm.mjs'), externalBootstrapRepo, ['bootstrap', '--cwd', '.', '--task', 'Bootstrap ATM in this repository', '--json']);
  assert(externalSecondBootstrap.exitCode === 0, 'installed pinned onefile second bootstrap must exit 0');
  assert(externalSecondBootstrap.parsed.evidence?.unchanged?.includes('atm.mjs'), 'installed pinned onefile second bootstrap must keep atm.mjs unchanged');

  const blankRepo = path.join(tempRoot, 'blank-repo');
  mkdirSync(blankRepo, { recursive: true });
  copyFileSync(release.outputFilePath, path.join(blankRepo, 'atm.mjs'));
  initializeGitRepository(blankRepo);
  assert(!existsSync(path.join(blankRepo, 'packages')), 'blank onefile host must not contain packages directory');
  assert(!existsSync(path.join(blankRepo, 'scripts')), 'blank onefile host must not contain scripts directory');

  const nextBeforeBootstrap = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['next', '--json']);
  assert(nextBeforeBootstrap.exitCode === 1, 'onefile next must exit 1 before bootstrap');
  assert(nextBeforeBootstrap.parsed.evidence?.nextAction?.status === 'needs-bootstrap', 'onefile next must recommend bootstrap');

  const orient = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['orient', '--cwd', '.', '--json']);
  assert(orient.exitCode === 0, 'onefile orient must exit 0');
  assert(orient.parsed.ok === true, 'onefile orient must report ok=true');
  assert(orient.parsed.evidence?.orientation?.schemaId === 'atm.projectOrientationReport', 'onefile orient must emit orientation report');

  const start = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['start', '--cwd', '.', '--goal', 'Bootstrap onefile repo', '--json']);
  assert(start.exitCode === 0, 'onefile start must exit 0');
  assert(start.parsed.ok === true, 'onefile start must report ok=true');
  assert(start.parsed.evidence?.guidancePacket?.nextCommand, 'onefile start must emit guidance packet');

  const explain = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['explain', '--cwd', '.', '--why', 'blocked', '--json']);
  assert(explain.exitCode === 0, 'onefile explain must exit 0 with active guidance session');
  assert(explain.parsed.ok === true, 'onefile explain must report ok=true');

  const bootstrap = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['bootstrap', '--cwd', '.', '--task', 'Bootstrap ATM in this repository', '--json']);
  assert(bootstrap.exitCode === 0, 'onefile bootstrap must exit 0');
  assert(bootstrap.parsed.ok === true, 'onefile bootstrap must report ok=true');
  refreshOnboarding(path.join(blankRepo, 'atm.mjs'), blankRepo);
  writeGitHeadEvidence(blankRepo);
  writeHostPackageLockSignals(blankRepo);

  const registrySmokeRepo = path.join(tempRoot, 'registry-diff-smoke');
  mkdirSync(registrySmokeRepo, { recursive: true });
  initializeGitRepository(registrySmokeRepo);
  copyFileSync(release.outputFilePath, path.join(registrySmokeRepo, 'atm.mjs'));
  writeFileSync(path.join(registrySmokeRepo, 'atomic-registry.json'), `${JSON.stringify(adopterLineageFixture.registryDocument, null, 2)}\n`, 'utf8');
  const registryDiff = runOnefile(path.join(registrySmokeRepo, 'atm.mjs'), registrySmokeRepo, [
    'registry-diff',
    adopterLineageFixture.atomId,
    '--from',
    adopterLineageFixture.fromVersion,
    '--to',
    adopterLineageFixture.toVersion,
    '--registry',
    'atomic-registry.json',
    '--json'
  ]);
  assert(registryDiff.exitCode === 0, 'onefile registry-diff must exit 0 on adopter lineage fixtures');
  assert(registryDiff.parsed.ok === true, 'onefile registry-diff must report ok=true');
  assert(registryDiff.parsed.evidence?.sourceKind === 'member-version-lineage', 'onefile registry-diff must resolve via member lineage');
  assert(registryDiff.parsed.evidence?.report?.driftSummary?.totalChanged === 3, 'onefile registry-diff must preserve the diff report');

  writeAdopterBackfillFixture(registrySmokeRepo);
  const registryBackfill = runOnefile(path.join(registrySmokeRepo, 'atm.mjs'), registrySmokeRepo, [
    'registry',
    'lineage',
    'backfill',
    '--atom',
    adopterLineageFixture.atomId,
    '--from',
    adopterLineageFixture.fromVersion,
    '--to',
    adopterLineageFixture.toVersion,
    '--map',
    'ATM-MAP-0001',
    '--registry',
    'atomic-registry-backfill.json',
    '--lineage-log',
    'atomic_workbench/maps/ATM-MAP-0001/lineage-log.json',
    '--dry-run',
    '--json'
  ]);
  assert(registryBackfill.exitCode === 0, 'onefile registry lineage backfill dry-run must exit 0');
  assert(registryBackfill.parsed.ok === true, 'onefile registry lineage backfill dry-run must report ok=true');
  assert(registryBackfill.parsed.evidence?.patch?.registry?.operations?.[0]?.op === 'add', 'onefile registry lineage backfill must emit an add patch');
  assert(registryBackfill.parsed.evidence?.registryDiff?.driftSummary?.totalChanged === 3, 'onefile registry lineage backfill must trigger registry-diff output');

  const installSkill = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['guide', 'install-skill', '--cwd', '.', '--target', 'host', '--json']);
  assert(installSkill.exitCode === 0, 'onefile guide install-skill must exit 0');
  assert(installSkill.parsed.ok === true, 'onefile guide install-skill must report ok=true');
  assert(existsSync(path.join(blankRepo, '.agents', 'skills', 'atm-governance-router', 'SKILL.md')),
    'onefile guide install-skill must install the governance router skill into the host repo');

  const doctor = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['doctor', '--json']);
  assert(doctor.exitCode === 0, 'onefile doctor must exit 0 after bootstrap');
  assert(doctor.parsed.ok === true, 'onefile doctor must report ok=true after bootstrap');
  assert(doctor.parsed.evidence.layoutVersion === 2, 'onefile doctor must report layoutVersion=2');
  assert(doctor.parsed.evidence.projectRole === 'host', 'onefile doctor must keep package-lock host repos in host mode');
  assert(doctor.parsed.evidence.checks.find((check: any) => check.name === 'public-script-contract')?.ok === true,
    'onefile doctor must not require framework public scripts from package-lock host repos');
  assert(doctor.parsed.evidence.checks.find((check: any) => check.name === 'self-host-alpha-entry')?.ok === true,
    'onefile doctor must not require framework self-host-alpha entry from package-lock host repos');

  const selfHostAlpha = runOnefile(path.join(blankRepo, 'atm.mjs'), blankRepo, ['self-host-alpha', '--verify', '--json']);
  assert(selfHostAlpha.exitCode === 0, 'onefile self-host-alpha must exit 0');
  assert(selfHostAlpha.parsed.ok === true, 'onefile self-host-alpha must report ok=true');

  await validateExtractionLockWait({
    entrypointPath: release.outputFilePath,
    releaseRoot: rootDrop.releaseRoot,
    payloadSha256: JSON.parse(readFileSync(release.manifestPath, 'utf8')).payloadSha256
  });

  assert(!existsSync(path.join(blankRepo, 'packages')), 'onefile runtime must not unpack package files into host repository');
  assert(!existsSync(path.join(blankRepo, 'scripts')), 'onefile runtime must not unpack script files into host repository');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
}

async function validateExtractionLockWait(input: {
  entrypointPath: string;
  releaseRoot: string;
  payloadSha256: string;
}) {
  const cacheBaseRoot = path.join(tempRoot, 'onefile-lock-cache');
  const cacheRoot = path.join(cacheBaseRoot, input.payloadSha256);
  const lockRoot = `${cacheRoot}.lock`;
  rmSync(cacheBaseRoot, { recursive: true, force: true });
  mkdirSync(lockRoot, { recursive: true });
  // Stage the extracted tree before spawning the waiter so the handoff below
  // is a fast rename instead of a multi-second cpSync racing the child's
  // extraction-lock timeout (the real extractor also stages then renames).
  // Exclude release/** to mirror the real payload contents: a nested
  // release/atm-onefile/atm.mjs with the SAME payload sha makes the extracted
  // launcher re-enter its own cache dir and self-spawn forever (TASK-RFT-0015).
  const stagingRoot = `${cacheRoot}.handoff-staging`;
  cpSync(input.releaseRoot, stagingRoot, {
    recursive: true,
    filter: (source) => !path.relative(input.releaseRoot, source).replace(/\\/g, '/').startsWith('release')
  });
  writeFileSync(path.join(stagingRoot, '.payload-ready.json'), JSON.stringify({
    schemaVersion: 'atm.onefilePayload.v0.1',
    generatedAt: '1970-01-01T00:00:00.000Z',
    payloadSha256: input.payloadSha256
  }, null, 2) + '\n', 'utf8');
  writeFileSync(path.join(lockRoot, 'owner.json'), JSON.stringify({
    pid: process.pid,
    fixture: 'validate-onefile-release'
  }, null, 2) + '\n', 'utf8');

  const child = spawn(process.execPath, [input.entrypointPath, '--version'], {
    cwd: root,
    env: {
      ...process.env,
      ATM_ONEFILE_CACHE_ROOT: cacheBaseRoot,
      ATM_ONEFILE_EXTRACT_LOCK_TIMEOUT_MS: '4000',
      ATM_ONEFILE_EXTRACT_LOCK_POLL_MS: '20'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

  await delay(150);
  renameSync(stagingRoot, cacheRoot);
  rmSync(lockRoot, { recursive: true, force: true });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  const payload = (Buffer.concat(stdoutChunks).toString('utf8') || Buffer.concat(stderrChunks).toString('utf8')).trim();
  assert(exitCode === 0, 'onefile runner must survive extraction-lock handoff');
  const parsed = payload ? JSON.parse(payload) : {};
  assert(parsed.command === 'version' && parsed.ok === true, 'onefile extraction-lock handoff must preserve version output');
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

if (!process.exitCode) {
  console.log('[onefile-release:' + mode + '] ok (single-file bootstrap, doctor, self-host-alpha, and extraction-lock wait verified)');
}
