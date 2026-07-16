import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assert, fixture, parsePayload, root, runCli, runGit, tempRoot } from './context.ts';
import { materializeValidatorFixture } from '../lib/validator-fixture.ts';

export function runPrePushRegressions(repo: string) {
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
assert(governedDoctor.evidence?.checks?.some((entry: any) => entry.name === 'governance-entry-readiness'), 'doctor must emit governance-entry-readiness check');
assert(governedDoctor.evidence?.governanceEntryReadiness?.queueRetryCodes?.includes('ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY'), 'doctor governance readiness must surface branch queue retry codes');

writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const bypass = true;\n', 'utf8');
runGit(repo, ['add', 'packages/core/src/index.ts']);
const noHooksDir = path.join(tempRoot, 'no-hooks');
mkdirSync(noHooksDir, { recursive: true });
runGit(repo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'bypass hooks']);

const bypassDoctor = runCli(repo, ['doctor', '--json'], { allowFailure: true });
const bypassDoctorPayload = parsePayload(bypassDoctor);
assert(bypassDoctor.status === 0, 'doctor must stay green after a critical bypass commit with only historical git-head evidence gaps');
assert(bypassDoctorPayload.ok === true, 'doctor must report ok=true when only per-critical historical git-head evidence is missing');
assert(bypassDoctorPayload.messages.some((entry: any) => entry.code === 'ATM_DOCTOR_GIT_EVIDENCE_WARNING'), 'doctor must downgrade missing latest git-head evidence to a warning');
assert(bypassDoctorPayload.evidence?.checks?.some((entry: any) => entry.name === 'governance-entry-readiness'), 'doctor must keep governance-entry-readiness visible after bypass commit');
const bypassReadiness = bypassDoctorPayload.evidence?.checks?.find((entry: any) => entry.name === 'governance-entry-readiness');
assert(bypassReadiness?.ok === true, 'governance-entry-readiness must not fail on historical per-critical git-head evidence gaps');
assert(bypassReadiness?.details?.perCriticalCommitGitHeadEvidence?.enforcement === 'disabled', 'governance-entry-readiness must advertise disabled per-critical git-head enforcement');

