import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: any) {
  console.error(`[git-head-evidence:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function run(command: any, args: any, cwd: any) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: createSanitizedGitEnv()
  });
  if (result.error || result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed\nerror:\n${result.error?.message || ''}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  return result;
}

function runGit(cwd: any, args: any) {
  return run('git', args, cwd).stdout.trim();
}

function runAtmDoctor(cwd: any) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'doctor', '--cwd', cwd, '--json'], {
    cwd,
    encoding: 'utf8',
    env: createSanitizedGitEnv()
  });
  const payload = extractJsonPayload((result.stdout || result.stderr || '').trim());
  return {
    exitCode: result.status ?? 0,
    parsed: payload ? JSON.parse(payload) : {}
  };
}

function extractJsonPayload(payload: string) {
  if (!payload) return payload;
  const objectIndex = payload.indexOf('{');
  const arrayIndex = payload.indexOf('[');
  const start = objectIndex === -1
    ? arrayIndex
    : arrayIndex === -1
      ? objectIndex
      : Math.min(objectIndex, arrayIndex);
  return start >= 0 ? payload.slice(start) : payload;
}

function gitCheck(result: any) {
  return result.parsed.evidence?.checks?.find((entry: any) => entry.name === 'git-head-evidence') ?? null;
}

function initGitRepo(repo: any) {
  mkdirSync(repo, { recursive: true });
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(repo, ['config', 'user.name', 'ATM Validator']);
}

function bootstrap(repo: any) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'bootstrap', '--cwd', repo, '--json'], {
    cwd: repo,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  const parsed = payload ? JSON.parse(payload) : {};
  assert(result.status === 0, 'bootstrap must exit 0');
  assert(parsed.ok === true, 'bootstrap must report ok=true');

  const atmChart = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'atm-chart', 'render', '--cwd', repo, '--json'], {
    cwd: repo,
    encoding: 'utf8'
  });
  const atmChartPayload = (atmChart.stdout || atmChart.stderr || '').trim();
  const atmChartParsed = atmChartPayload ? JSON.parse(atmChartPayload) : {};
  assert(atmChart.status === 0, 'atm-chart render must exit 0');
  assert(atmChartParsed.ok === true, 'atm-chart render must report ok=true');

  const welcome = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'welcome', '--cwd', repo, '--json'], {
    cwd: repo,
    encoding: 'utf8'
  });
  const welcomePayload = (welcome.stdout || welcome.stderr || '').trim();
  const welcomeParsed = welcomePayload ? JSON.parse(welcomePayload) : {};
  assert(welcome.status === 0, 'welcome must exit 0');
  assert(welcomeParsed.ok === true, 'welcome must report ok=true');
}

function commitAll(repo: any, message: any) {
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', message]);
}

function writeGitEvidence(repo: any, evidence: any) {
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', 'git-head.jsonl');
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [evidence]
  })}\n`, 'utf8');
}

