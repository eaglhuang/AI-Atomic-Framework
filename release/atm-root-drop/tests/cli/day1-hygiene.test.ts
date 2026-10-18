import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureAdopterGitignore } from '../../packages/cli/src/commands/bootstrap-gitignore.ts';
import { ensureAdopterTaskflowProfile } from '../../packages/cli/src/commands/bootstrap-taskflow-profile.ts';
import { loadCompatibilityMatrixBundle } from '../../packages/cli/src/commands/atm-chart/compatibility.ts';
import { compactPrintedGovernanceJson } from '../../packages/cli/src/commands/shared/governance-json-compact.ts';
import { runDoctor } from '../../packages/cli/src/commands/doctor/run-doctor.ts';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-day1-hygiene-'));
const git = (args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
try {
  git(['init', '-q']);
  git(['config', 'user.name', 'N']);
  git(['config', 'user.email', 'n@example.com']);
  writeFileSync(path.join(cwd, '.gitignore'), `# ATM runtime state (managed by ATM bootstrap):start\nnode_modules/\n# ATM runtime state (managed by ATM bootstrap):end\n`);
  const updated = ensureAdopterGitignore(cwd);
  assert.equal(updated.status, 'updated');
  const gitignore = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.atm\/history\/guidance\/$/m);
  assert.match(gitignore, /^\.atm\/runtime\/welcome\.lineage\.json$/m);
  assert.equal(ensureAdopterGitignore(cwd).status, 'existing');

  const profile = ensureAdopterTaskflowProfile(cwd);
  assert.equal(profile.status, 'created');
  const parsed = JSON.parse(readFileSync(path.join(cwd, 'taskflow.profile.json'), 'utf8'));
  assert.equal(parsed.capabilities.supportsWrite, true);
  assert.equal(parsed.delegation.openerPath, 'atm:builtin');

  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: '@ai-atomic-framework/cli', version: '9.9.9' }));
  const bundled = loadCompatibilityMatrixBundle(cwd);
  assert.equal(bundled.source, 'bundled-snapshot');
  assert.equal(bundled.matrix.releaseTrain.frameworkVersion, '9.9.9');

  const doctorBefore = await runBootstrap(['--cwd', cwd, '--json']).then(() => runDoctor(['--cwd', cwd, '--json']));
  const doctorAfter = compactPrintedGovernanceJson(doctorBefore);
  const doctorBytes = {
    before: JSON.stringify(doctorBefore).length,
    after: JSON.stringify(doctorAfter).length
  };
  assert.ok(doctorBytes.after < doctorBytes.before, JSON.stringify(doctorBytes));
  const gitCheck = (doctorAfter.evidence as { checks: Array<{ name: string; details?: { status?: string } }> }).checks.find((check) => check.name === 'git-head-evidence');
  assert.equal(gitCheck?.details?.status, (doctorBefore.evidence as { checks: Array<{ name: string; details?: { status?: string } }> }).checks.find((check) => check.name === 'git-head-evidence')?.details?.status);

  git(['add', '-A']);
  git(['commit', '-qm', 'init', '--no-verify']);
  const opened = await runTaskflow([
    'open', '--cwd', cwd, '--write', '--actor', 'newcomer-ai',
    '--title', 'Add hello.txt', '--goal', 'Create hello.txt',
    '--scope-path', 'hello.txt', '--validator', 'test -f hello.txt', '--json'
  ]) as { ok: boolean; evidence: { generation: { taskId: string } }; messages?: unknown };
  assert.equal(opened.ok, true, JSON.stringify(opened.messages));
  const taskId = opened.evidence.generation.taskId;
  git(['add', '-A']);
  git(['commit', '-qm', 'card', '--no-verify']);
  const claimBeforeLive = await runNext(['--cwd', cwd, '--claim', '--actor', 'newcomer-ai', '--task', taskId, '--json']);
  const claimAfterLive = compactPrintedGovernanceJson(claimBeforeLive);
  const claimLiveBytes = {
    before: JSON.stringify(claimBeforeLive).length,
    after: JSON.stringify(claimAfterLive).length
  };
  assert.ok(claimLiveBytes.after < claimLiveBytes.before, JSON.stringify(claimLiveBytes));
  assert.equal((claimAfterLive.evidence as { nextAction: { playbook: { commandSequence: string[] } } }).nextAction.playbook.commandSequence.length > 0, true);
  const preCloseBefore = await runTaskflow(['pre-close', '--cwd', cwd, '--task', taskId, '--actor', 'newcomer-ai', '--json']);
  const preCloseAfter = compactPrintedGovernanceJson(preCloseBefore);
  const preCloseBytes = {
    before: JSON.stringify(preCloseBefore).length,
    after: JSON.stringify(preCloseAfter).length
  };
  assert.ok(preCloseBytes.after < preCloseBytes.before, JSON.stringify(preCloseBytes));
  const closeBeforeLive = await runTaskflow(['close', '--cwd', cwd, '--task', taskId, '--actor', 'newcomer-ai', '--json']);
  const closeAfterLive = compactPrintedGovernanceJson(closeBeforeLive);
  const closeLiveBytes = {
    before: JSON.stringify(closeBeforeLive).length,
    after: JSON.stringify(closeAfterLive).length
  };
  assert.ok(closeLiveBytes.after <= closeLiveBytes.before, JSON.stringify(closeLiveBytes));

  const claimBefore = {
    command: 'next',
    messages: [{ code: 'ATM_NEXT_CLAIMED', level: 'info', text: 'claimed' }],
    diagnostics: { errorCodes: [] },
    evidence: {
      nextAction: { command: 'implement-deliverables', playbook: { commandSequence: ['implement-deliverables'] } },
      laneSession: { id: 'lane-1' },
      claimResult: { taskId: 'TASK-1' },
      teamRecommendation: { blob: 'x'.repeat(8000) },
      integrationBootstrap: { blob: 'y'.repeat(8000) },
      actorSession: { blob: 'z'.repeat(4000) }
    }
  };
  const claimAfter = compactPrintedGovernanceJson(claimBefore);
  const claimBytes = { before: JSON.stringify(claimBefore).length, after: JSON.stringify(claimAfter).length };
  assert.ok(claimBytes.after < claimBytes.before, JSON.stringify(claimBytes));
  assert.equal(claimAfter.evidence.nextAction.playbook.commandSequence[0], 'implement-deliverables');
  assert.equal(claimAfter.evidence.laneSession.id, 'lane-1');
  assert.equal(claimAfter.evidence.claimResult.taskId, 'TASK-1');
  assert.equal('teamRecommendation' in claimAfter.evidence, false);

  const closeBefore = {
    command: 'taskflow pre-close',
    messages: [{ code: 'ATM_TASKFLOW_CLOSE_GIT_AUTHOR_MISSING', level: 'error', text: 'author' }],
    diagnostics: { errorCodes: ['ATM_TASKFLOW_CLOSE_GIT_AUTHOR_MISSING'] },
    evidence: {
      writeReadinessHint: { blockers: [{ code: 'ATM_TASKFLOW_CLOSE_GIT_AUTHOR_MISSING', requiredCommand: 'git config user.name "Your Name"' }] },
      historicalClosePreflight: { blockers: [{ id: 'gitAuthor' }] },
      closebackPlan: { blob: 'p'.repeat(12000) },
      governedCommitBundle: { blob: 'q'.repeat(12000) }
    }
  };
  const closeAfter = compactPrintedGovernanceJson(closeBefore);
  const closeBytes = { before: JSON.stringify(closeBefore).length, after: JSON.stringify(closeAfter).length };
  assert.ok(closeBytes.after < closeBytes.before, JSON.stringify(closeBytes));
  assert.equal(closeAfter.evidence.writeReadinessHint.blockers[0].requiredCommand, 'git config user.name "Your Name"');
  assert.equal(closeAfter.diagnostics.errorCodes[0], 'ATM_TASKFLOW_CLOSE_GIT_AUTHOR_MISSING');
  assert.equal('closebackPlan' in closeAfter.evidence, false);

  console.log(JSON.stringify({ doctorBytes, claimLiveBytes, preCloseBytes, closeLiveBytes, claimBytes, closeBytes }));
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: day-1 hygiene');
