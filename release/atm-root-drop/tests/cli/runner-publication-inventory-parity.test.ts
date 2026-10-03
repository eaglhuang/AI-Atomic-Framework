import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  captureRunnerBuildOutputSnapshot,
  deriveRunnerBuildOutputInventory,
  evaluateRunnerPublicationDisposition,
  inventoryRecoveryBlockers,
  planRunnerPublicationTakeover,
  scanSealedRunnerBuildOutputInventory,
  validateRunnerPublicationTakeoverPlan,
  verifyRunnerBuildOutputParity
} from '../../packages/core/src/broker/runner-build-output-inventory.ts';
import { createHash } from 'node:crypto';
import { readRunnerPublicationDirtyPaths } from '../../packages/cli/src/commands/framework-development/runner-publication-residue.ts';
import { buildRunnerSyncReceipt } from '../../scripts/runner-sync-incremental-build.ts';
import { syncGeneratedArtifacts } from '../../scripts/run-sealed-runner-build.ts';

const inventory = deriveRunnerBuildOutputInventory({
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  observedPaths: [
    'packages/cli/dist/atm.js',
    'release/atm-onefile/atm.mjs',
    'release/atm-root-drop/atm.mjs',
    'docs/ignored.md'
  ],
  currentTaskId: 'TASK-GIT-0017'
});

assert.deepEqual(inventory.entries.map((entry) => entry.path), [
  'packages/cli/dist/atm.js',
  'release/atm-onefile/atm.mjs',
  'release/atm-root-drop/atm.mjs'
]);
assert.equal(verifyRunnerBuildOutputParity(inventory, inventory.entries.map((entry) => entry.path)).ok, true);
assert.deepEqual(
  verifyRunnerBuildOutputParity(inventory, ['packages/cli/dist/atm.js', 'release/atm-onefile/release-manifest.json']).missing,
  ['release/atm-onefile/release-manifest.json']
);

const receipt = buildRunnerSyncReceipt({
  admission: {
    queueHeadOwnership: { waitingTasks: ['TASK-GIT-0017'], stewardWorkId: 'runner-sync-fixture' },
    runnerSyncSteward: {
      requestedSurfaces: [],
      requests: [{ taskId: 'TASK-GIT-0017', actorId: 'captain', requestedSurfaces: [] }]
    }
  } as never,
  actorId: 'captain',
  sealedSourceSha: inventory.sealedSourceSha,
  outputInventory: inventory,
  buildTarget: 'full',
  buildInputsTreeHash: 'sha256:input',
  buildDecision: 'fullRebuild',
  timings: {
    startedAt: 0, inputHashCalculationMs: 0, skipDecisionMs: 0, worktreeSetupMs: 0,
    typescriptBuildMs: 0, rootDropAssemblyMs: 0, onefileAssemblyMs: 0,
    artifactSyncMs: 0, cleanupMs: 0, totalElapsedMs: 0
  }
});
assert.equal(receipt.outputInventory.digest, inventory.digest);
assert.deepEqual(receipt.outputInventory.entries, inventory.entries);

const pending = evaluateRunnerPublicationDisposition({
  inventory,
  dirtyPaths: [
    'packages/cli/dist/atm.js',
    '.atm/history/evidence/TASK-TMP-0005.residue-reconciliation.json'
  ]
});
assert.equal(pending.disposition, 'publication-pending');
assert.deepEqual(pending.dirtyInventoryPaths, ['packages/cli/dist/atm.js']);
assert.deepEqual(pending.extraOutputPaths, []);

const published = evaluateRunnerPublicationDisposition({
  inventory,
  dirtyPaths: ['packages/cli/dist/atm.js'],
  terminalDisposition: 'published'
});
assert.equal(published.disposition, 'published');
assert.equal(published.ok, true);