const commitRange = runCli(repo, ['guard', 'commit-range', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
const commitRangePayload = parsePayload(commitRange);
assert(commitRange.status === 0, 'commit-range guard must not fail solely because a historical critical commit lacks git-head evidence');
assert(commitRangePayload.messages.some((entry: any) => entry.code === 'ATM_GUARD_COMMIT_RANGE_OK'), 'commit-range guard must stay green when only historical git-head evidence is missing');
assert((commitRangePayload.evidence?.report?.evidenceMissingDiagnostic?.count ?? 0) >= 1, 'commit-range guard must still report missing git-head evidence as diagnostic metadata');

const backfillResult = runCli(repo, ['evidence', 'git-head-backfill', '--actor', 'hook-validator', '--reason', 'pre-push worktree evidence regression', '--json']);
const backfillPayload = parsePayload(backfillResult);
assert(backfillPayload.ok === true, 'git-head backfill must succeed for pre-push regression');

const prePushAfterBackfill = runCli(repo, ['hook', 'pre-push', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
const prePushAfterBackfillPayload = parsePayload(prePushAfterBackfill);
assert(prePushAfterBackfill.status === 0, 'pre-push hook must accept worktree git-head evidence backfill for the current HEAD');
assert(prePushAfterBackfillPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_OK'), 'pre-push hook must report ok after worktree backfill');

const governedWrapperRepo = path.join(tempRoot, 'governed-wrapper-same-commit-evidence');
mkdirSync(governedWrapperRepo, { recursive: true });
materializeValidatorFixture(root, governedWrapperRepo, fixture);
runGit(governedWrapperRepo, ['init']);
runGit(governedWrapperRepo, ['config', 'user.email', 'atm@example.invalid']);
runGit(governedWrapperRepo, ['config', 'user.name', 'ATM Hook Validator']);
assert(parsePayload(runCli(governedWrapperRepo, ['bootstrap', '--cwd', governedWrapperRepo, '--json'])).ok === true, 'governed wrapper fixture bootstrap must report ok=true');
assert(parsePayload(runCli(governedWrapperRepo, ['atm-chart', 'render', '--cwd', governedWrapperRepo, '--json'])).ok === true, 'governed wrapper fixture atm-chart render must report ok=true');
assert(parsePayload(runCli(governedWrapperRepo, ['welcome', '--cwd', governedWrapperRepo, '--json'])).ok === true, 'governed wrapper fixture welcome must report ok=true');
runGit(governedWrapperRepo, ['add', '.']);
runGit(governedWrapperRepo, ['commit', '--no-verify', '-m', 'initial wrapper baseline']);
const registerGovernedActor = parsePayload(runCli(governedWrapperRepo, [
  'actor',
  'register',
  '--id',
  'hook-validator',
  '--kind',
  'ai-agent',
  '--name',
  'Hook Validator',
  '--git-name',
  'Hook Validator',
  '--git-email',
  'hook-validator@example.com',
  '--json'
]));
assert(registerGovernedActor.ok === true, 'governed wrapper fixture actor register must report ok=true');
runGit(governedWrapperRepo, ['config', 'user.name', 'Hook Validator']);
runGit(governedWrapperRepo, ['config', 'user.email', 'hook-validator@example.com']);
runGit(governedWrapperRepo, ['add', '.atm/catalog/registry/actors.json']);
runGit(governedWrapperRepo, ['commit', '--no-verify', '-m', 'register governed wrapper actor']);
const registryDrift = parsePayload(runCli(governedWrapperRepo, [
  'actor',
  'register',
  '--id',
  'hook-validator',
  '--kind',
  'ai-agent',
  '--name',
  'Hook Validator',
  '--git-name',
  'Hook Validator',
  '--git-email',
  'hook-validator@example.com',
  '--json'
]));
assert(registryDrift.ok === true, 're-registering the same actor must still succeed while creating tracked registry drift');
writeFileSync(path.join(governedWrapperRepo, 'docs', 'tracked-actor-registry-drift.md'), 'registry drift\n', 'utf8');
runGit(governedWrapperRepo, ['add', 'docs/tracked-actor-registry-drift.md']);
const driftHook = parsePayload(runCli(governedWrapperRepo, ['hook', 'pre-commit', '--json'], { allowFailure: true }));
assert(driftHook.ok === false, 'pre-commit must fail when tracked actor registry has unstaged drift');
assert((driftHook.evidence?.commitAttributionReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_COMMIT_ACTOR_REGISTRY_UNSTAGED'), 'pre-commit must surface tracked actor registry drift as a commit-attribution blocker');
const driftDoctorResult = runCli(governedWrapperRepo, ['doctor', '--json'], { allowFailure: true });
const driftDoctor = parsePayload(driftDoctorResult);
assert(driftDoctorResult.status === 1, 'doctor must exit non-zero when tracked actor registry has unstaged drift');
assert(driftDoctor.ok === false, 'doctor must fail when tracked actor registry has unstaged drift');
const governanceReadinessCheck = (driftDoctor.evidence?.checks ?? []).find((entry: any) => entry.name === 'governance-entry-readiness');
assert(governanceReadinessCheck?.ok === false, 'doctor governance-entry-readiness must fail for tracked actor registry drift');
assert(governanceReadinessCheck?.details?.actorRegistryState?.blocking === true, 'doctor must report actor registry drift details');
const driftRecoveryCommit = parsePayload(runCli(governedWrapperRepo, [
  'git',
  'commit',
  '--cwd',
  governedWrapperRepo,
  '--actor',
  'hook-validator',
  '--message',
  'chore: auto-stage tracked actor registry drift',
  '--json'
]));
assert(driftRecoveryCommit.ok === true, 'governed git commit must auto-stage tracked actor registry drift for non-task commits');
const driftRecoverySha = String(driftRecoveryCommit.evidence?.commitSha ?? '');
const driftRecoveryTouchedPaths = String(runGit(governedWrapperRepo, ['show', '--pretty=', '--name-only', driftRecoverySha]).stdout || '').trim().split(/\r?\n/).filter(Boolean);
assert(driftRecoveryTouchedPaths.includes('.atm/catalog/registry/actors.json'), 'governed drift-recovery commit must include the tracked actor registry');
assert(driftRecoveryTouchedPaths.includes('docs/tracked-actor-registry-drift.md'), 'governed drift-recovery commit must preserve the caller-staged payload');
writeFileSync(path.join(governedWrapperRepo, 'packages', 'core', 'src', 'index.ts'), 'export const governedWrapperEvidence = true;\n', 'utf8');
runGit(governedWrapperRepo, ['add', 'packages/core/src/index.ts']);
const wrapperCommit = parsePayload(runCli(governedWrapperRepo, [
  'git',
  'commit',
  '--cwd',
  governedWrapperRepo,
  '--actor',
  'hook-validator',
  '--message',
  'feat: governed wrapper same-commit evidence',
  '--json'
]));
assert(wrapperCommit.ok === true, 'governed git wrapper critical commit must report ok=true');
const wrapperCommitSha = String(wrapperCommit.evidence?.commitSha ?? '');
assert(Boolean(wrapperCommitSha), 'governed git wrapper critical commit must return commitSha');
const wrapperTouchedPaths = String(runGit(governedWrapperRepo, ['show', '--pretty=', '--name-only', wrapperCommitSha]).stdout || '').trim().split(/\r?\n/).filter(Boolean);
assert(wrapperTouchedPaths.includes('packages/core/src/index.ts'), 'governed git wrapper critical commit must include the critical file');
assert(wrapperTouchedPaths.includes('.atm/history/evidence/git-head.jsonl'), 'governed git wrapper critical commit must include git-head evidence in the same commit');
const governedPrePush = parsePayload(runCli(governedWrapperRepo, ['hook', 'pre-push', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true }));
assert(governedPrePush.ok === true, 'same-commit governed git-head evidence must satisfy pre-push without a backfill-only follow-up commit');
assert(parsePayload(runCli(governedWrapperRepo, ['git-hooks', 'install', '--framework-required', '--json'])).ok === true, 'governed wrapper fixture must install framework-required git hooks before doctor verification');
const governedDoctorAfterCommit = parsePayload(runCli(governedWrapperRepo, ['doctor', '--json']));
assert(governedDoctorAfterCommit.ok === true, 'doctor must stay green after same-commit governed git-head evidence');

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
assert(postBaselineRange.status === 0, 'commit-range guard must not fail for post-baseline critical commits that only lack historical git-head evidence');
assert(postBaselinePayload.messages.some((entry: any) => entry.code === 'ATM_GUARD_COMMIT_RANGE_OK'), 'post-baseline bypass must now stay green at the guard surface');
assert((postBaselinePayload.evidence?.report?.evidenceMissingDiagnostic?.count ?? 0) >= 1, 'post-baseline bypass must still expose missing git-head evidence as diagnostic metadata');

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
assert(warnOnlyHook.status === 0, 'pre-push hook must stay green on non-protected feature branches when the only gap is historical git-head evidence');
assert(warnOnlyPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_OK'), 'pre-push hook must report ok for non-protected branches when findings are diagnostic only');
assert(warnOnlyPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_GIT_HEAD_EVIDENCE_MISSING_DIAGNOSTIC'), 'non-protected feature branch push must still surface historical git-head evidence diagnostics');

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
assert(protectedLocalFeaturePushPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_OK'), 'protected local to feature remote push must stay green when historical git-head gaps are diagnostic only');
assert(protectedLocalFeaturePushPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_GIT_HEAD_EVIDENCE_MISSING_DIAGNOSTIC'), 'protected local to feature remote push must still surface historical git-head diagnostics');
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
assert(safeModeHook.status === 0, 'pre-push hook must stay green on protected branches when the only gap is historical git-head evidence, even if safe mode metadata is present');
assert(safeModePayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_OK'), 'protected branch historical git-head gaps must no longer require a safe-mode bypass');
assert(safeModePayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_GIT_HEAD_EVIDENCE_MISSING_DIAGNOSTIC'), 'protected branch historical git-head gaps must still surface diagnostics');
assert(safeModePayload.evidence?.enforcement?.safeModeActive === false, 'safe mode must remain inactive when no blocking findings exist');

  return { noHooksDir };
}
