import { execFileSync } from 'node:child_process';
import { CliError } from '../shared.ts';
import { readCloseWindowStagedIndexLockReport } from './close-window-lock.ts';
import { readCloseTransactionStatus } from '../taskflow/close-transaction-status.ts';

/**
 * `tasks renew` must never desynchronise a close (#373).
 *
 * - A close in flight (close-window lock held by the task, or an open close
 *   transaction whose staged ledger carries the close) that has NOT landed on
 *   HEAD is refused: renewing would flip the working ledger back to running
 *   while the staged bundle still says done, which is how TASK-PRF-0140 became
 *   unrecoverable. The recovery lane is the way out.
 * - A close in flight that already landed on HEAD stays renewable: that is the
 *   governed post-crash reconcile path (renew, then taskflow close converges the
 *   remaining closeback).
 * - A closed task with no close in flight is refused: renew does not reopen it.
 */
export function assertRenewAllowedForCloseState(input: { cwd: string; taskId: string; actorId: string; status: string; relativeTaskPath: string }): void {
  const closedStatuses = new Set(['done', 'abandoned', 'review', 'blocked']);
  const statusAt = (spec: string): string | null => {
    try {
      const parsed = JSON.parse(execFileSync('git', ['show', `${spec}${input.relativeTaskPath}`], { cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      return typeof parsed?.status === 'string' ? parsed.status : null;
    } catch {
      return null;
    }
  };
  const lock = readCloseWindowStagedIndexLockReport(input.cwd);
  const transaction = readCloseTransactionStatus(input.cwd, input.taskId);
  const lockHeld = lock?.status === 'active' && lock.taskId === input.taskId;
  const transactionOpen = transaction !== null && (transaction.outcome === 'in-progress' || transaction.outcome === 'failed')
    && closedStatuses.has(statusAt(':') ?? '');
  const closeInFlight = lockHeld || transactionOpen;
  const landed = closedStatuses.has(statusAt('HEAD:') ?? '');
  if (closeInFlight && !landed) {
    throw new CliError('ATM_TASKS_RENEW_CLOSE_IN_PROGRESS', `Task ${input.taskId} has a close in progress that has not landed (${lockHeld ? 'close-window lock held' : `close transaction at ${transaction?.phase}`}); renewing would desynchronise the ledger from the staged close. Recover or abort the close first.`, {
      exitCode: 1,
      details: {
        taskId: input.taskId,
        closeWindowLockHeld: lockHeld,
        closeTransactionPhase: transaction?.phase ?? null,
        requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${input.actorId} --recover --json`
      }
    });
  }
  if (!closeInFlight && (input.status === 'done' || input.status === 'abandoned')) {
    throw new CliError('ATM_TASKS_RENEW_TASK_CLOSED', `Task ${input.taskId} is ${input.status}; tasks renew does not reopen a closed task.`, {
      exitCode: 1,
      details: { taskId: input.taskId, status: input.status, requiredCommand: `node atm.mjs taskflow status --task ${input.taskId} --json` }
    });
  }
}
