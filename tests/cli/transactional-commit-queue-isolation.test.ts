import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildCommitCandidate,
  type CommitCandidate
} from '../../packages/core/src/commit-candidate/commit-candidate.ts';
import {
  InMemoryCommitCandidateStore,
  admitFromStore,
  type RepositoryAdapterCommitEvidence,
  type RepositoryCommitAdapter
} from '../../packages/core/src/commit-candidate/commit-candidate-store.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-commit-queue-isolation-'));

function git(args: readonly string[], env?: Record<string, string>): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(rel: string, body: string): void {
  mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(cwd, rel), body, 'utf8');
}

/**
 * Local Git adapter that persists ONLY the candidate files into an isolated
 * temporary index built from HEAD, mirroring withTaskScopedCommitIndex. It
 * never consumes files staged in the shared index.
 */
class TempIndexGitAdapter implements RepositoryCommitAdapter {
  readonly adapterTarget = 'local-git';

  persist(candidate: CommitCandidate): RepositoryAdapterCommitEvidence {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'atm-adapter-index-'));
    const indexFile = path.join(tempDir, 'index');
    const env = { GIT_INDEX_FILE: indexFile };
    const files = candidate.files.map((file) => file.path);
    try {
      git(['read-tree', 'HEAD'], env);
      // Stage exactly the candidate files from the working tree into the temp index.
      git(['add', '-f', '--', ...files], env);
      const treeStagedBefore = new Set(gitLines(['diff', '--cached', '--name-only'], env));
      const revisionId = git([
        'commit',
        '--no-verify',
        '-m',
        `adapter: persist ${candidate.candidateId}`
      ], env).length > 0 ? git(['rev-parse', 'HEAD'], env) : git(['rev-parse', 'HEAD'], env);
      // Files persisted in this revision = the tree diff of the new commit.
      const persisted = gitLines(['diff-tree', '--no-commit-id', '--name-only', '-r', revisionId]);
      const consumedUnrelated = persisted.filter((file) => !files.includes(file));
      return {
        schemaId: 'atm.repositoryAdapterCommit.v1',
        adapterTarget: this.adapterTarget,
        candidateId: candidate.candidateId,
        isolationMechanism: 'temporary-index',
        persistedFiles: [...treeStagedBefore].sort(),
        consumedUnrelatedFiles: consumedUnrelated.sort(),
        emergencyPathspec: false,
        revisionId
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function gitLines(args: readonly string[], env?: Record<string, string>): string[] {
  return git(args, env).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

try {
  git(['init']);
  git(['config', 'user.email', 'atm@example.invalid']);
  git(['config', 'user.name', 'ATM Test']);
  write('README.md', '# base\n');
  git(['add', '--', 'README.md']);
  git(['commit', '--no-verify', '-m', 'baseline']);

  // Unrelated actor WIP staged in the SHARED git index.
  write('src/foreign-wip.ts', 'export const foreignWip = 1;\n');
  git(['add', '--', 'src/foreign-wip.ts']);
  assert.deepEqual(gitLines(['diff', '--cached', '--name-only']), ['src/foreign-wip.ts']);

  // A docs/backlog candidate authored against the current base.
  write('docs/backlog.md', '# backlog\n- new entry\n');
  const baseSeal = git(['rev-parse', 'HEAD']);
  const candidate: CommitCandidate = buildCommitCandidate({
    candidateId: 'cand-backlog',
    actorId: 'actor-a',
    taskId: 'ATM-GOV-0261',
    frameworkTempId: null,
    laneSessionId: null,
    leaseId: null,
    baseSeal,
    files: [{ path: 'docs/backlog.md', contentDigest: 'sha256:backlog', changeKind: 'add' }],
    allowedResourceKeys: ['file:docs/backlog.md'],
    validationPlan: [],
    evidenceRefs: [],
    expectedTrailers: { 'ATM-Actor': 'actor-a' },
    adapterTarget: 'local-git',
    composeEligible: false,
    createdAt: '2026-07-24T00:00:00.000Z'
  });

  // Single keyspace: the same store the broker uses drives admission; there is
  // no second queue object. Unrelated staged WIP is residue, not a blocker.
  const store = new InMemoryCommitCandidateStore();
  store.submit(candidate);
  const decision = admitFromStore({
    store,
    candidate,
    currentBaseSeal: baseSeal,
    adapterResolved: true,
    unrelatedIndexResidue: ['file:src/foreign-wip.ts'],
    adapterWouldConsumeResidue: false
  });
  assert.equal(decision.verdict, 'execute-now', JSON.stringify(decision));

  // Green path: adapter persists only the admitted candidate payload.
  const adapter = new TempIndexGitAdapter();
  const evidence = adapter.persist(candidate);
  assert.deepEqual(evidence.consumedUnrelatedFiles, [], 'adapter must not consume unrelated staged WIP');
  const committedFiles = gitLines(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
  assert.deepEqual(committedFiles, ['docs/backlog.md']);

  // The unrelated WIP is still staged in the shared index, neither consumed by
  // the commit nor dropped. (docs/backlog.md now also shows in the shared-index
  // diff only because HEAD advanced past it; the commit itself excluded it.)
  const sharedStaged = gitLines(['diff', '--cached', '--name-only']);
  assert.ok(sharedStaged.includes('src/foreign-wip.ts'), 'foreign WIP must remain staged');
  const foreignBlob = git(['rev-parse', ':src/foreign-wip.ts']);
  assert.ok(foreignBlob.length === 40, 'foreign WIP blob must still be intact in the index');

  console.log('transactional-commit-queue-isolation.test passed');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
