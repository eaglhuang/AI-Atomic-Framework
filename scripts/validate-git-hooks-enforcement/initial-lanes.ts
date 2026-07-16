import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assert, completeLaneBoundary, fixture, parsePayload, rewritePackageScripts, root, runCli, runGit, tempRoot, writeHistoricalRestorePacket } from './context.ts';
import { materializeValidatorFixture } from '../lib/validator-fixture.ts';

export function runInitialLanes() {
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
completeLaneBoundary('install');
rewritePackageScripts(repo, {
  typecheck: 'node -e "process.exit(0)"',
  'validate:cli': 'node -e "process.exit(0)"',
  'validate:git-head-evidence': 'node -e "process.exit(0)"'
});

writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const deferredGovernanceOnly = true;\n', 'utf8');
runGit(repo, ['add', 'packages/core/src/index.ts']);
const deferredGovernanceHook = parsePayload(runCli(repo, ['hook', 'pre-commit', '--json'], { allowFailure: true }));
assert(deferredGovernanceHook.ok === false, 'critical framework edit without claim must fail pre-commit');
assert(deferredGovernanceHook.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_COMMIT_DEFERRED_GOVERNANCE_REQUIRED'), 'missing framework claim must surface deferred-governance hook code');
assert(deferredGovernanceHook.evidence?.failureEnvelope?.deferredGovernanceCandidate === true, 'missing framework claim must mark deferredGovernanceCandidate=true');
assert((deferredGovernanceHook.evidence?.failureEnvelope?.governanceStateFailures ?? []).some((entry: any) => entry.code === 'ATM_FRAMEWORK_ACTIVE_FRAMEWORK_CLAIM_REQUIRED'), 'missing framework claim must classify the blocker as governance-state');
assert((deferredGovernanceHook.evidence?.failureEnvelope?.contentValidationFailures ?? []).length === 0, 'governance-only pre-commit block must not report content validation failures');
runGit(repo, ['restore', '--staged', 'packages/core/src/index.ts']);
runGit(repo, ['restore', 'packages/core/src/index.ts']);

writeFileSync(path.join(repo, 'docs-only.txt'), 'governed commit\n', 'utf8');
runGit(repo, ['add', 'docs-only.txt']);
const explicitPreCommit = parsePayload(runCli(repo, ['hook', 'pre-commit', '--json']));
assert(explicitPreCommit.ok === true, 'explicit pre-commit hook command must succeed for governed docs change');
assert(explicitPreCommit.evidence?.gitHeadEvidenceRequired === false, 'docs-only pre-commit must not require git-head evidence');
assert(!existsSync(path.join(repo, '.atm', 'history', 'evidence', 'git-head.jsonl')), 'docs-only pre-commit must not write git-head evidence');
const governedCommit = runGit(repo, ['commit', '--no-verify', '-m', 'governed docs change']);
assert(governedCommit.status === 0, 'governed commit must succeed after explicit hook validation');

writeFileSync(path.join(repo, 'foreign-residue.txt'), 'foreign governance residue\n', 'utf8');
runGit(repo, ['add', 'foreign-residue.txt']);
writeHistoricalRestorePacket(repo, 'TASK-HOOK-FOREIGN-0001');
const foreignResidueHook = parsePayload(runCli(repo, ['hook', 'pre-commit', '--json'], { allowFailure: true }));
assert(foreignResidueHook.ok === false, 'pre-commit must fail closed on foreign governance residue');
const hookBlockingFindings = foreignResidueHook.evidence?.blockingFindings ?? [];
assert(hookBlockingFindings.some((entry: any) => entry.code === 'ATM_HOOK_GENERATED_RESIDUE_BLOCKED'), 'foreign governance residue must use the dedicated hook blocked code');
const hookResiduePaths = hookBlockingFindings.map((entry: any) => String(entry.file ?? entry.path ?? ''));
assert(hookResiduePaths.includes('.atm/history/evidence/TASK-HOOK-FOREIGN-0001.closure-packet.json'), 'hook residue diagnostics must report the foreign closure packet');
assert(hookResiduePaths.some((entry: string) => entry.startsWith('.atm/history/task-events/TASK-HOOK-FOREIGN-0001/')), 'hook residue diagnostics must report the foreign task-event residue');
runGit(repo, ['reset', '--', 'foreign-residue.txt']);
rmSync(path.join(repo, 'foreign-residue.txt'), { force: true });
rmSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-HOOK-FOREIGN-0001.json'), { force: true });
rmSync(path.join(repo, '.atm', 'history', 'evidence', 'TASK-HOOK-FOREIGN-0001.json'), { force: true });
rmSync(path.join(repo, '.atm', 'history', 'evidence', 'TASK-HOOK-FOREIGN-0001.closure-packet.json'), { force: true });
rmSync(path.join(repo, '.atm', 'history', 'task-events', 'TASK-HOOK-FOREIGN-0001'), { recursive: true, force: true });
completeLaneBoundary('pre-commit');

  return { repo };
}
