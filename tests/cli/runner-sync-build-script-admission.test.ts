import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveActiveRunnerPublicationTask } from '../../scripts/sealed-runner-publication.ts';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

for (const scriptName of ['build', 'build:packages', 'build:root-drop-release', 'build:onefile-release']) {
  assert.ok(
    packageJson.scripts[scriptName]?.startsWith('node --strip-types scripts/run-sealed-runner-build.ts '),
    `${scriptName} must route through sealed-SHA runner sync build steward before generating runner artifacts`
  );
}

const source = readFileSync('scripts/run-sealed-runner-build.ts', 'utf8');
const publicationSource = readFileSync('scripts/sealed-runner-publication.ts', 'utf8');
const candidateBuild = source.indexOf('runTimedInnerBuild(worktreeRoot');
const publicationAdmission = source.indexOf('const publication = resolveSealedRunnerPublication({', candidateBuild);
const publicationSync = source.indexOf('() => syncGeneratedArtifacts(', publicationAdmission);

assert.ok(candidateBuild >= 0, 'sealed runner build must still construct its candidate in the detached worktree');
assert.ok(publicationAdmission > candidateBuild, 'runner-sync admission must occur after isolated candidate construction, never before the long build');
assert.ok(publicationSync > publicationAdmission, 'canonical artifact sync must occur only after queue-head publication admission succeeds');
assert.match(source, /The detached worktree build is intentionally queue-free/);
assert.match(publicationSource, /ensureRunnerPublicationReservation\(input\)/);
assert.match(publicationSource, /'broker', 'runner-sync', 'enqueue'/);
assert.match(publicationSource, /resolveActiveRunnerPublicationTask/);
assert.ok(
  publicationSource.indexOf('const admission = ensureRunnerPublicationReservation(input)')
    < publicationSource.indexOf('const beforeBuildSnapshot = captureRunnerBuildOutputSnapshot'),
  'publication queue acquisition must happen before the canonical root snapshot and shared artifact write'
);

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'atm-runner-publication-'));
const lockRoot = path.join(fixtureRoot, '.atm', 'runtime', 'locks');
const taskRoot = path.join(fixtureRoot, '.atm', 'history', 'tasks');
mkdirSync(lockRoot, { recursive: true });
mkdirSync(taskRoot, { recursive: true });
const now = '2026-08-11T12:00:00.000Z';
const writeLock = (name: string, taskId: string, heartbeatAt: string) => writeFileSync(
  path.join(lockRoot, name),
  JSON.stringify({
    workItemId: taskId,
    actorId: 'runner-steward',
    heartbeatAt,
    ttlSeconds: 300,
    files: ['release/atm-onefile/atm.mjs', 'release/atm-root-drop']
  }),
  'utf8'
);
try {
  writeLock('active.lock.json', 'ATM-GOV-0345', '2026-08-11T11:59:00.000Z');
  writeFileSync(path.join(taskRoot, 'ATM-GOV-0345.json'), JSON.stringify({ claim: { state: 'active', actorId: 'runner-steward', heartbeatAt: '2026-08-11T11:59:50.000Z', ttlSeconds: 300 } }), 'utf8');
  writeLock('expired.lock.json', 'ATM-FRAMEWORK-TEMP-runner-steward-lane-old', '2026-08-11T11:00:00.000Z');
  assert.equal(resolveActiveRunnerPublicationTask({ cwd: fixtureRoot, actorId: 'runner-steward', now, taskId: 'ATM-GOV-0345' }), 'ATM-GOV-0345');

  writeLock('ambiguous.lock.json', 'ATM-GOV-0346', '2026-08-11T11:59:30.000Z');
  assert.throws(
    () => resolveActiveRunnerPublicationTask({ cwd: fixtureRoot, actorId: 'runner-steward', now }),
    /exactly one active release-surface claim.*found 2/
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('[runner-sync-build-script-admission] ok');
