import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sealCommitBundle } from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import {
  assertCommitAttribution,
  readCommittedTreeEntries,
  runWithSealedTaskScopedCommitIndex
} from './sealed-commit-attribution.ts';
import { withTaskScopedCommitIndex } from './git-index-transaction.ts';
import { ensureGovernedGitHeadEvidenceStagedForTaskScopedCommit } from './git-head-evidence-transaction.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-commit-parity-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
mkdirSync(path.join(repo, 'src'), { recursive: true });
writeFileSync(path.join(repo, 'src', 'expected.ts'), 'export const expected = 1;\n');
writeFileSync(path.join(repo, 'src', 'actual.ts'), 'export const actual = 1;\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'actual commit'], { cwd: repo, stdio: 'ignore' });
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const expectedBlob = execFileSync('git', ['hash-object', 'src/expected.ts'], { cwd: repo, encoding: 'utf8' }).trim();

assert.throws(() => assertCommitAttribution({
  sealed: sealCommitBundle({ entries: [{ path: 'src/expected.ts', mode: '100644', blobId: expectedBlob, provenance: 'task-scope', disposition: 'present' }] }),
  actual: readCommittedTreeEntries(repo, commitSha),
  surface: 'test post-commit tree parity', actorId: 'validator', taskId: 'ATM-GOV-0371'
}), (error: unknown) => (error as { code?: string }).code === 'ATM_COMMIT_ATTRIBUTION_MISMATCH');

// A sealed path may be inherited unchanged from the parent. The verifier must
// inspect the resulting tree, not mistake a no-op diff for a missing path.
execFileSync('git', ['commit', '--allow-empty', '-m', 'unchanged candidate entry'], { cwd: repo, stdio: 'ignore' });
const inheritedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
assert.doesNotThrow(() => assertCommitAttribution({
  sealed: sealCommitBundle({ entries: [{ path: 'src/expected.ts', mode: '100644', blobId: expectedBlob, provenance: 'task-scope', disposition: 'present' }] }),
  actual: readCommittedTreeEntries(repo, inheritedCommit, ['src/expected.ts']),
  surface: 'test inherited post-commit tree parity', actorId: 'validator', taskId: 'ATM-GOV-0371'
}));

// A commit can move HEAD before the wrapper regains control. The transaction
// must still fail closed instead of returning a success receipt for a tree
// that differs from its sealed candidate.
writeFileSync(path.join(repo, 'src', 'expected.ts'), 'export const expected = 2;\n');
writeFileSync(path.join(repo, 'src', 'actual.ts'), 'export const actual = 2;\n');
const sealedExpectedBlob = execFileSync('git', ['hash-object', 'src/expected.ts'], { cwd: repo, encoding: 'utf8' }).trim();
const sealedExpected = sealCommitBundle({
  entries: [{ path: 'src/expected.ts', mode: '100644', blobId: sealedExpectedBlob, provenance: 'task-scope', disposition: 'present' }]
});
const headBeforeMismatchedTransaction = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

assert.throws(() => runWithSealedTaskScopedCommitIndex({
  cwd: repo,
  paths: ['src/expected.ts'],
  provenance: 'task-scope',
  actorId: 'validator',
  taskId: 'ATM-GOV-0371',
  surface: 'test sealed transaction',
  sealSource: { kind: 'sealed-bundle', bundle: sealedExpected },
  run: (env) => execFileSync('git', ['commit', '--only', '-m', 'mismatched commit', '--', 'src/actual.ts'], { cwd: repo, env, stdio: 'ignore' })
}), (error: unknown) => (error as { code?: string }).code === 'ATM_COMMIT_ATTRIBUTION_MISMATCH');

assert.notEqual(
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  headBeforeMismatchedTransaction,
  'fixture must prove that the transaction detects a post-commit mismatch after HEAD advances'
);

// Git-head observations describe the candidate but remain local telemetry.
// They must not become entries in the tree they describe.
writeFileSync(path.join(repo, '.gitignore'), '.atm/\n');
execFileSync('git', ['add', '.gitignore'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'ignore runtime'], { cwd: repo, stdio: 'ignore' });
mkdirSync(path.join(repo, 'packages', 'core'), { recursive: true });
writeFileSync(path.join(repo, 'packages', 'core', 'example.ts'), 'export const candidate = true;\n');
const candidateDir = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-candidate-'));
const candidateEnv = { ...process.env, GIT_INDEX_FILE: path.join(candidateDir, 'index') };
execFileSync('git', ['read-tree', 'HEAD'], { cwd: repo, env: candidateEnv, stdio: 'ignore' });
execFileSync('git', ['add', '--', 'packages/core/example.ts'], { cwd: repo, env: candidateEnv, stdio: 'ignore' });
const candidateTree = execFileSync('git', ['write-tree'], { cwd: repo, env: candidateEnv, encoding: 'utf8' }).trim();
const candidateParent = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const observation = ensureGovernedGitHeadEvidenceStagedForTaskScopedCommit(
  repo,
  'validator',
  'ATM-GOV-0371',
  ['packages/core/example.ts'],
  candidateEnv
);
assert.ok(observation);
assert.equal(observation.evidencePath, null);
assert.equal(observation.runtimeEvidencePath, '.atm/runtime/telemetry/git-head.jsonl');
assert.equal(observation.treeSha, candidateTree);
assert.deepEqual(observation.parentCommitShas, [candidateParent]);
const runtimeObservationPath = path.join(repo, observation.runtimeEvidencePath);
assert.ok(existsSync(runtimeObservationPath));
const latestObservation = () => JSON.parse(readFileSync(runtimeObservationPath, 'utf8').trim().split(/\r?\n/).at(-1)!);
const candidateDetails = latestObservation().evidence[0].details;
assert.equal(candidateDetails.taskId, 'ATM-GOV-0371');
assert.equal(candidateDetails.actorId, 'validator');
assert.equal(candidateDetails.git.treeSha, candidateTree);
assert.deepEqual(candidateDetails.git.parentCommitShas, [candidateParent]);
const observationPaths = ['.atm/history/evidence/git-head.jsonl', observation.runtimeEvidencePath];
assert.equal(
  execFileSync('git', ['ls-files', '--', ...observationPaths], { cwd: repo, env: candidateEnv, encoding: 'utf8' }).trim(),
  '',
  'neither legacy nor runtime git-head observations belong in the candidate index'
);

// The public transaction boundary commits the governed source while retaining
// its observation locally, outside the final commit tree.
const governedSourceBlob = execFileSync('git', ['hash-object', 'packages/core/example.ts'], { cwd: repo, encoding: 'utf8' }).trim();
const governedSeal = sealCommitBundle({
  entries: [{ path: 'packages/core/example.ts', mode: '100644', blobId: governedSourceBlob, provenance: 'task-scope', disposition: 'present' }]
});
withTaskScopedCommitIndex(
  repo,
  ['packages/core/example.ts'],
  'validator',
  'ATM-GOV-0371',
  (env: NodeJS.ProcessEnv) => execFileSync('git', ['commit', '-m', 'commit generated provenance'], { cwd: repo, env, stdio: 'ignore' }),
  { kind: 'sealed-bundle', bundle: governedSeal },
);
const provenanceCommitFiles = execFileSync('git', ['show', '--format=', '--name-only', 'HEAD'], { cwd: repo, encoding: 'utf8' });
assert.match(
  provenanceCommitFiles,
  /packages\/core\/example\.ts/,
  'the governed source must reach the final commit'
);
assert.equal(
  execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', ...observationPaths], { cwd: repo, encoding: 'utf8' }).trim(),
  '',
  'neither legacy nor runtime git-head observations belong in the final commit tree'
);
assert.ok(existsSync(runtimeObservationPath));
assert.equal(latestObservation().evidence[0].details.git.treeSha, candidateTree);
assert.deepEqual(latestObservation().evidence[0].details.git.parentCommitShas, [candidateParent]);

// Task-scoped cleanup commonly carries ignored governance evidence.  It must
// survive candidate-index assembly just like an ordinary source path; otherwise
// `git commit` sees an empty candidate and incorrectly reports no changes.
mkdirSync(path.join(repo, '.atm', 'history', 'protected-override-audit'), { recursive: true });
const ignoredEvidencePath = '.atm/history/protected-override-audit/audit.json';
writeFileSync(path.join(repo, ignoredEvidencePath), '{"schemaId":"atm.protectedOverrideAudit.v1"}\n');
const ignoredEvidenceBlob = execFileSync('git', ['hash-object', ignoredEvidencePath], { cwd: repo, encoding: 'utf8' }).trim();
withTaskScopedCommitIndex(
  repo,
  [ignoredEvidencePath],
  'validator',
  'ATM-GOV-0371',
  (env: NodeJS.ProcessEnv) => {
    assert.match(
      execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, env, encoding: 'utf8' }),
      /\.atm\/history\/protected-override-audit\/audit\.json/,
      'the candidate index must retain an ignored governance-evidence entry before commit'
    );
    return execFileSync('git', ['commit', '-m', 'commit ignored governance evidence'], { cwd: repo, env, stdio: 'ignore' });
  },
  {
    kind: 'sealed-bundle',
    bundle: sealCommitBundle({
      entries: [{ path: ignoredEvidencePath, mode: '100644', blobId: ignoredEvidenceBlob, provenance: 'governance-evidence', disposition: 'present' }]
    })
  }
);
assert.match(
  execFileSync('git', ['show', '--format=', '--name-only', 'HEAD'], { cwd: repo, encoding: 'utf8' }),
  /\.atm\/history\/protected-override-audit\/audit\.json/,
  'an ignored governance-evidence path must remain in the sealed candidate commit'
);

console.log('[sealed-commit-attribution] committed-tree mismatch fails closed.');
