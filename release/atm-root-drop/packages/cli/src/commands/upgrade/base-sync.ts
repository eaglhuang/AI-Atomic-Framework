import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectFrameworkIdentity } from '../../../../core/src/project/framework-identity.ts';
import { CliError, makeResult, message } from '../shared.ts';

/** A separate maintenance authority: imports existing commits, never authors source. */
export function runFrameworkBaseSync(argv: readonly string[]) {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'base-sync' || arg === '--json' || arg === '--pretty') continue;
    if (!['--cwd', '--actor', '--from', '--to'].includes(arg) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `upgrade base-sync: unsupported or incomplete option ${arg}`, { exitCode: 2 });
    }
    options[arg] = argv[++i];
  }
  const cwd = path.resolve(options['--cwd'] ?? process.cwd());
  const actor = options['--actor']?.trim();
  const from = options['--from'];
  const to = options['--to'];
  if (!actor || !/^[a-f0-9]{40}$/i.test(from ?? '') || !/^[a-f0-9]{40}$/i.test(to ?? '')) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade base-sync requires --actor and full commit SHAs for --from and --to.', { exitCode: 2 });
  }
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new CliError('ATM_BASE_SYNC_GIT_FAILED', `git ${args[0]} failed; base sync refused.`, {
      exitCode: 1, details: { stderr: result.stderr, stdout: result.stdout }
    });
    return result.stdout.trim();
  };
  if (path.resolve(git('rev-parse', '--show-toplevel')) !== cwd || inspectFrameworkIdentity(cwd).kind !== 'framework') {
    throw new CliError('ATM_BASE_SYNC_FRAMEWORK_REQUIRED', 'Run base-sync at the framework source repository root.', { exitCode: 1 });
  }
  // Git metadata keeps the audit outside the imported tree and supports worktrees.
  const receiptDir = path.resolve(cwd, git('rev-parse', '--git-path', 'atm-base-sync'));
  mkdirSync(receiptDir, { recursive: true });
  const receiptPath = path.join(receiptDir, `${randomUUID()}.json`);
  if (git('status', '--porcelain', '--untracked-files=all')) {
    throw new CliError('ATM_BASE_SYNC_DIRTY', 'Base sync requires a clean index and worktree, including untracked files.', { exitCode: 1 });
  }
  if (git('rev-parse', 'HEAD') !== from.toLowerCase()) {
    throw new CliError('ATM_BASE_SYNC_HEAD_MISMATCH', 'HEAD must equal the expected --from SHA.', { exitCode: 1 });
  }
  // Resolve objects before mutation; never interpret a ref name or an option as a target.
  if (git('rev-parse', '--verify', `${to}^{commit}`) !== to.toLowerCase() || from.toLowerCase() === to.toLowerCase()) {
    throw new CliError('ATM_BASE_SYNC_TARGET_INVALID', '--to must identify a different commit.', { exitCode: 1 });
  }
  const ancestor = (older: string, newer: string) => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd, encoding: 'utf8' });
    if (result.status === 0 || result.status === 1) return result.status === 0;
    throw new CliError('ATM_BASE_SYNC_GIT_FAILED', 'git merge-base failed; base sync refused.', { exitCode: 1, details: { stderr: result.stderr, stdout: result.stdout } });
  };
  // Fast-forward a descendant. Otherwise create one merge commit, unless HEAD already contains the target.
  const fastForward = ancestor(from, to);
  if (!fastForward && ancestor(to, from)) {
    throw new CliError('ATM_BASE_SYNC_GIT_FAILED', '--to is already contained by HEAD; base sync refused.', { exitCode: 1 });
  }
  const mode = fastForward ? 'fast-forward' : 'merge-commit';
  const receipt = { schemaId: 'atm.frameworkBaseSync.v1', actor, cwd, from, to, mode, startedAt: new Date().toISOString(), status: 'pending' };
  // Prove the receipt can be persisted before changing HEAD. Pending receipts survive interruption.
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  try {
    if (fastForward) {
      git('merge', '--ff-only', '--no-edit', to);
      if (git('rev-parse', 'HEAD') !== to.toLowerCase()) throw new Error('HEAD did not reach the target');
    } else {
      git('merge', '--no-ff', '--no-edit', '-m', `atm base-sync: merge ${to} into ${from}`, to);
      const recorded = git('rev-list', '--parents', '-n', '1', 'HEAD').split(/\s+/);
      if (recorded.length !== 3 || recorded[1] !== from.toLowerCase() || recorded[2] !== to.toLowerCase()) {
        git('reset', '--keep', from);
        throw new Error('HEAD did not record a merge of the pinned commits');
      }
    }
    if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('worktree dirty after base sync');
    writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, status: 'completed', completedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD') }, null, 2)}\n`);
  } catch (error) {
    spawnSync('git', ['merge', '--abort'], { cwd, encoding: 'utf8' });
    writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, status: 'failed', head: git('rev-parse', 'HEAD') }, null, 2)}\n`);
    throw error;
  }
  const summary = fastForward
    ? 'Framework base advanced by fast-forward only.'
    : 'Framework branch advanced by a governed merge commit of the pinned target.';
  return makeResult({ ok: true, command: 'upgrade', cwd, messages: [message('info', 'ATM_BASE_SYNC_COMPLETED', summary)], evidence: { ...receipt, status: 'completed', receiptPath, head: git('rev-parse', 'HEAD') } });
}
