import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { tryBuildQuickfixClaimResult } from '../../packages/cli/src/commands/next/claim-early-results.ts';
import { createDeterministicTaskIntent, inspectImportedTaskQueue } from '../../packages/cli/src/commands/next/route-resolution.ts';
import { readActiveQuickfixLock } from '../../packages/cli/src/commands/work-channels.ts';

const scenarios = [
  { name: 'explicit files without prompt paths', prompt: 'quickfix a typo', active: false },
  { name: 'release file despite unrelated active task', prompt: 'quickfix release note', active: true }
];
for (const scenario of scenarios) {
  if (process.env.ATM_QUICKFIX_TEST_ACTIVE === '1' && !scenario.active) continue;
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-quickfix-scope-'));
  execFileSync('git', ['init', '-q'], { cwd });
  mkdirSync(path.join(cwd, '.atm/history/tasks'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm/config.json'), JSON.stringify({ schemaVersion: 'atm.config.v0.1', layoutVersion: 2 }));
  if (scenario.active) writeFileSync(path.join(cwd, '.atm/history/tasks/TASK-OTHER.json'), JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2', workItemId: 'TASK-OTHER', title: 'Unrelated adapter',
    status: 'running', scopePaths: ['src/adapter.ts'],
    claim: { state: 'active', actorId: 'other-agent', intent: 'write', laneSession: { laneSessionId: 'lane-other' } }
  }));
  const file = 'docs/releases/0.1.23.md';
  const args = ['--cwd', cwd, '--claim', '--actor', 'fixture-agent', '--prompt', scenario.prompt, '--files', file];
  const result = process.env.ATM_QUICKFIX_TEST_FROZEN === '1'
    ? JSON.parse(execFileSync(process.execPath, ['atm.mjs', 'next', ...args, '--json'], { encoding: 'utf8' }))
    : await runNext(args);
  assert.equal(result.evidence.nextAction.recommendedChannel, 'fast', scenario.name);
  assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, [file], scenario.name);
  assert.equal(readActiveQuickfixLock(cwd)?.maxChangedLines, 80);
  if (scenario.active && process.env.ATM_QUICKFIX_TEST_FROZEN !== '1') {
    const input = { cwd, actor: 'fixture-agent', promptText: scenario.prompt, quickfixScope: [file],
      ...result.evidence } as unknown as Parameters<typeof tryBuildQuickfixClaimResult>[0];
    const queue = { ...inspectImportedTaskQueue(cwd, createDeterministicTaskIntent('TASK-OTHER', ['TASK-OTHER'])), promptScope: null };
    assert.ok(queue.claimableTask, 'fixture contains an unrelated active task');
    assert.equal(tryBuildQuickfixClaimResult({ ...input, importedTaskQueue: queue })?.ok, true);
    assert.equal(tryBuildQuickfixClaimResult({ ...input, importedTaskQueue: queue,
      taskIntent: { ...input.taskIntent!, taskScopeMentioned: true } }), null);
  }
  console.log(`ok - ${scenario.name}`);
}
