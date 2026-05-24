import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string): never {
  console.error(`[git-hooks-enforcement:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function run(command: string, args: readonly string[], cwd: string, options: { allowFailure?: boolean; env?: Record<string, string> } = {}) {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env ?? {})
    }
  });
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    fail(`${command} ${args.join(' ')} failed\nerror:\n${result.error?.message || ''}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  return result;
}

function runGit(repo: string, args: readonly string[], options: { allowFailure?: boolean; env?: Record<string, string> } = {}) {
  return run('git', args, repo, options);
}

function runCli(repo: string, args: readonly string[], options: { allowFailure?: boolean; env?: Record<string, string> } = {}) {
  return run(process.execPath, ['atm.mjs', ...args], repo, options);
}

function parsePayload(result: ReturnType<typeof run>) {
  const payload = (result.stdout || result.stderr || '').trim();
  return payload ? JSON.parse(payload) : {};
}

function createCommandRun(command: string, stdoutSha256: string) {
  return {
    command,
    cwd: '.',
    exitCode: 0,
    stdoutSha256,
    stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    runnerVersion: '0.1.0'
  };
}

function copyRuntime(sourceRoot: string, targetRoot: string) {
  for (const entry of ['atm.mjs', 'atomic-registry.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'eslint.config.mjs', 'docs', 'packages', 'scripts', 'schemas', 'specs', 'templates', 'examples']) {
    const sourcePath = path.join(sourceRoot, entry);
    if (!existsSync(sourcePath)) continue;
    cpSync(sourcePath, path.join(targetRoot, entry), { recursive: true });
  }
}

const preCommitTemplate = readFileSync(path.join(root, 'templates', 'enforcement', 'pre-commit.sh'), 'utf8');
assert(preCommitTemplate.includes('node atm.mjs atm-chart verify --json'), 'pre-commit enforcement template must verify ATMChart freshness');
assert(preCommitTemplate.includes('node atm.mjs hook pre-commit --json'), 'pre-commit enforcement template must delegate to ATM hook pre-commit');
assert(preCommitTemplate.includes('node atm.mjs tasks audit --json'), 'pre-commit enforcement template must audit task closure integrity');
assert(preCommitTemplate.includes('node atm.mjs agent-pack verify-fresh --id "$pack_id" --json'), 'pre-commit enforcement template must verify installed agent-pack freshness');

const examplePreCommit = readFileSync(path.join(root, 'examples', 'git-hooks-enforcement', 'hooks', 'pre-commit'), 'utf8');
assert(examplePreCommit.includes('node atm.mjs hook pre-commit --json'), 'example pre-commit hook must use hook pre-commit command');

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-git-hooks-'));
try {
  const repo = path.join(tempRoot, 'host');
  mkdirSync(repo, { recursive: true });
  copyRuntime(root, repo);
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(repo, ['config', 'user.name', 'ATM Hook Validator']);

  const bootstrapPayload = parsePayload(runCli(repo, ['bootstrap', '--cwd', repo, '--json']));
  assert(bootstrapPayload.ok === true, 'bootstrap must report ok=true');

  const atmChartPayload = parsePayload(runCli(repo, ['atm-chart', 'render', '--cwd', repo, '--json']));
  assert(atmChartPayload.ok === true, 'atm-chart render must report ok=true');

  const welcomePayload = parsePayload(runCli(repo, ['welcome', '--cwd', repo, '--json']));
  assert(welcomePayload.ok === true, 'welcome must report ok=true');

  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '--no-verify', '-m', 'initial baseline']);

  const installPayload = parsePayload(runCli(repo, ['integration', 'add', 'claude-code', '--force', '--json']));
  assert(installPayload.ok === true, 'integration add claude-code must report ok=true');
  const hookVerifyPayload = parsePayload(runCli(repo, ['integration', 'hooks', 'verify', 'claude-code', '--json']));
  assert(hookVerifyPayload.ok === true, 'integration hooks verify claude-code must report ok=true');
  assert(existsSync(path.join(repo, '.atm', 'git-hooks', 'pre-commit')), 'git-hooks install must write .atm/git-hooks/pre-commit');
  assert(existsSync(path.join(repo, '.atm', 'git-hooks', 'pre-push')), 'git-hooks install must write .atm/git-hooks/pre-push');

  writeFileSync(path.join(repo, 'docs-only.txt'), 'governed commit\n', 'utf8');
  runGit(repo, ['add', 'docs-only.txt']);
  const governedCommit = runGit(repo, ['commit', '-m', 'governed docs change']);
  assert(governedCommit.status === 0, 'governed commit must succeed with hooks installed');
  assert(existsSync(path.join(repo, '.atm', 'history', 'evidence', 'git-head.json')), 'pre-commit hook must write git-head evidence');

  const governedDoctor = parsePayload(runCli(repo, ['doctor', '--json']));
  assert(governedDoctor.ok === true, 'doctor must report ok=true after governed commit');

  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const bypass = true;\n', 'utf8');
  runGit(repo, ['add', 'packages/core/src/index.ts']);
  const noHooksDir = path.join(tempRoot, 'no-hooks');
  mkdirSync(noHooksDir, { recursive: true });
  runGit(repo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'bypass hooks']);

  const bypassDoctor = runCli(repo, ['doctor', '--json'], { allowFailure: true });
  const bypassDoctorPayload = parsePayload(bypassDoctor);
  assert(bypassDoctor.status === 1, 'doctor must fail after bypass commit');
  assert(bypassDoctorPayload.ok === false, 'doctor must report ok=false after bypass commit');
  assert(bypassDoctorPayload.messages.some((entry: any) => entry.code === 'ATM_DOCTOR_GIT_EVIDENCE_MISSING'), 'doctor must emit ATM_DOCTOR_GIT_EVIDENCE_MISSING after bypass commit');

  const commitRange = runCli(repo, ['guard', 'commit-range', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
  const commitRangePayload = parsePayload(commitRange);
  assert(commitRange.status === 1, 'commit-range guard must fail for critical bypass commit');
  assert(commitRangePayload.messages.some((entry: any) => entry.code === 'ATM_GUARD_COMMIT_RANGE_FAILED'), 'commit-range guard must emit ATM_GUARD_COMMIT_RANGE_FAILED');

  const legacyBaselineRepo = path.join(tempRoot, 'legacy-baseline-cut');
  mkdirSync(legacyBaselineRepo, { recursive: true });
  copyRuntime(root, legacyBaselineRepo);
  runGit(legacyBaselineRepo, ['init']);
  runGit(legacyBaselineRepo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(legacyBaselineRepo, ['config', 'user.name', 'ATM Hook Validator']);
  assert(parsePayload(runCli(legacyBaselineRepo, ['bootstrap', '--cwd', legacyBaselineRepo, '--json'])).ok === true, 'legacy-baseline bootstrap must report ok=true');
  assert(parsePayload(runCli(legacyBaselineRepo, ['atm-chart', 'render', '--cwd', legacyBaselineRepo, '--json'])).ok === true, 'legacy-baseline atm-chart render must report ok=true');
  assert(parsePayload(runCli(legacyBaselineRepo, ['welcome', '--cwd', legacyBaselineRepo, '--json'])).ok === true, 'legacy-baseline welcome must report ok=true');
  runGit(legacyBaselineRepo, ['add', '.']);
  runGit(legacyBaselineRepo, ['commit', '--no-verify', '-m', 'initial baseline']);
  const legacyInitialSha = String(runGit(legacyBaselineRepo, ['rev-parse', 'HEAD']).stdout || '').trim();

  writeFileSync(path.join(legacyBaselineRepo, 'packages', 'core', 'src', 'index.ts'), 'export const acceptedLegacyBypass = true;\n', 'utf8');
  runGit(legacyBaselineRepo, ['add', 'packages/core/src/index.ts']);
  runGit(legacyBaselineRepo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'legacy bypass before cut']);
  const acceptedLegacyCommitSha = String(runGit(legacyBaselineRepo, ['rev-parse', 'HEAD']).stdout || '').trim();

  const legacyBaselineManifestPath = path.join(legacyBaselineRepo, '.atm', 'history', 'baselines', 'framework-commit-range.json');
  mkdirSync(path.dirname(legacyBaselineManifestPath), { recursive: true });
  writeFileSync(legacyBaselineManifestPath, `${JSON.stringify({
    schemaId: 'atm.frameworkCommitRangeBaseline.v1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    name: 'fixture-framework-legacy-cut',
    refName: 'fixture-framework-legacy-cut',
    commitSha: acceptedLegacyCommitSha,
    acceptedHistoryThroughCommitSha: acceptedLegacyCommitSha,
    strictEvidenceRequiredAfterCommitSha: acceptedLegacyCommitSha,
    rationale: 'Fixture baseline cut for legacy framework history.'
  }, null, 2)}\n`, 'utf8');
  runGit(legacyBaselineRepo, ['add', '.atm/history/baselines/framework-commit-range.json']);
  runGit(legacyBaselineRepo, ['commit', '--no-verify', '-m', 'record framework legacy baseline cut']);

  const legacyOnlyRange = runCli(legacyBaselineRepo, ['guard', 'commit-range', '--base', legacyInitialSha, '--head', 'HEAD', '--json'], { allowFailure: true });
  const legacyOnlyPayload = parsePayload(legacyOnlyRange);
  assert(legacyOnlyRange.status === 0, 'commit-range guard must accept legacy critical history before the framework baseline cut');
  assert((legacyOnlyPayload.evidence?.report?.ignoredLegacyCriticalCommitCount ?? 0) >= 1, 'commit-range report must count ignored legacy critical commits');

  writeFileSync(path.join(legacyBaselineRepo, 'packages', 'core', 'src', 'index.ts'), 'export const rejectedPostBaselineBypass = true;\n', 'utf8');
  runGit(legacyBaselineRepo, ['add', 'packages/core/src/index.ts']);
  runGit(legacyBaselineRepo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'post-baseline bypass without evidence']);
  const postBaselineRange = runCli(legacyBaselineRepo, ['guard', 'commit-range', '--base', legacyInitialSha, '--head', 'HEAD', '--json'], { allowFailure: true });
  const postBaselinePayload = parsePayload(postBaselineRange);
  assert(postBaselineRange.status === 1, 'commit-range guard must still fail for critical commits that happen after the framework baseline cut');
  assert(postBaselinePayload.messages.some((entry: any) => entry.code === 'ATM_GUARD_COMMIT_RANGE_FAILED'), 'post-baseline bypass must still emit ATM_GUARD_COMMIT_RANGE_FAILED');

  const warnOnlyRepo = path.join(tempRoot, 'warn-only-feature-branch');
  mkdirSync(warnOnlyRepo, { recursive: true });
  copyRuntime(root, warnOnlyRepo);
  runGit(warnOnlyRepo, ['init']);
  runGit(warnOnlyRepo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(warnOnlyRepo, ['config', 'user.name', 'ATM Hook Validator']);
  assert(parsePayload(runCli(warnOnlyRepo, ['bootstrap', '--cwd', warnOnlyRepo, '--json'])).ok === true, 'warn-only bootstrap must report ok=true');
  assert(parsePayload(runCli(warnOnlyRepo, ['atm-chart', 'render', '--cwd', warnOnlyRepo, '--json'])).ok === true, 'warn-only atm-chart render must report ok=true');
  assert(parsePayload(runCli(warnOnlyRepo, ['welcome', '--cwd', warnOnlyRepo, '--json'])).ok === true, 'warn-only welcome must report ok=true');
  runGit(warnOnlyRepo, ['checkout', '-b', 'feature/warn-only']);
  runGit(warnOnlyRepo, ['add', '.']);
  runGit(warnOnlyRepo, ['commit', '--no-verify', '-m', 'initial feature baseline']);
  writeFileSync(path.join(warnOnlyRepo, 'packages', 'core', 'src', 'index.ts'), 'export const featureBypass = true;\n', 'utf8');
  runGit(warnOnlyRepo, ['add', 'packages/core/src/index.ts']);
  runGit(warnOnlyRepo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'feature bypass without evidence']);
  const warnOnlyHook = runCli(warnOnlyRepo, ['hook', 'pre-push', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
  const warnOnlyPayload = parsePayload(warnOnlyHook);
  assert(warnOnlyHook.status === 0, 'pre-push hook must downgrade framework findings to warnings on non-protected feature branches');
  assert(warnOnlyPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_WARN_ONLY_NON_PROTECTED'), 'pre-push hook must emit warn-only code for non-protected branches');

  const safeModeRepo = path.join(tempRoot, 'safe-mode-protected-branch');
  mkdirSync(safeModeRepo, { recursive: true });
  copyRuntime(root, safeModeRepo);
  runGit(safeModeRepo, ['init']);
  runGit(safeModeRepo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(safeModeRepo, ['config', 'user.name', 'ATM Hook Validator']);
  assert(parsePayload(runCli(safeModeRepo, ['bootstrap', '--cwd', safeModeRepo, '--json'])).ok === true, 'safe-mode bootstrap must report ok=true');
  assert(parsePayload(runCli(safeModeRepo, ['atm-chart', 'render', '--cwd', safeModeRepo, '--json'])).ok === true, 'safe-mode atm-chart render must report ok=true');
  assert(parsePayload(runCli(safeModeRepo, ['welcome', '--cwd', safeModeRepo, '--json'])).ok === true, 'safe-mode welcome must report ok=true');
  runGit(safeModeRepo, ['add', '.']);
  runGit(safeModeRepo, ['commit', '--no-verify', '-m', 'initial protected baseline']);
  writeFileSync(path.join(safeModeRepo, 'packages', 'core', 'src', 'index.ts'), 'export const protectedBypass = true;\n', 'utf8');
  runGit(safeModeRepo, ['add', 'packages/core/src/index.ts']);
  runGit(safeModeRepo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'protected bypass without evidence']);
  const safeModeHook = runCli(
    safeModeRepo,
    ['hook', 'pre-push', '--base', 'HEAD~1', '--head', 'HEAD', '--json'],
    {
      allowFailure: true,
      env: {
        ATM_FRAMEWORK_PUSH_GUARD_SAFE_MODE: '1',
        ATM_ACTOR_ID: 'validator-maintainer',
        ATM_FRAMEWORK_PUSH_GUARD_REASON: 'fixture emergency unblock'
      }
    }
  );
  const safeModePayload = parsePayload(safeModeHook);
  assert(safeModeHook.status === 0, 'pre-push hook safe mode must allow protected-branch bypasses when maintainer metadata is present');
  assert(safeModePayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_SAFE_MODE_BYPASS'), 'safe mode must emit a dedicated bypass warning code');
  assert(typeof safeModePayload.evidence?.enforcement?.safeModeReportPath === 'string' && safeModePayload.evidence.enforcement.safeModeReportPath.length > 0, 'safe mode must record a traceable local report path');

  const closureRepo = path.join(tempRoot, 'closure-cross-check');
  mkdirSync(closureRepo, { recursive: true });
  copyRuntime(root, closureRepo);
  runGit(closureRepo, ['init']);
  runGit(closureRepo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(closureRepo, ['config', 'user.name', 'ATM Hook Validator']);
  assert(parsePayload(runCli(closureRepo, ['bootstrap', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check bootstrap must report ok=true');
  assert(parsePayload(runCli(closureRepo, ['atm-chart', 'render', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check atm-chart render must report ok=true');
  assert(parsePayload(runCli(closureRepo, ['welcome', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check welcome must report ok=true');
  runGit(closureRepo, ['add', '.']);
  runGit(closureRepo, ['commit', '--no-verify', '-m', 'initial baseline']);

  writeFileSync(path.join(closureRepo, 'packages', 'core', 'src', 'index.ts'), 'export const bypass = "closure-cross-check";\n', 'utf8');
  runGit(closureRepo, ['add', 'packages/core/src/index.ts']);
  const governedTreeSha = runGit(closureRepo, ['write-tree']);
  const parentCommitSha = runGit(closureRepo, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(closureRepo, '.atm', 'history', 'evidence', 'git-head.json'), `${JSON.stringify({
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Git commit tree is covered by ATM Integration Hook Contract v1.',
        artifactPaths: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        producedBy: 'validate-git-hooks-enforcement',
        commandRuns: [
          createCommandRun('npm run typecheck', 'sha256:1111111111111111111111111111111111111111111111111111111111111111'),
          createCommandRun('npm run validate:cli', 'sha256:2222222222222222222222222222222222222222222222222222222222222222'),
          createCommandRun('npm run validate:git-head-evidence', 'sha256:3333333333333333333333333333333333333333333333333333333333333333')
        ],
        details: {
          git: {
            treeSha: governedTreeSha,
            parentCommitShas: [parentCommitSha],
            stagedPathCount: 1,
            evidencePath: '.atm/history/evidence/git-head.json',
            generatedAt: '2026-01-01T00:00:00.000Z'
          },
          hookContractVersion: 'atm.integration-hooks/v1',
          runnerVersion: '0.1.0'
        }
      }
    ]
  }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(closureRepo, '.atm', 'history', 'evidence', 'TASK-X-9001.closure-packet.json'), `${JSON.stringify({
    schemaId: 'atm.closurePacket.v1',
    specVersion: '0.1.0',
    taskId: 'TASK-X-9001',
    targetRepoIdentity: {
      isFrameworkRepo: true,
      score: 4,
      root: closureRepo,
      name: 'ai-atomic-framework',
      signals: ['package-name', 'packages-core', 'packages-cli', 'atomic-registry']
    },
    targetCommit: parentCommitSha,
    governedTreeSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    targetCommitDelta: {
      currentCommitSha: parentCommitSha,
      parentCommitShas: [parentCommitSha],
      governedTreeSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      changedFiles: ['packages/core/src/index.ts']
    },
    closedByCommand: 'atm tasks close',
    commandRuns: [
      createCommandRun('npm run typecheck', 'sha256:1111111111111111111111111111111111111111111111111111111111111111'),
      createCommandRun('npm run validate:cli', 'sha256:2222222222222222222222222222222222222222222222222222222222222222'),
      createCommandRun('npm run validate:git-head-evidence', 'sha256:3333333333333333333333333333333333333333333333333333333333333333')
    ],
    validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
    evidenceFreshness: 'fresh',
    requiredGates: ['framework-development', 'tasks-audit', 'doctor', 'git-head-evidence', 'typecheck', 'validate:cli', 'validate:git-head-evidence'],
    requiredGatesSnapshot: {
      schemaId: 'atm.requiredGatesSnapshot.v1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      source: 'frameworkStatus.requiredGates',
      ruleVersion: '0.1.0',
      frameworkMode: 'required',
      repoRole: 'framework',
      changedFiles: ['packages/core/src/index.ts'],
      criticalChangedFiles: ['packages/core/src/index.ts'],
      requiredGates: ['framework-development', 'tasks-audit', 'doctor', 'git-head-evidence', 'typecheck', 'validate:cli', 'validate:git-head-evidence']
    },
    evidencePath: '.atm/history/evidence/TASK-X-9001.json',
    closedAt: '2026-01-01T00:00:00.000Z',
    closedByActor: 'validate-git-hooks-enforcement'
  }, null, 2)}\n`, 'utf8');
  runGit(closureRepo, ['add', '.atm/history/evidence/git-head.json', '.atm/history/evidence/TASK-X-9001.closure-packet.json']);
  runGit(closureRepo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'bypass hooks with mismatched closure packet']);

  const closureCommitRange = runCli(closureRepo, ['guard', 'commit-range', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
  const closureCommitRangePayload = parsePayload(closureCommitRange);
  assert(closureCommitRange.status === 1, 'commit-range guard must fail for mismatched closure packet');
  const closureFindings = closureCommitRangePayload.evidence?.report?.findings ?? [];
  assert(closureFindings.some((entry: any) => entry.code === 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TREE_MISMATCH'), 'commit-range guard must detect closure packet tree mismatches against governed commit delta');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[git-hooks-enforcement:${mode}] ok (ATM hook command, Git hook install, and commit-range bypass detection verified)`);
}
