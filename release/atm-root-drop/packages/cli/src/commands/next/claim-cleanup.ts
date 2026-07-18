import { runTasks } from '../tasks/public-surface.ts';
import type { TaskQueueRecord } from '../task-direction.ts';

export async function cleanupPreviousBatchQueueLocks(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly queue: TaskQueueRecord;
}) {
  const previousTaskIds = input.queue.taskIds.slice(0, Math.max(0, input.queue.currentIndex));
  for (const taskId of previousTaskIds) {
    try {
      await runTasks([
        'lock',
        'cleanup',
        '--cwd',
        input.cwd,
        '--task',
        taskId,
        '--actor',
        input.actorId,
        '--reason',
        'batch queue stale lock auto cleanup',
        '--json'
      ]);
    } catch {
      // The cleanup command already refuses active/non-stale locks; this is best-effort only.
    }
  }
}
