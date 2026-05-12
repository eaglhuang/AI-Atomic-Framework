import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message) {
  console.error(`[git-head-evidence:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed\nerror:\n${result.error?.message || ''}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  return result;
}

function runGit(cwd, args) {
  return run('git', args, cwd).stdout.trim();
}

function runAtmDoctor(cwd) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'doctor', '--cwd', cwd, '--json'], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: payload ? JSON.parse(payload) : {}
  };
}

function gitCheck(result) {
  return result.parsed.evidence?.checks?.find((entry) => entry.name === 'git-head-evidence') ?? null;
}

function initGitRepo(repo) {
  mkdirSync(repo, { recursive: true });
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(repo, ['config', 'user.name', 'ATM Validator']);
}

function bootstrap(repo) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'bootstrap', '--cwd', repo, '--json'], {
    cwd: repo,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  const parsed = payload ? JSON.parse(payload) : {};
  assert(result.status === 0, 'bootstrap must exit 0');
  assert(parsed.ok === true, 'bootstrap must report ok=true');
}

function commitAll(repo, message) {
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', message]);
}

function writeGitEvidence(repo, evidence) {
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', 'git-head.json');
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [evidence]
  }, null, 2)}\n`, 'utf8');
}

function createGitEvidence(details) {
  return {
    evidenceKind: 'validation',
    summary: 'Git HEAD is covered by ATM evidence.',
    artifactPaths: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    producedBy: 'validate-git-head-evidence',
    details: {
      git: details
    }
  };
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-git-head-evidence-'));
try {
  const nonGitRepo = path.join(tempRoot, 'non-git');
  mkdirSync(nonGitRepo, { recursive: true });
  const nonGit = runAtmDoctor(nonGitRepo);
  assert(nonGit.exitCode === 0, 'non-git doctor must exit 0');
  assert(nonGit.parsed.ok === true, 'non-git doctor must report ok=true');
  assert(gitCheck(nonGit)?.details?.status === 'not-git', 'non-git doctor must report status=not-git');

  const gitNotAdoptedRepo = path.join(tempRoot, 'git-not-adopted');
  initGitRepo(gitNotAdoptedRepo);
  writeFileSync(path.join(gitNotAdoptedRepo, 'README.md'), '# Host\n', 'utf8');
  commitAll(gitNotAdoptedRepo, 'initial');
  const gitNotAdopted = runAtmDoctor(gitNotAdoptedRepo);
  assert(gitNotAdopted.exitCode === 0, 'git-not-adopted doctor must exit 0');
  assert(gitNotAdopted.parsed.ok === true, 'git-not-adopted doctor must report ok=true');
  assert(gitCheck(gitNotAdopted)?.details?.status === 'not-adopted', 'git-not-adopted doctor must report status=not-adopted');

  const noCommitsRepo = path.join(tempRoot, 'no-commits');
  initGitRepo(noCommitsRepo);
  bootstrap(noCommitsRepo);
  const noCommits = runAtmDoctor(noCommitsRepo);
  assert(noCommits.exitCode === 0, 'no-commits doctor must exit 0');
  assert(noCommits.parsed.ok === true, 'no-commits doctor must report ok=true');
  assert(gitCheck(noCommits)?.details?.status === 'no-commits', 'no-commits doctor must report status=no-commits');

  const orphanRepo = path.join(tempRoot, 'orphan');
  initGitRepo(orphanRepo);
  bootstrap(orphanRepo);
  commitAll(orphanRepo, 'bootstrap without git evidence');
  const orphan = runAtmDoctor(orphanRepo);
  assert(orphan.exitCode === 1, 'orphan doctor must exit 1');
  assert(orphan.parsed.ok === false, 'orphan doctor must report ok=false');
  assert(orphan.parsed.messages.some((entry) => entry.code === 'ATM_DOCTOR_GIT_EVIDENCE_MISSING'), 'orphan doctor must emit ATM_DOCTOR_GIT_EVIDENCE_MISSING');
  assert(gitCheck(orphan)?.details?.status === 'missing', 'orphan doctor must report status=missing');

  const commitSha = runGit(orphanRepo, ['rev-parse', 'HEAD']);
  writeGitEvidence(orphanRepo, createGitEvidence({ commitSha }));
  const commitMatched = runAtmDoctor(orphanRepo);
  assert(commitMatched.exitCode === 0, 'commitSha evidence doctor must exit 0');
  assert(commitMatched.parsed.ok === true, 'commitSha evidence doctor must report ok=true');
  assert(gitCheck(commitMatched)?.details?.matchedBy === 'commitSha', 'commitSha evidence must match by commitSha');

  const treeRepo = path.join(tempRoot, 'tree-parent');
  initGitRepo(treeRepo);
  bootstrap(treeRepo);
  commitAll(treeRepo, 'bootstrap');
  writeFileSync(path.join(treeRepo, 'README.md'), '# Host\n\nChanged under ATM.\n', 'utf8');
  runGit(treeRepo, ['add', 'README.md']);
  const governedTreeSha = runGit(treeRepo, ['write-tree']);
  const parentCommitShas = [runGit(treeRepo, ['rev-parse', 'HEAD'])];
  writeGitEvidence(treeRepo, createGitEvidence({
    treeSha: governedTreeSha,
    parentCommitShas,
    stagedPathCount: 1
  }));
  runGit(treeRepo, ['add', '.atm/history/evidence/git-head.json']);
  runGit(treeRepo, ['commit', '-m', 'change with tree evidence']);
  const treeMatched = runAtmDoctor(treeRepo);
  assert(treeMatched.exitCode === 0, 'tree evidence doctor must exit 0');
  assert(treeMatched.parsed.ok === true, 'tree evidence doctor must report ok=true');
  assert(gitCheck(treeMatched)?.details?.matchedBy === 'treeSha+parentCommitShas', 'tree evidence must match by treeSha+parentCommitShas');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[git-head-evidence:${mode}] ok (doctor git evidence states verified)`);
}
