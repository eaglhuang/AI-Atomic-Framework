import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace, initializeGitRepository } from '../../scripts/temp-root.ts';
import {
  categorizeHistoricalCommitFiles,
  detectHistoricalDeliveryCommit,
  inspectHistoricalDelivery
} from '../../packages/cli/src/commands/tasks/historical-delivery.ts';

function safeRmSync(targetPath: string) {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // best-effort cleanup for temp workspaces.
  }
}

const declaredFiles = ['src/task-owned.ts', 'release/atm-onefile/atm.mjs'];
const bucketsNoOverlap = categorizeHistoricalCommitFiles({
  taskId: 'TASK-HIST-0049',
  changedFiles: ['src/unrelated-only.ts'],
  declaredFiles
});
assert.equal(bucketsNoOverlap.taskMatchedFiles.length, 0, 'unrelated-only commit must not match task deliverables');
assert.ok(bucketsNoOverlap.outOfScopeSourceFiles.includes('src/unrelated-only.ts'), 'unrelated source must be out-of-scope');

const bucketsMixed = categorizeHistoricalCommitFiles({
  taskId: 'TASK-HIST-0049',
  changedFiles: ['src/task-owned.ts', 'packages/core/src/broker/freeze.ts'],
  declaredFiles
});
assert.ok(bucketsMixed.taskMatchedFiles.includes('src/task-owned.ts'), 'task-owned file must be task-matched');
assert.ok(bucketsMixed.outOfScopeSourceFiles.includes('packages/core/src/broker/freeze.ts'), 'unrelated broker file must be out-of-scope');

const bucketsReleaseAllowed = categorizeHistoricalCommitFiles({
  taskId: 'TASK-HIST-0049',
  changedFiles: ['src/task-owned.ts', 'release/atm-onefile/atm.mjs'],
  declaredFiles
});
assert.ok(bucketsReleaseAllowed.allowedRunnerOutputFiles.includes('release/atm-onefile/atm.mjs'), 'declared runner output must be allowed');
assert.equal(bucketsReleaseAllowed.outOfScopeSourceFiles.length, 0, 'declared runner output must not count as out-of-scope');