function writeGitEvidenceLegacy(repo: any, evidence: any) {
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', 'git-head.json');
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [evidence]
  }, null, 2)}\n`, 'utf8');
}

function createGitEvidence(details: any) {
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

function createSanitizedGitEnv() {
  const env = { ...process.env };
  for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']) {
    delete env[key];
  }
  return env;
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
  assert(orphan.exitCode === 0, 'adopter orphan doctor must exit 0');
  assert(orphan.parsed.ok === true, 'adopter orphan doctor must report ok=true');
  assert(!orphan.parsed.messages.some((entry: any) => entry.code === 'ATM_DOCTOR_GIT_EVIDENCE_WARNING'), 'adopter non-critical orphan doctor must not emit ATM_DOCTOR_GIT_EVIDENCE_WARNING');
  assert(gitCheck(orphan)?.details?.status === 'not-required-non-critical-head', 'non-critical orphan doctor must report status=not-required-non-critical-head');
  assert((gitCheck(orphan)?.details?.criticalChangedFiles || []).length === 0, 'non-critical orphan doctor must report no critical changed files');

  const commitSha = runGit(orphanRepo, ['rev-parse', 'HEAD']);
  writeGitEvidenceLegacy(orphanRepo, createGitEvidence({ commitSha }));
  const commitMatched = runAtmDoctor(orphanRepo);
  assert(commitMatched.exitCode === 0, 'commitSha evidence doctor must exit 0');
  assert(commitMatched.parsed.ok === true, 'commitSha evidence doctor must report ok=true');
  assert(gitCheck(commitMatched)?.details?.matchedBy === 'commitSha', 'commitSha evidence must match by commitSha');
  runGit(orphanRepo, ['add', '.atm/history/evidence/git-head.json']);
  runGit(orphanRepo, ['commit', '-m', 'backfill git head evidence']);
  const evidenceOnlyMatched = runAtmDoctor(orphanRepo);
  assert(evidenceOnlyMatched.exitCode === 0, 'evidence-only HEAD doctor must exit 0');
  assert(evidenceOnlyMatched.parsed.ok === true, 'evidence-only HEAD doctor must report ok=true');
  assert(gitCheck(evidenceOnlyMatched)?.details?.evidenceOnlyHead === true, 'evidence-only HEAD must be recognized');
  assert(gitCheck(evidenceOnlyMatched)?.details?.matchedBy === 'evidenceOnlyParentCommitSha', 'evidence-only HEAD must match parent commit evidence');

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
  runGit(treeRepo, ['add', '.atm/history/evidence/git-head.jsonl']);
  runGit(treeRepo, ['commit', '-m', 'change with tree evidence']);
  const treeMatched = runAtmDoctor(treeRepo);
  assert(treeMatched.exitCode === 0, 'tree evidence doctor must exit 0');
  assert(treeMatched.parsed.ok === true, 'tree evidence doctor must report ok=true');
  assert(gitCheck(treeMatched)?.details?.matchedBy === 'treeSha+parentCommitShas', 'tree evidence must match by treeSha+parentCommitShas');

  const inheritedGitEnvRepo = path.join(tempRoot, 'inherited-git-env');
  initGitRepo(inheritedGitEnvRepo);
  bootstrap(inheritedGitEnvRepo);
  writeFileSync(path.join(inheritedGitEnvRepo, 'README.md'), '# Host\n', 'utf8');
  commitAll(inheritedGitEnvRepo, 'initial');
  const originalGitDir = process.env.GIT_DIR;
  const originalGitWorkTree = process.env.GIT_WORK_TREE;
  const originalGitPrefix = process.env.GIT_PREFIX;
  process.env.GIT_DIR = path.join(orphanRepo, '.git');
  process.env.GIT_WORK_TREE = orphanRepo;
  process.env.GIT_PREFIX = 'poisoned/';
  try {
    const inheritedGitEnv = runAtmDoctor(inheritedGitEnvRepo);
    assert(inheritedGitEnv.exitCode === 0, 'doctor must ignore inherited git env contamination');
    assert(inheritedGitEnv.parsed.ok === true, 'doctor under inherited git env contamination must report ok=true');
    assert(gitCheck(inheritedGitEnv)?.details?.status === 'not-required-non-critical-head', 'doctor under inherited git env contamination must still inspect the target repo as non-critical head');
  } finally {
    if (originalGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = originalGitDir;
    if (originalGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = originalGitWorkTree;
    if (originalGitPrefix === undefined) delete process.env.GIT_PREFIX;
    else process.env.GIT_PREFIX = originalGitPrefix;
  }

  const bareMismatchRepo = path.join(tempRoot, 'bare-mismatch');
  initGitRepo(bareMismatchRepo);
  bootstrap(bareMismatchRepo);
  writeFileSync(path.join(bareMismatchRepo, 'README.md'), '# Bare mismatch\n', 'utf8');
  commitAll(bareMismatchRepo, 'initial');
  runGit(bareMismatchRepo, ['config', '--local', 'core.bare', 'true']);
  const bareMismatch = runAtmDoctor(bareMismatchRepo);
  assert(bareMismatch.exitCode === 1, 'doctor must fail when a checked-out repo is misconfigured as bare');
  assert(bareMismatch.parsed.ok === false, 'doctor must report ok=false for bare/worktree mismatch');
  assert(bareMismatch.parsed.messages.some((entry: any) => entry.code === 'ATM_DOCTOR_GIT_WORKTREE_BARE_MISMATCH'), 'doctor must emit a dedicated bare/worktree mismatch message');
  assert(gitCheck(bareMismatch)?.details?.status === 'bare-worktree-mismatch', 'git-head-evidence must classify bare/worktree mismatch explicitly');
  const readinessCheck = bareMismatch.parsed.evidence?.checks?.find((entry: any) => entry.name === 'git-worktree-readiness');
  assert(readinessCheck?.ok === false, 'doctor git-worktree-readiness check must fail for bare/worktree mismatch');
  assert(readinessCheck?.details?.recommendedFixCommand === 'git config --local core.bare false', 'doctor must recommend the local core.bare repair command');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[git-head-evidence:${mode}] ok (doctor git evidence states verified)`);
}
