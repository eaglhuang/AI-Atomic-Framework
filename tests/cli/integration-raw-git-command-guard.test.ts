import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIntegrationHookInvocationInProcess } from '../../packages/cli/src/commands/integration-hooks.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-raw-git-command-guard-'));

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function preTool(command: string) {
  return await runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'codex',
    '--tool-name', 'shell',
    '--command', command,
    '--json'
  ]) as any;
}

try {
  writeJson(path.join(repo, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });

  const readOnly = await preTool('git status --short');
  assert.equal(readOnly.ok, true, 'read-only git status should remain allowed');

  const atmWrapper = await preTool('node atm.mjs git commit --actor codex --task TASK-GIT-0013 --message "safe" --json');
  assert.equal(atmWrapper.ok, true, 'ATM-governed git wrapper command should remain allowed by the raw-git guard');

  const rawStage = await preTool('git restore --staged -- packages/cli/src/commands/hook/pre-commit.ts');
  assert.equal(rawStage.ok, false, 'raw git restore --staged must be blocked');
  assert.equal(rawStage.messages[0]?.code, 'ATM_RAW_GIT_MUTATION_BLOCKED');
  assert.equal(rawStage.evidence.rawGitMutation.riskLevel, 'stage-only');
  assert.equal(rawStage.evidence.relatedBacklog, 'ATM-BUG-2026-07-12-161');
  assert.equal(rawStage.evidence.rawGitMutation.overridePolicy.chatTextAccepted, false, 'override phrase in chat must not unlock stage mutation');

  const rawRestore = await preTool('git restore -- packages/cli/src/commands/hook/pre-commit.ts');
  assert.equal(rawRestore.ok, false, 'raw git restore worktree mutation must be blocked');
  assert.equal(rawRestore.evidence.rawGitMutation.riskLevel, 'destructive');

  const rawReset = await preTool('git reset --hard');
  assert.equal(rawReset.ok, false, 'raw git reset --hard must be blocked');
  assert.equal(rawReset.evidence.rawGitMutation.riskLevel, 'destructive');

  const rawCheckoutPath = await preTool('git checkout -- packages/cli/src/commands/hook/pre-commit.ts');
  assert.equal(rawCheckoutPath.ok, false, 'raw git checkout -- <path> must be blocked');
  assert.equal(rawCheckoutPath.evidence.rawGitMutation.riskLevel, 'destructive');

  const rawSwitchForce = await preTool('git switch -f main');
  assert.equal(rawSwitchForce.ok, false, 'raw git switch -f must be blocked');
  assert.equal(rawSwitchForce.evidence.rawGitMutation.riskLevel, 'destructive');

  const rawClean = await preTool('git clean -fd');
  assert.equal(rawClean.ok, false, 'raw git clean must be blocked');
  assert.equal(rawClean.evidence.rawGitMutation.riskLevel, 'destructive');

  const rawRm = await preTool('git rm packages/cli/src/commands/hook/pre-commit.ts');
  assert.equal(rawRm.ok, false, 'raw git rm must be blocked');
  assert.equal(rawRm.evidence.rawGitMutation.riskLevel, 'destructive');

  const rawUpdateIndex = await preTool('git update-index --skip-worktree packages/cli/src/commands/hook/pre-commit.ts');
  assert.equal(rawUpdateIndex.ok, false, 'raw git update-index must be blocked');
  assert.equal(rawUpdateIndex.evidence.rawGitMutation.riskLevel, 'destructive');

  const rawReadTree = await preTool('git read-tree --reset -u HEAD');
  assert.equal(rawReadTree.ok, false, 'raw git read-tree must be blocked');
  assert.equal(rawReadTree.evidence.rawGitMutation.riskLevel, 'destructive');

  const rawNoVerify = await preTool('git commit --no-verify -m unsafe');
  assert.equal(rawNoVerify.ok, false, 'direct git commit --no-verify must be blocked before hook bypass');
  assert.equal(rawNoVerify.evidence.rawGitMutation.riskLevel, 'governed-git-required');
  assert.match(rawNoVerify.evidence.rawGitMutation.requiredCommand, /node atm\.mjs git commit/);

  const rawPush = await preTool('git push origin main');
  assert.equal(rawPush.ok, false, 'direct git push must be blocked before bypassing ATM admission');
  assert.equal(rawPush.evidence.rawGitMutation.riskLevel, 'governed-git-required');
  assert.match(rawPush.evidence.rawGitMutation.requiredCommand, /node atm\.mjs git push/);

  const phraseDoesNotUnlock = await preTool(`git restore --staged -- packages/cli/src/commands/hook/pre-commit.ts # ${rawStage.evidence.rawGitMutation.overridePolicy.stageOnlyPhrase}`);
  assert.equal(phraseDoesNotUnlock.ok, false, 'stage override phrase in a raw shell command must not unlock without an ATM lease');
  assert.equal(phraseDoesNotUnlock.messages[0]?.code, 'ATM_RAW_GIT_MUTATION_BLOCKED');

  const pushPhraseDoesNotUnlock = await preTool('git push origin main # ATM-GOVERNED-ACTION-I-UNDERSTAND');
  assert.equal(pushPhraseDoesNotUnlock.ok, false, 'governed-action text in a raw shell command must not unlock direct push');
  assert.equal(pushPhraseDoesNotUnlock.messages[0]?.code, 'ATM_RAW_GIT_MUTATION_BLOCKED');

  console.log('[integration-raw-git-command-guard] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
