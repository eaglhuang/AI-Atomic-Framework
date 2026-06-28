import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadValidatorFixture, materializeValidatorFixture } from './lib/validator-fixture.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = loadValidatorFixture(root, 'fixtures/validators/git-hooks-enforcement.fixture.json');
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

function run(command: string, args: readonly string[], cwd: string, options: { allowFailure?: boolean; env?: Record<string, string>; input?: string } = {}) {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    input: options.input,
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

function runCli(repo: string, args: readonly string[], options: { allowFailure?: boolean; env?: Record<string, string>; input?: string } = {}) {
  return run(process.execPath, ['atm.dev.mjs', ...args], repo, options);
}

function parsePayload(result: ReturnType<typeof run>) {
  const payload = (result.stdout || result.stderr || '').trim();
  try {
    return payload ? JSON.parse(payload) : {};
  } catch (error) {
    console.error('PARSE PAYLOAD FAILED. Raw payload:', payload);
    throw error;
  }
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

function writeHistoricalRestorePacket(repo: string, taskId: string, status = 'done') {
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', `${taskId}.json`);
  const closurePacketPath = path.join(repo, '.atm', 'history', 'evidence', `${taskId}.closure-packet.json`);
  const eventId = `2026-01-02T00-00-00-000Z-close-${taskId.toLowerCase()}`;
  const eventPath = path.join(repo, '.atm', 'history', 'task-events', taskId, `${eventId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  mkdirSync(path.dirname(eventPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Historical restore hook fixture',
    status,
    owner: 'legacy-agent',
    lastTransitionId: eventId,
    lastTransitionAt: '2026-01-02T00:00:00.000Z',
    closedAt: status === 'done' ? '2026-01-02T00:00:00.000Z' : null,
    closedByActor: status === 'done' ? 'legacy-agent' : null,
    closedBySessionId: status === 'done' ? 'session-legacy-restore' : null,
    claim: {
      actorId: 'legacy-agent',
      leaseId: 'lease-legacy-restore',
      state: 'active'
    }
  }, null, 2)}\n`, 'utf8');
  writeFileSync(evidencePath, `${JSON.stringify({
    taskId,
    updatedAt: '2026-01-02T00:00:00.000Z',
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'historical restore hook fixture',
        producedBy: 'legacy-agent',
        sessionId: 'session-legacy-restore',
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    ]
  }, null, 2)}\n`, 'utf8');
  writeFileSync(closurePacketPath, `${JSON.stringify({
    schemaId: 'atm.closurePacket.v1',
    specVersion: '0.1.0',
    taskId,
    targetCommit: '0123456789abcdef0123456789abcdef01234567',
    evidencePath: `.atm/history/evidence/${taskId}.json`,
    closedAt: '2026-01-02T00:00:00.000Z',
    closedByActor: 'legacy-agent'
  }, null, 2)}\n`, 'utf8');
  writeFileSync(eventPath, `${JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    specVersion: '0.1.0',
    transitionId: eventId,
    taskId,
    action: 'close',
    actorId: 'legacy-agent',
    fromStatus: 'running',
    toStatus: status,
    taskPath: `.atm/history/tasks/${taskId}.json`,
    taskSha256: 'sha256:fixture',
    createdAt: '2026-01-02T00:00:00.000Z',
    command: `node atm.mjs tasks close --task ${taskId} --actor legacy-agent --status done --json`
  }, null, 2)}\n`, 'utf8');
  return [
    `.atm/history/tasks/${taskId}.json`,
    `.atm/history/evidence/${taskId}.json`,
    `.atm/history/evidence/${taskId}.closure-packet.json`,
    `.atm/history/task-events/${taskId}/${eventId}.json`
  ];
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
  materializeValidatorFixture(root, repo, fixture);
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
  const hookInstallPayload = parsePayload(runCli(repo, ['integration', 'hooks', 'install', 'claude-code', '--json']));
  assert(hookInstallPayload.ok === true, 'integration hooks install claude-code must report ok=true');
  const gitHookInstallPayload = parsePayload(runCli(repo, ['git-hooks', 'install', '--framework-required', '--json']));
  assert(gitHookInstallPayload.ok === true, 'git-hooks install must report ok=true');
  const hookVerifyPayload = parsePayload(runCli(repo, ['integration', 'hooks', 'verify', 'claude-code', '--json']));
  assert(hookVerifyPayload.ok === true, 'integration hooks verify claude-code must report ok=true');
  assert(existsSync(path.join(repo, '.atm', 'git-hooks', 'pre-commit')), 'git-hooks install must write .atm/git-hooks/pre-commit');
  assert(existsSync(path.join(repo, '.atm', 'git-hooks', 'pre-push')), 'git-hooks install must write .atm/git-hooks/pre-push');
  assert(runGit(repo, ['config', '--get', 'core.hooksPath']).stdout.trim() === '.atm/git-hooks', 'git-hooks install must configure core.hooksPath to .atm/git-hooks');

  writeFileSync(path.join(repo, 'docs-only.txt'), 'governed commit\n', 'utf8');
  runGit(repo, ['add', 'docs-only.txt']);
  const explicitPreCommit = parsePayload(runCli(repo, ['hook', 'pre-commit', '--json']));
  assert(explicitPreCommit.ok === true, 'explicit pre-commit hook command must succeed for governed docs change');
  assert(explicitPreCommit.evidence?.gitHeadEvidenceRequired === false, 'docs-only pre-commit must not require git-head evidence');
  assert(!existsSync(path.join(repo, '.atm', 'history', 'evidence', 'git-head.jsonl')), 'docs-only pre-commit must not write git-head evidence');
  const governedCommit = runGit(repo, ['commit', '--no-verify', '-m', 'governed docs change']);
  assert(governedCommit.status === 0, 'governed commit must succeed after explicit hook validation');

  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const foreignStagedCritical = true;\n', 'utf8');
  runGit(repo, ['add', 'packages/core/src/index.ts']);
  writeFileSync(path.join(repo, 'docs', 'pathspec-rescue.md'), 'pathspec rescue\n', 'utf8');
  runGit(repo, ['add', 'docs/pathspec-rescue.md']);
  const pathspecCommit = runGit(repo, ['commit', '-m', 'docs: pathspec rescue', '--', 'docs/pathspec-rescue.md'], { allowFailure: true });
  assert(pathspecCommit.status === 0, `native pathspec commit must succeed without validating unrelated staged index entries\nstdout:\n${pathspecCommit.stdout || ''}\nstderr:\n${pathspecCommit.stderr || ''}`);
  const pathspecTouched = String(runGit(repo, ['show', '--pretty=', '--name-only', 'HEAD']).stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert(pathspecTouched.length === 1 && pathspecTouched[0] === 'docs/pathspec-rescue.md', `native pathspec commit must only land the requested pathspec surface (got ${pathspecTouched.join(', ')})`);
  const remainingStaged = String(runGit(repo, ['diff', '--cached', '--name-only']).stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert(remainingStaged.includes('packages/core/src/index.ts'), 'native pathspec commit must preserve unrelated staged files in the real index');
  assert(!remainingStaged.includes('docs/pathspec-rescue.md'), 'native pathspec commit must not leave the committed pathspec file staged');

  const governedDoctor = parsePayload(runCli(repo, ['doctor', '--json']));
  assert(governedDoctor.ok === true, 'doctor must report ok=true after non-critical docs commit without git-head evidence');
  assert(governedDoctor.evidence?.checks?.some((entry: any) => entry.name === 'git-head-evidence' && entry.details?.status === 'not-required-non-critical-head'), 'doctor must classify docs-only HEAD evidence as not required');

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

  const backfillResult = runCli(repo, ['evidence', 'git-head-backfill', '--actor', 'hook-validator', '--reason', 'pre-push worktree evidence regression', '--json']);
  const backfillPayload = parsePayload(backfillResult);
  assert(backfillPayload.ok === true, 'git-head backfill must succeed for pre-push regression');

  const prePushAfterBackfill = runCli(repo, ['hook', 'pre-push', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
  const prePushAfterBackfillPayload = parsePayload(prePushAfterBackfill);
  assert(prePushAfterBackfill.status === 0, 'pre-push hook must accept worktree git-head evidence backfill for the current HEAD');
  assert(prePushAfterBackfillPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_OK'), 'pre-push hook must report ok after worktree backfill');

  const legacyBaselineRepo = path.join(tempRoot, 'legacy-baseline-cut');
  mkdirSync(legacyBaselineRepo, { recursive: true });
  materializeValidatorFixture(root, legacyBaselineRepo, fixture);
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
  materializeValidatorFixture(root, warnOnlyRepo, fixture);
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

  const protectedLocalToFeatureRemoteRepo = path.join(tempRoot, 'protected-local-to-feature-remote');
  mkdirSync(protectedLocalToFeatureRemoteRepo, { recursive: true });
  materializeValidatorFixture(root, protectedLocalToFeatureRemoteRepo, fixture);
  runGit(protectedLocalToFeatureRemoteRepo, ['init']);
  runGit(protectedLocalToFeatureRemoteRepo, ['checkout', '-b', 'main']);
  runGit(protectedLocalToFeatureRemoteRepo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(protectedLocalToFeatureRemoteRepo, ['config', 'user.name', 'ATM Hook Validator']);
  assert(parsePayload(runCli(protectedLocalToFeatureRemoteRepo, ['bootstrap', '--cwd', protectedLocalToFeatureRemoteRepo, '--json'])).ok === true, 'protected-local feature push bootstrap must report ok=true');
  assert(parsePayload(runCli(protectedLocalToFeatureRemoteRepo, ['atm-chart', 'render', '--cwd', protectedLocalToFeatureRemoteRepo, '--json'])).ok === true, 'protected-local feature push atm-chart render must report ok=true');
  assert(parsePayload(runCli(protectedLocalToFeatureRemoteRepo, ['welcome', '--cwd', protectedLocalToFeatureRemoteRepo, '--json'])).ok === true, 'protected-local feature push welcome must report ok=true');
  runGit(protectedLocalToFeatureRemoteRepo, ['add', '.']);
  runGit(protectedLocalToFeatureRemoteRepo, ['commit', '--no-verify', '-m', 'initial protected local baseline']);
  writeFileSync(path.join(protectedLocalToFeatureRemoteRepo, 'packages', 'core', 'src', 'index.ts'), 'export const protectedLocalFeaturePush = true;\n', 'utf8');
  runGit(protectedLocalToFeatureRemoteRepo, ['add', 'packages/core/src/index.ts']);
  runGit(protectedLocalToFeatureRemoteRepo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'protected local bypass without evidence']);
  const protectedLocalHead = String(runGit(protectedLocalToFeatureRemoteRepo, ['rev-parse', 'HEAD']).stdout || '').trim();
  const prePushStdin = `refs/heads/main ${protectedLocalHead} refs/heads/codex/readme-only 0000000000000000000000000000000000000000\n`;
  const protectedLocalFeaturePush = runCli(
    protectedLocalToFeatureRemoteRepo,
    ['hook', 'pre-push', '--base', 'HEAD~1', '--head', 'HEAD', '--json'],
    { allowFailure: true, input: prePushStdin }
  );
  const protectedLocalFeaturePushPayload = parsePayload(protectedLocalFeaturePush);
  assert(protectedLocalFeaturePush.status === 0, 'pre-push hook must not hard-block a protected local branch when the actual remote target is a non-protected branch');
  assert(protectedLocalFeaturePushPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_WARN_ONLY_NON_PROTECTED'), 'protected local to feature remote push must be warn-only');
  assert((protectedLocalFeaturePushPayload.evidence?.enforcement?.hardProtectedBranchTargets ?? []).length === 0, 'pre-push enforcement must derive protected targets from remote push refs before falling back to current branch');

  const safeModeRepo = path.join(tempRoot, 'safe-mode-protected-branch');
  mkdirSync(safeModeRepo, { recursive: true });
  materializeValidatorFixture(root, safeModeRepo, fixture);
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
  materializeValidatorFixture(root, closureRepo, fixture);
  runGit(closureRepo, ['init']);
  runGit(closureRepo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(closureRepo, ['config', 'user.name', 'ATM Hook Validator']);
  assert(parsePayload(runCli(closureRepo, ['bootstrap', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check bootstrap must report ok=true');
  assert(parsePayload(runCli(closureRepo, ['atm-chart', 'render', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check atm-chart render must report ok=true');
  assert(parsePayload(runCli(closureRepo, ['welcome', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check welcome must report ok=true');
  runGit(closureRepo, ['add', '.']);
  runGit(closureRepo, ['commit', '--no-verify', '-m', 'initial baseline']);

  const restoreIdentity = parsePayload(runCli(closureRepo, ['identity', 'set', '--cwd', closureRepo, '--actor', 'restore-operator', '--git-name', 'Restore Operator', '--git-email', 'restore@example.invalid', '--json']));
  assert(restoreIdentity.ok === true, 'historical restore hook fixture identity must be configurable');
  const restoreHookTaskId = 'TASK-X-RESTORE';
  const restoreHookFiles = writeHistoricalRestorePacket(closureRepo, restoreHookTaskId);
  runGit(closureRepo, ['add', ...restoreHookFiles]);
  const restoreHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], {
    env: {
      ATM_COMMIT_ACTOR_ID: 'restore-operator',
      ATM_COMMIT_TASK_ID: restoreHookTaskId,
      GIT_AUTHOR_NAME: 'Restore Operator',
      GIT_AUTHOR_EMAIL: 'restore@example.invalid'
    }
  });
  assert(restoreHook.status === 0, 'pre-commit hook must accept a complete done historical ledger restore packet without a fake legacy session');
  runGit(closureRepo, ['reset', '--mixed', 'HEAD']);

  const reconcileIdentity = parsePayload(runCli(closureRepo, ['identity', 'set', '--cwd', closureRepo, '--actor', 'fixture-agent', '--git-name', 'Fixture Agent', '--git-email', 'fixture-agent@example.com', '--json']));
  assert(reconcileIdentity.ok === true, 'reconcile close-commit-window hook fixture identity must be configurable');
  const reconcileHookTaskId = 'TASK-X-RECONCILE';
  assert(parsePayload(runCli(closureRepo, ['tasks', 'reserve', '--cwd', closureRepo, '--task', reconcileHookTaskId, '--actor', 'fixture-agent', '--title', 'Reconcile hook close window regression', '--json'])).ok === true, 'reconcile hook reserve must report ok=true');
  assert(parsePayload(runCli(closureRepo, ['tasks', 'promote', '--cwd', closureRepo, '--task', reconcileHookTaskId, '--actor', 'fixture-agent', '--json'])).ok === true, 'reconcile hook promote must report ok=true');
  writeFileSync(path.join(closureRepo, 'packages', 'core', 'src', 'reconcile-close-window.ts'), 'export const reconcileCloseWindow = true;\n', 'utf8');
  assert(parsePayload(runCli(closureRepo, ['tasks', 'claim', '--cwd', closureRepo, '--task', reconcileHookTaskId, '--actor', 'fixture-agent', '--files', 'packages/core/src/reconcile-close-window.ts', '--json'])).ok === true, 'reconcile hook claim must report ok=true');
  runGit(closureRepo, ['add', 'packages/core/src/reconcile-close-window.ts']);
  const reconcileDeliveryCommit = parsePayload(runCli(closureRepo, ['git', 'commit', '--cwd', closureRepo, '--actor', 'fixture-agent', '--task', reconcileHookTaskId, '--message', 'feat: reconcile hook fixture delivery', '--json']));
  assert(reconcileDeliveryCommit.ok === true, 'reconcile hook fixture delivery commit must report ok=true');
  const reconcileDeliverySha = String(reconcileDeliveryCommit.evidence?.commitSha ?? '');
  assert(reconcileDeliverySha.length > 0, 'reconcile hook fixture delivery commit must return commit sha');
  const reconcileApproval = parsePayload(runCli(closureRepo, [
    'emergency',
    'approve',
    '--cwd', closureRepo,
    '--task', reconcileHookTaskId,
    '--actor', 'fixture-agent',
    '--permission', 'backend.tasks.reconcile',
    '--approval-text', 'Human approved reconcile hook fixture backend repair',
    '--reason', 'Validator fixture exercises the protected reconcile close-window contract.',
    '--json'
  ]));
  assert(reconcileApproval.ok === true, 'reconcile hook fixture emergency approval must report ok=true');
  const reconcileApprovalLease = String(reconcileApproval.evidence?.lease?.leaseId ?? reconcileApproval.evidence?.approval?.leaseId ?? reconcileApproval.evidence?.leaseId ?? '');
  assert(reconcileApprovalLease.length > 0, 'reconcile hook fixture emergency approval must return a lease id');
  const reconcileClose = parsePayload(runCli(closureRepo, ['tasks', 'reconcile', '--cwd', closureRepo, '--task', reconcileHookTaskId, '--actor', 'fixture-agent', '--delivery-commit', reconcileDeliverySha, '--emergency-approval', reconcileApprovalLease, '--json']));
  assert(reconcileClose.ok === true, 'reconcile hook close step must report ok=true');
  const reconcilePreCommit = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], {
    env: {
      ATM_COMMIT_ACTOR_ID: 'fixture-agent',
      ATM_COMMIT_TASK_ID: reconcileHookTaskId,
      GIT_AUTHOR_NAME: 'Fixture Agent',
      GIT_AUTHOR_EMAIL: 'fixture-agent@example.com'
    }
  });
  assert(reconcilePreCommit.status === 0, 'pre-commit hook must accept reconcile close packets covered by an active close-commit-window without a session id');
  assert(parsePayload(runCli(closureRepo, ['git-hooks', 'install', '--framework-required', '--json'])).ok === true, 'reconcile child-hook fixture must install git hooks before native child commit');
  const reconcileStagedBeforeChildCommit = String(runGit(closureRepo, ['diff', '--cached', '--name-only']).stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert(reconcileStagedBeforeChildCommit.includes('.atm/history/evidence/TASK-X-RECONCILE.closure-packet.json'), 'reconcile parent pre-commit must keep the closure packet staged for the child hook');
  assert(reconcileStagedBeforeChildCommit.includes('.atm/history/evidence/TASK-X-RECONCILE.json'), 'reconcile parent pre-commit must keep the task evidence bundle staged for the child hook');
  assert(reconcileStagedBeforeChildCommit.includes('.atm/history/evidence/git-head.jsonl'), 'reconcile parent pre-commit must stage git-head evidence for the child hook handoff');
  const reconcileChildCommit = runGit(closureRepo, ['commit', '-m', 'close reconcile hook fixture window'], {
    allowFailure: true,
    env: {
      ATM_COMMIT_ACTOR_ID: 'fixture-agent',
      ATM_COMMIT_TASK_ID: reconcileHookTaskId,
      GIT_AUTHOR_NAME: 'Fixture Agent',
      GIT_AUTHOR_EMAIL: 'fixture-agent@example.com'
    }
  });
  assert(reconcileChildCommit.status === 0, `reconcile child git commit must succeed after parent pre-commit refresh without stale git-head evidence failure\nstdout:\n${reconcileChildCommit.stdout || ''}\nstderr:\n${reconcileChildCommit.stderr || ''}`);
  const reconcileChildTouchedPaths = String(runGit(closureRepo, ['show', '--pretty=', '--name-only', 'HEAD']).stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert(reconcileChildTouchedPaths.includes('.atm/history/evidence/TASK-X-RECONCILE.closure-packet.json'), 'reconcile child commit must include the closure packet staged by the parent pre-commit');
  assert(reconcileChildTouchedPaths.includes('.atm/history/evidence/TASK-X-RECONCILE.json'), 'reconcile child commit must include the reconciled task evidence bundle');
  assert(reconcileChildTouchedPaths.includes('.atm/history/evidence/git-head.jsonl'), 'reconcile child commit must persist git-head evidence generated by the parent pre-commit');
  runGit(closureRepo, ['reset', '--mixed', 'HEAD']);
  runGit(closureRepo, ['checkout', '--', 'packages/core/src/reconcile-close-window.ts']);

  // TASK-CID-0024: same-file parallel claims must be claimable side by side,
  // pre-commit must not fail purely because one staged file is covered by
  // multiple active claims, and ambiguous mixed staged content without
  // steward/broker evidence must still be rejected.
  const sameFileTaskA = 'TASK-X-SAME-A';
  const sameFileTaskB = 'TASK-X-SAME-B';
  for (const sameFileTaskId of [sameFileTaskA, sameFileTaskB]) {
    assert(parsePayload(runCli(closureRepo, ['tasks', 'reserve', '--cwd', closureRepo, '--task', sameFileTaskId, '--actor', 'fixture-agent', '--title', `Same-file claim fixture ${sameFileTaskId}`, '--json'])).ok === true, `${sameFileTaskId} reserve must report ok=true`);
    assert(parsePayload(runCli(closureRepo, ['tasks', 'promote', '--cwd', closureRepo, '--task', sameFileTaskId, '--actor', 'fixture-agent', '--json'])).ok === true, `${sameFileTaskId} promote must report ok=true`);
  }
  writeFileSync(path.join(closureRepo, 'docs', 'same-file-shared.md'), '# shared fixture\n', 'utf8');
  writeFileSync(path.join(closureRepo, 'docs', 'same-file-a-only.md'), '# a only fixture\n', 'utf8');
  writeFileSync(path.join(closureRepo, 'docs', 'same-file-b-only.md'), '# b only fixture\n', 'utf8');
  assert(parsePayload(runCli(closureRepo, ['tasks', 'claim', '--cwd', closureRepo, '--task', sameFileTaskA, '--actor', 'fixture-agent', '--files', 'docs/same-file-shared.md,docs/same-file-a-only.md', '--json'])).ok === true, 'same-file claim A must report ok=true');
  const sameFileClaimB = parsePayload(runCli(closureRepo, ['tasks', 'claim', '--cwd', closureRepo, '--task', sameFileTaskB, '--actor', 'fixture-agent', '--files', 'docs/same-file-shared.md,docs/same-file-b-only.md', '--json']));
  assert(sameFileClaimB.ok === true, 'same-file claim B must be claimable in parallel with claim A on the same file');

  const sameFileHookEnv = {
    ATM_COMMIT_ACTOR_ID: 'fixture-agent',
    ATM_COMMIT_TASK_ID: sameFileTaskA,
    GIT_AUTHOR_NAME: 'Fixture Agent',
    GIT_AUTHOR_EMAIL: 'fixture-agent@example.com'
  };
  runGit(closureRepo, ['add', 'docs/same-file-shared.md']);
  const sameFileOwnedHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], { allowFailure: true, env: sameFileHookEnv });
  assert(sameFileOwnedHook.status === 0, `pre-commit hook must not fail purely because the staged file has multiple active same-file claims\nstdout:\n${sameFileOwnedHook.stdout}\nstderr:\n${sameFileOwnedHook.stderr}`);
  const sameFileOwnedPayload = parsePayload(sameFileOwnedHook);
  assert((sameFileOwnedPayload.evidence?.sameFileClaimReport?.multiClaimFiles ?? []).some((entry: any) => entry.file === 'docs/same-file-shared.md'), 'pre-commit evidence must record the same-file multi-claim coverage');
  runGit(closureRepo, ['reset', '--mixed', 'HEAD']);

  runGit(closureRepo, ['add', 'docs/same-file-b-only.md']);
  const sameFileAmbiguousHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], { allowFailure: true, env: sameFileHookEnv });
  assert(sameFileAmbiguousHook.status === 1, 'pre-commit hook must reject mixed staged content owned by another active write claim without steward/broker evidence');
  const sameFileAmbiguousPayload = parsePayload(sameFileAmbiguousHook);
  assert((sameFileAmbiguousPayload.evidence?.sameFileClaimReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS' && entry.file === 'docs/same-file-b-only.md'), 'ambiguous staged ownership must emit ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS');
  runGit(closureRepo, ['reset', '--mixed', 'HEAD']);
  for (const sameFileTaskId of [sameFileTaskA, sameFileTaskB]) {
    assert(parsePayload(runCli(closureRepo, ['tasks', 'release', '--cwd', closureRepo, '--task', sameFileTaskId, '--actor', 'fixture-agent', '--reason', 'same-file fixture cleanup', '--json'])).ok === true, `${sameFileTaskId} release must report ok=true`);
  }
  rmSync(path.join(closureRepo, 'docs', 'same-file-shared.md'), { force: true });
  rmSync(path.join(closureRepo, 'docs', 'same-file-a-only.md'), { force: true });
  rmSync(path.join(closureRepo, 'docs', 'same-file-b-only.md'), { force: true });

  const mixedRestoreHookTaskId = 'TASK-X-RESTORE-MIXED';
  const mixedRestoreHookFiles = writeHistoricalRestorePacket(closureRepo, mixedRestoreHookTaskId);
  writeFileSync(path.join(closureRepo, 'packages', 'core', 'src', 'restore-bypass.ts'), 'export const restoreBypass = true;\n', 'utf8');
  runGit(closureRepo, ['add', ...mixedRestoreHookFiles, 'packages/core/src/restore-bypass.ts']);
  const mixedRestoreHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], {
    allowFailure: true,
    env: {
      ATM_COMMIT_ACTOR_ID: 'restore-operator',
      ATM_COMMIT_TASK_ID: mixedRestoreHookTaskId,
      GIT_AUTHOR_NAME: 'Restore Operator',
      GIT_AUTHOR_EMAIL: 'restore@example.invalid'
    }
  });
  assert(mixedRestoreHook.status === 1, 'pre-commit hook must reject historical restore packets mixed with source files');
  const mixedRestoreHookPayload = parsePayload(mixedRestoreHook);
  assert((mixedRestoreHookPayload.evidence?.commitAttributionReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_COMMIT_SESSION_MISSING'), 'mixed restore hook refusal must fall back to normal active-task session enforcement');
  runGit(closureRepo, ['reset', '--mixed', 'HEAD']);
  rmSync(path.join(closureRepo, 'packages', 'core', 'src', 'restore-bypass.ts'), { force: true });

  const openRestoreHookTaskId = 'TASK-X-RESTORE-OPEN';
  const openRestoreHookFiles = writeHistoricalRestorePacket(closureRepo, openRestoreHookTaskId, 'running');
  runGit(closureRepo, ['add', ...openRestoreHookFiles]);
  writeHistoricalRestorePacket(closureRepo, openRestoreHookTaskId, 'done');
  const openRestoreHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], {
    allowFailure: true,
    env: {
      ATM_COMMIT_ACTOR_ID: 'restore-operator',
      ATM_COMMIT_TASK_ID: openRestoreHookTaskId,
      GIT_AUTHOR_NAME: 'Restore Operator',
      GIT_AUTHOR_EMAIL: 'restore@example.invalid'
    }
  });
  assert(openRestoreHook.status === 1, 'pre-commit hook must reject historical restore packets whose staged task ledger is not done');
  const openRestoreHookPayload = parsePayload(openRestoreHook);
  assert((openRestoreHookPayload.evidence?.commitAttributionReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_COMMIT_SESSION_MISSING'), 'non-done restore hook refusal must fall back to normal active-task session enforcement');
  runGit(closureRepo, ['reset', '--mixed', 'HEAD']);

  writeFileSync(path.join(closureRepo, 'packages', 'core', 'src', 'index.ts'), 'export const bypass = "closure-cross-check";\n', 'utf8');
  runGit(closureRepo, ['add', 'packages/core/src/index.ts']);
  const governedTreeSha = runGit(closureRepo, ['write-tree']);
  const parentCommitSha = runGit(closureRepo, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(closureRepo, '.atm', 'history', 'evidence', 'git-head.jsonl'), `${JSON.stringify({
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
            evidencePath: '.atm/history/evidence/git-head.jsonl',
            generatedAt: '2026-01-01T00:00:00.000Z'
          },
          hookContractVersion: 'atm.integration-hooks/v1',
          runnerVersion: '0.1.0'
        }
      }
    ]
  })}\n`, 'utf8');
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
  runGit(closureRepo, ['add', '.atm/history/evidence/git-head.jsonl', '.atm/history/evidence/TASK-X-9001.closure-packet.json']);
  runGit(closureRepo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'bypass hooks with mismatched closure packet']);
  const mismatchedClosureCommitSha = String(runGit(closureRepo, ['rev-parse', 'HEAD']).stdout || '').trim();

  const closureCommitRange = runCli(closureRepo, ['guard', 'commit-range', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
  const closureCommitRangePayload = parsePayload(closureCommitRange);
  assert(closureCommitRange.status === 1, 'commit-range guard must fail for mismatched closure packet');
  const closureFindings = closureCommitRangePayload.evidence?.report?.findings ?? [];
  assert(closureFindings.some((entry: any) => entry.code === 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TREE_MISMATCH'), 'commit-range guard must detect closure packet tree mismatches against governed commit delta');
  const closureMismatchFinding = closureFindings.find((entry: any) => entry.code === 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TREE_MISMATCH');
  const closureMismatchSuggestedFix = closureMismatchFinding?.suggestedFix
    ?? closureMismatchFinding?.suggested_fix
    ?? closureMismatchFinding?.data?.suggestedFix
    ?? closureMismatchFinding?.data?.suggested_fix
    ?? closureMismatchFinding?.data?.suggestedCommand;
  assert(typeof closureMismatchSuggestedFix === 'string' && closureMismatchSuggestedFix.includes('closure-packet'), 'closure packet tree mismatch finding must include an actionable suggested fix');

  const repairApproval = parsePayload(runCli(closureRepo, [
    'emergency',
    'approve',
    '--cwd', closureRepo,
    '--task', 'TASK-X-9001',
    '--actor', 'fixture-agent',
    '--permission', 'backend.tasks.repairClosure',
    '--approval-text', 'Human approved repair-closure hook fixture backend repair',
    '--reason', 'Validator fixture exercises the protected closure-packet repair contract.',
    '--json'
  ]));
  assert(repairApproval.ok === true, 'repair-closure hook fixture emergency approval must report ok=true');
  const repairApprovalLease = String(repairApproval.evidence?.lease?.leaseId ?? repairApproval.evidence?.approval?.leaseId ?? repairApproval.evidence?.leaseId ?? '');
  assert(repairApprovalLease.length > 0, 'repair-closure hook fixture emergency approval must return a lease id');
  const repairPayload = parsePayload(runCli(closureRepo, ['tasks', 'repair-closure', '--task', 'TASK-X-9001', '--actor', 'fixture-agent', '--emergency-approval', repairApprovalLease, '--json']));
  assert(repairPayload.ok === true, 'tasks repair-closure must stage a repaired closure packet');
  const repairedPacketPath = path.join(closureRepo, '.atm', 'history', 'evidence', 'TASK-X-9001.closure-packet.json');
  const repairedPacket = JSON.parse(readFileSync(repairedPacketPath, 'utf8'));
  assert(repairedPacket.repair?.schemaId === 'atm.closurePacketRepair.v1', 'repaired closure packet must carry explicit repair metadata');
  assert(repairedPacket.repair?.originalPacketCommitSha === mismatchedClosureCommitSha, 'repair metadata must identify the original packet commit');
  runGit(closureRepo, ['commit', '--no-verify', '-m', 'repair mismatched closure packet']);
  const repairedClosureRange = runCli(closureRepo, ['guard', 'commit-range', '--base', 'HEAD~2', '--head', 'HEAD', '--json'], { allowFailure: true });
  assert(repairedClosureRange.status === 0, `commit-range guard must accept an explicit closure packet repair follow-up\nstdout:\n${repairedClosureRange.stdout}\nstderr:\n${repairedClosureRange.stderr}`);

  const protectedOverrideAudit = parsePayload(runCli(root, ['emergency', 'audit', '--json']));
  assert(protectedOverrideAudit.ok === true, 'emergency audit must list protected override audit events');
  assert(Array.isArray(protectedOverrideAudit.evidence?.events), 'emergency audit evidence must include events array');
  const blockedNoVerify = parsePayload(runCli(root, ['git', 'commit', '--actor', 'fixture-agent', '--message', 'blocked no-verify', '--no-verify', '--json'], { allowFailure: true }));
  assert(blockedNoVerify.ok === false, 'git commit --no-verify without emergency approval must fail closed');
  assert(
    JSON.stringify(blockedNoVerify.messages ?? []).includes('ATM_EMERGENCY_LANE_APPROVAL_REQUIRED')
      || JSON.stringify(blockedNoVerify).includes('ATM_EMERGENCY_LANE_APPROVAL_REQUIRED'),
    'blocked git commit --no-verify must surface emergency approval requirement'
  );
} finally {
  if (!process.exitCode) {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log('TEST FAILED. Keeping temp directory:', tempRoot);
  }
}

if (!process.exitCode) {
  console.log(`[git-hooks-enforcement:${mode}] ok (ATM hook command, Git hook install, and commit-range bypass detection verified)`);
}