const histWorkspace = createTempWorkspace('validate-cli-historical-delivery');
try {
  initializeGitRepository(histWorkspace);
  const ownedPath = path.join(histWorkspace, 'src', 'task-owned.ts');
  mkdirSync(path.dirname(ownedPath), { recursive: true });
  writeFileSync(ownedPath, 'export const owned = true;\n', 'utf8');
  spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'base'], { encoding: 'utf8' });

  const unrelatedPath = path.join(histWorkspace, 'src', 'unrelated-only.ts');
  writeFileSync(unrelatedPath, 'export const unrelated = true;\n', 'utf8');
  spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'unrelated'], { encoding: 'utf8' });
  const unrelatedCommit = spawnSync('git', ['-C', histWorkspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  const unrelatedInspect = inspectHistoricalDelivery({
    cwd: histWorkspace,
    taskId: 'validate-cli-historical-delivery',
    requestedRef: unrelatedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: false,
    waiverReason: null
  });
  assert.equal(unrelatedInspect.ok, false, 'historical delivery without task overlap must fail');
  assert.equal(unrelatedInspect.reason, 'no-scoped-deliverable-files', 'must report no scoped deliverable files');

  const freezePath = path.join(histWorkspace, 'packages', 'core', 'src', 'broker', 'freeze.ts');
  mkdirSync(path.dirname(freezePath), { recursive: true });
  writeFileSync(path.join(histWorkspace, 'src', 'task-owned.ts'), 'export const owned = false;\n', 'utf8');
  writeFileSync(freezePath, 'export {};\n', 'utf8');
  spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'mixed'], { encoding: 'utf8' });
  const mixedCommit = spawnSync('git', ['-C', histWorkspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  const mixedInspect = inspectHistoricalDelivery({
    cwd: histWorkspace,
    taskId: 'validate-cli-historical-delivery',
    requestedRef: mixedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: false,
    waiverReason: null
  });
  assert.equal(mixedInspect.ok, false, 'mixed commit must fail without waiver');
  assert.equal(mixedInspect.reason, 'out-of-scope-source-files-present', 'must report out-of-scope source files');

  const mixedWaiverInspect = inspectHistoricalDelivery({
    cwd: histWorkspace,
    taskId: 'validate-cli-historical-delivery',
    requestedRef: mixedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: true,
    waiverReason: 'captain-approved mixed historical delivery for regression'
  });
  assert.equal(mixedWaiverInspect.ok, true, 'mixed commit must pass with waiver and reason');
  assert.equal(mixedWaiverInspect.reason, 'scoped-deliverable-with-waived-out-of-scope', 'must report waived out-of-scope acceptance');

  const nonDeliveryMarkers = [
    'ATM-WIP: true',
    'ATM-Delivery: false',
    'ATM-Closeout-Eligible: false',
    'atm-wip: TRUE',
    'ATM-Delivery:\tfalse  ',
    'ATM-Delivery: true\nATM-Delivery: false'
  ];
  for (const [index, marker] of nonDeliveryMarkers.entries()) {
    const file = `src/non-delivery-${index}.ts`;
    writeFileSync(path.join(histWorkspace, file), `export const snapshot = ${index};\n`);
    assert.equal(spawnSync('git', ['-C', histWorkspace, 'add', '--', file]).status, 0);
    assert.equal(spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', `preserve snapshot\n\nATM-Task: TASK-NON-DELIVERY\n${marker}`]).status, 0);
    const ref = spawnSync('git', ['-C', histWorkspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const input = {
      cwd: histWorkspace, taskId: 'TASK-NON-DELIVERY', requestedRef: ref,
      declaredFiles: [file], enforceDeclaredScope: true,
      waiverOutOfScopeDelivery: true, waiverReason: 'A scope waiver cannot authorize non-delivery closeout'
    };
    const rejected = inspectHistoricalDelivery(input);
    assert.equal(rejected.ok, false, `explicit ref must reject ${marker}`);
    assert.equal(rejected.reason, 'commit-marked-non-delivery');
    assert.equal(rejected.waiverApplied, false);
    assert.deepEqual(rejected.deliverableFiles, [], 'ineligible files must not feed close dirty-guard allowances');
    assert.ok(Object.values(rejected.fileBuckets).every((files) => files.length === 0), 'historical-batch consumers must not qualify an ineligible snapshot through matched file buckets');
    assert.ok(rejected.changedFiles.includes(file), 'diagnostics must retain the observed source file');
    assert.equal(inspectHistoricalDelivery({ ...input, enforceDeclaredScope: false }).ok, false);
    const detectionInput = { cwd: histWorkspace, taskId: input.taskId, declaredFiles: [file] };
    assert.equal(detectHistoricalDeliveryCommit(detectionInput).ref, null, `auto-detection must reject ${marker}`);
    const planningPath = 'delivery.task.md';
    writeFileSync(path.join(histWorkspace, planningPath), `---\ndelivery_commit: ${ref}\n---\n`);
    assert.equal(detectHistoricalDeliveryCommit({ ...detectionInput, planningRepoRoot: histWorkspace, planningRelativePath: planningPath }).ref, null, 'planning-card references must use the same eligibility gate');
  }

  const formalFile = 'src/formal-delivery.ts';
  writeFileSync(path.join(histWorkspace, formalFile), 'export const delivered = true;\n');
  assert.equal(spawnSync('git', ['-C', histWorkspace, 'add', '--', formalFile]).status, 0);
  assert.equal(spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'formal delivery\n\nATM-WIP: false\nATM-Delivery: true\nATM-Closeout-Eligible: true']).status, 0);
  const formalRef = spawnSync('git', ['-C', histWorkspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const formalInput = { cwd: histWorkspace, taskId: 'TASK-FORMAL', declaredFiles: [formalFile] };
  assert.equal(inspectHistoricalDelivery({ ...formalInput, requestedRef: formalRef, enforceDeclaredScope: true, waiverOutOfScopeDelivery: false, waiverReason: null }).ok, true, 'qualified historical delivery must remain valid');
  assert.equal(detectHistoricalDeliveryCommit(formalInput).ref, formalRef);

  const largeFile = 'src/large-message.ts';
  writeFileSync(path.join(histWorkspace, largeFile), 'export const snapshot = true;\n');
  const messagePath = path.join(histWorkspace, 'commit-message.txt');
  writeFileSync(messagePath, `preserve oversized snapshot\n\n${'x'.repeat(2 * 1024 * 1024)}\n\nATM-WIP: true\n`);
  assert.equal(spawnSync('git', ['-C', histWorkspace, 'add', '--', largeFile]).status, 0);
  assert.equal(spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-F', messagePath]).status, 0);
  const largeInput = { cwd: histWorkspace, taskId: 'TASK-LARGE-MESSAGE', declaredFiles: [largeFile] };
  const unavailable = inspectHistoricalDelivery({ ...largeInput, requestedRef: 'HEAD', enforceDeclaredScope: true, waiverOutOfScopeDelivery: true, waiverReason: 'Not an eligibility waiver' });
  assert.equal(unavailable.ok, false, 'metadata read failure must not be treated as an eligible empty message');
  assert.equal(unavailable.reason, 'commit-message-unavailable');
  assert.deepEqual(unavailable.deliverableFiles, []);
  assert.equal(detectHistoricalDeliveryCommit(largeInput).ref, null);

  const emptyFile = 'src/empty-message.ts';
  writeFileSync(path.join(histWorkspace, emptyFile), 'export const delivered = true;\n');
  writeFileSync(messagePath, '');
  assert.equal(spawnSync('git', ['-C', histWorkspace, 'add', '--', emptyFile]).status, 0);
  assert.equal(spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '--allow-empty-message', '-F', messagePath]).status, 0);
  assert.equal(inspectHistoricalDelivery({ cwd: histWorkspace, taskId: 'TASK-EMPTY-MESSAGE', declaredFiles: [emptyFile], requestedRef: 'HEAD', enforceDeclaredScope: true, waiverOutOfScopeDelivery: false, waiverReason: null }).ok, true, 'a successfully read empty commit message remains eligible');
} finally {
  safeRmSync(histWorkspace);
}

// The registered historical-delivery validator also exercises its taskflow
// consumer so inspection and close-preview eligibility cannot drift apart.
await import('./taskflow-non-delivery-readiness.test.ts');
console.log('[validate-cli-historical-delivery:test] ok');