const foreignWip = evaluateRunnerPublicationDisposition({
  inventory,
  dirtyPaths: ['release/atm-onefile/release-manifest.json']
});
assert.equal(foreignWip.ok, false);
assert.equal(foreignWip.disposition, 'inventory-incomplete');
assert.deepEqual(foreignWip.extraOutputPaths, ['release/atm-onefile/release-manifest.json']);

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'atm-runner-inventory-'));
const git = (...args: string[]) => {
  const result = spawnSync('git', args, { cwd: fixtureRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
mkdirSync(path.join(fixtureRoot, 'release', 'atm-onefile'), { recursive: true });
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'atm.mjs'), 'base\n');
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'release-manifest.json'), 'base\n');
git('init');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'ATM test');
git('add', '.');
git('commit', '-m', 'fixture');
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'release-manifest.json'), 'foreign-wip\n');
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'atm.mjs'), 'stale-generated\n');
const snapshot = captureRunnerBuildOutputSnapshot({
  cwd: fixtureRoot,
  buildTarget: 'onefile',
  currentTaskId: 'TASK-FIXTURE-0011',
  currentTaskAllowedFiles: ['release/atm-onefile/atm.mjs']
});
assert.deepEqual(snapshot.preexistingDirtyPaths, ['release/atm-onefile/release-manifest.json']);
const takeoverPlan = planRunnerPublicationTakeover({
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  snapshot
});
assert.equal(validateRunnerPublicationTakeoverPlan({
  plan: takeoverPlan,
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  snapshot
}).ok, true);
assert.equal(validateRunnerPublicationTakeoverPlan({
  plan: { ...takeoverPlan, sealedSourceSha: 'fedcba9876543210fedcba9876543210fedcba98' },
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  snapshot
}).ok, false);
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'atm.mjs'), 'generated-by-build\n');
const deltaInventory = scanSealedRunnerBuildOutputInventory({
  cwd: fixtureRoot,
  buildTarget: 'onefile',
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  taskId: 'TASK-ERR-0011',
  beforeBuildSnapshot: snapshot
});
assert.deepEqual(deltaInventory.entries.map((entry) => entry.path), [
  '.atm/history/evidence/TASK-ERR-0011.runner-sync-receipt.json',
  'release/atm-onefile/atm.mjs'
]);
const sealedInventory = scanSealedRunnerBuildOutputInventory({
  cwd: fixtureRoot,
  buildTarget: 'onefile',
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  taskId: 'TASK-ERR-0011',
  beforeBuildSnapshot: snapshot,
  includeDirtyPublicationMembers: true
});
assert.deepEqual(sealedInventory.entries.map((entry) => entry.path), [
  '.atm/history/evidence/TASK-ERR-0011.runner-sync-receipt.json',
  'release/atm-onefile/atm.mjs',
  'release/atm-onefile/release-manifest.json'
]);
const sourceRoot = path.join(fixtureRoot, 'build-output');
mkdirSync(path.join(sourceRoot, 'release', 'atm-onefile'), { recursive: true });
writeFileSync(path.join(sourceRoot, 'release', 'atm-onefile', 'atm.mjs'), 'rebuilt\n');
writeFileSync(path.join(sourceRoot, 'release', 'atm-onefile', 'release-manifest.json'), 'would-overwrite\n');
const syncResult = syncGeneratedArtifacts(sourceRoot, fixtureRoot, 'onefile', snapshot.preexistingDirtyPaths);
assert.equal(readFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'atm.mjs'), 'utf8'), 'rebuilt\n');
assert.equal(readFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'release-manifest.json'), 'utf8'), 'foreign-wip\n');
assert.deepEqual(syncResult.preservedPaths, ['release/atm-onefile/release-manifest.json']);

// Regression: these exact root-drop paths can be status-dirty while Git's
// normalized staged and unstaged diff name sets are both empty.
const crlfRoot = mkdtempSync(path.join(tmpdir(), 'atm-runner-inventory-crlf-'));
try {
  const runGit = (...args: string[]): string => {
    const result = spawnSync('git', args, { cwd: crlfRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const rootDropPaths = [
    'packages/create-atm/src/index.ts',
    'scripts/validate-npm-clean-install.ts',
    'tests/cli/create-atm-installed-entrypoint.test.ts',
    'tests/cli/npm-clean-install.test.ts',
    'tests/cli/validator-execution-receipt-hard-gate.test.ts',
    'tests/package-skeleton.fixture.json'
  ].map((entry) => `release/atm-root-drop/${entry}`).sort();
  const writeOutput = (relative: string, contents: string, root = crlfRoot) => {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  };
  const sha = inventory.sealedSourceSha;
  const taskId = 'TASK-INVENTORY-CRLF';
  const lf = 'first line\nsecond line\n';
  const crlf = 'first line\r\nsecond line\r\n';
  runGit('init');
  runGit('config', 'user.email', 'test@example.invalid');
  runGit('config', 'user.name', 'ATM test');
  runGit('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(crlfRoot, '.gitattributes'), '* text=auto eol=lf\n');
  for (const entry of rootDropPaths) writeOutput(entry, lf);
  const stagedPath = 'release/atm-root-drop/staged.txt';
  const unstagedPath = 'release/atm-root-drop/unstaged.txt';
  const deletedPath = 'release/atm-root-drop/deleted.txt';
  const untrackedPath = 'release/atm-root-drop/untracked.txt';
  for (const entry of [stagedPath, unstagedPath, deletedPath]) writeOutput(entry, lf);
  runGit('add', '.');
  runGit('commit', '-m', 'LF publication fixture');
  const cleanSnapshot = captureRunnerBuildOutputSnapshot({ cwd: crlfRoot, buildTarget: 'root-drop' });
  assert.deepEqual(cleanSnapshot.preexistingDirtyPaths, []);
  for (const entry of rootDropPaths) writeOutput(entry, crlf);
  assert.equal(runGit('diff', '--name-only').trim(), '');
  assert.equal(runGit('diff', '--name-only', '--cached').trim(), '');
  assert.deepEqual(readRunnerPublicationDirtyPaths(crlfRoot).sort(), rootDropPaths);
  const status = runGit('status', '--porcelain', '--untracked-files=all');
  for (const entry of rootDropPaths) assert.ok(status.split(/\r?\n/).includes(` M ${entry}`));

  // BEFORE collection must protect all status-only dirty members, even when
  // the same raw bytes remain unchanged throughout the build.
  const before = captureRunnerBuildOutputSnapshot({ cwd: crlfRoot, buildTarget: 'root-drop' });
  assert.deepEqual(before.preexistingDirtyPaths, rootDropPaths);
  const rawDigest = `sha256:${createHash('sha256').update(Buffer.from(crlf)).digest('hex')}`;
  for (const entry of rootDropPaths) {
    assert.equal(before.members[entry], rawDigest);
    assert.notEqual(before.members[entry], cleanSnapshot.members[entry]);
  }
  const scoped = captureRunnerBuildOutputSnapshot({
    cwd: crlfRoot, buildTarget: 'root-drop', currentTaskId: taskId,
    currentTaskAllowedFiles: [rootDropPaths[0]]
  });
  assert.deepEqual(scoped.preexistingDirtyPaths, rootDropPaths.slice(1));
  const scan = (takeoverPaths: readonly string[] = []) => scanSealedRunnerBuildOutputInventory({
    cwd: crlfRoot, buildTarget: 'root-drop', sealedSourceSha: sha, taskId,
    beforeBuildSnapshot: before, includeDirtyPublicationMembers: true, takeoverPaths
  });
  const protectedInventory = scan();
  assert.deepEqual(inventoryRecoveryBlockers(protectedInventory).map((entry) => entry.path), rootDropPaths);
  for (const entry of protectedInventory.entries.filter((entry) => rootDropPaths.includes(entry.path))) {
    assert.equal(entry.disposition, 'unowned');
    assert.equal(entry.ownerTaskId, null);
  }
  const replacementRoot = path.join(crlfRoot, 'replacement');
  for (const entry of rootDropPaths) writeOutput(entry, 'replacement\n', replacementRoot);
  for (const entry of [stagedPath, unstagedPath, deletedPath]) writeOutput(entry, lf, replacementRoot);
  const preserved = syncGeneratedArtifacts(replacementRoot, crlfRoot, 'root-drop', before.preexistingDirtyPaths);
  assert.deepEqual([...preserved.preservedPaths].sort(), rootDropPaths);
  for (const entry of rootDropPaths) assert.deepEqual(readFileSync(path.join(crlfRoot, entry)), Buffer.from(crlf));

  const exact = planRunnerPublicationTakeover({ sealedSourceSha: sha, snapshot: before });
  const validate = (plan: unknown, snapshot = before) => validateRunnerPublicationTakeoverPlan({
    plan, sealedSourceSha: sha, snapshot
  });
  assert.equal(validate(exact).ok, true);
  const takenOver = scan(exact.entries.map((entry) => entry.path));
  assert.deepEqual(inventoryRecoveryBlockers(takenOver), []);
  assert.deepEqual(takenOver.entries.filter((entry) => rootDropPaths.includes(entry.path)).map((entry) => entry.path), rootDropPaths);
  assert.ok(takenOver.entries.every((entry) => entry.disposition === 'owned-current'));

  // Correctly digested but partial/broadened proposals still cannot authorize
  // a different set. These are fixture-only plans, never persisted authority.
  const partial = planRunnerPublicationTakeover({ sealedSourceSha: sha, snapshot: {
    ...before, preexistingDirtyPaths: rootDropPaths.slice(1)
  } });
  assert.equal(validate(partial).ok, false);
  const broadened = planRunnerPublicationTakeover({ sealedSourceSha: sha, snapshot: {
    ...before, preexistingDirtyPaths: [...rootDropPaths, stagedPath]
  } });
  assert.equal(validate(broadened).ok, false);
  writeOutput(rootDropPaths[0], 'first line\r\nsecond line\n');
  const changedBytes = captureRunnerBuildOutputSnapshot({ cwd: crlfRoot, buildTarget: 'root-drop' });
  assert.deepEqual(changedBytes.preexistingDirtyPaths, rootDropPaths);
  assert.notEqual(changedBytes.members[rootDropPaths[0]], before.members[rootDropPaths[0]]);
  assert.equal(validate(exact, changedBytes).ok, false);
  writeOutput(rootDropPaths[0], crlf);

  // AFTER collection must match consumer observations and retain ordinary
  // staged, unstaged, deleted and untracked publication members as well.
  writeOutput(stagedPath, 'staged change\n');
  runGit('add', '--', stagedPath);
  writeOutput(unstagedPath, 'unstaged change\n');
  rmSync(path.join(crlfRoot, deletedPath));
  writeOutput(untrackedPath, 'untracked change\n');
  const mixedBefore = captureRunnerBuildOutputSnapshot({ cwd: crlfRoot, buildTarget: 'root-drop' });
  const dirty = readRunnerPublicationDirtyPaths(crlfRoot).filter((entry) => entry.startsWith('release/atm-root-drop/')).sort();
  assert.deepEqual(dirty, [...rootDropPaths, stagedPath, unstagedPath, deletedPath, untrackedPath].sort());
  assert.deepEqual(mixedBefore.preexistingDirtyPaths, dirty);
  const mixed = scanSealedRunnerBuildOutputInventory({
    cwd: crlfRoot, buildTarget: 'root-drop', sealedSourceSha: sha, taskId,
    beforeBuildSnapshot: mixedBefore, includeDirtyPublicationMembers: true
  });
  assert.deepEqual(mixed.entries.filter((entry) => entry.path.startsWith('release/atm-root-drop/')).map((entry) => entry.path), dirty);
  assert.deepEqual(inventoryRecoveryBlockers(mixed).map((entry) => entry.path), dirty);
  assert.equal(mixedBefore.members[deletedPath], 'missing');
  const unexpectedPath = 'release/atm-root-drop/unexpected-after-inventory.txt';
  writeOutput(unexpectedPath, 'not inventoried\n');
  const incomplete = evaluateRunnerPublicationDisposition({
    inventory: mixed, dirtyPaths: readRunnerPublicationDirtyPaths(crlfRoot), terminalDisposition: 'published'
  });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.disposition, 'inventory-incomplete');
  assert.deepEqual(incomplete.extraOutputPaths, [unexpectedPath]);
} finally {
  rmSync(crlfRoot, { recursive: true, force: true });
}
console.log('[runner-publication-inventory-parity.test] ok');
