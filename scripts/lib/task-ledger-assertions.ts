import { existsSync } from 'node:fs';
import path from 'node:path';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';
import { runTasks as runTasksBackend } from '../../packages/cli/src/commands/tasks.ts';
import { withTaskflowOperatorLane } from '../../packages/cli/src/commands/emergency/context.ts';
import { readJson, sha256File, runTasks } from './task-ledger-fixture-builder.ts';

export function fail(message: string): never {
  console.error(`[task-ledger-governance] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}
export function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}
export function assertLastTransitionHashMatchesDisk(repo: string, taskId: string) {
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  const task = readJson(taskPath);
  const transitionId = task.lastTransitionId;
  assert(typeof transitionId === 'string' && transitionId.length > 0, `${taskId} must record lastTransitionId`);
  const eventPath = path.join(repo, '.atm', 'history', 'task-events', taskId, `${transitionId}.json`);
  assert(existsSync(eventPath), `${taskId} transition event must exist`);
  const event = readJson(eventPath);
  assert(event.taskSha256 === sha256File(taskPath), `${taskId} transition event taskSha256 must match persisted task document`);
}
export function evidenceReport(result: Awaited<ReturnType<typeof runTasks>>): Record<string, any> {
  return ((result as any)?.evidence ?? {}) as Record<string, any>;
}
export async function expectTaskError(argv: string[], code: string) {
  try { await runTasks(argv); fail(`tasks ${argv.join(' ')} expected ${code} but succeeded.`); }
  catch (error) { assert((error as { code?: string }).code === code, `tasks ${argv.join(' ')} expected ${code}, got ${(error as { code?: string }).code ?? 'unknown'}.`); }
}
export async function expectTaskErrorDetails(argv: string[], code: string): Promise<Record<string, any>> {
  try { await runTasks(argv); fail(`tasks ${argv.join(' ')} expected ${code} but succeeded.`); }
  catch (error) {
    assert((error as { code?: string }).code === code, `tasks ${argv.join(' ')} expected ${code}, got ${(error as { code?: string }).code ?? 'unknown'}.`);
    return ((error as { details?: Record<string, any> }).details ?? {}) as Record<string, any>;
  }
}
export async function expectTaskflowErrorDetails(argv: string[], code: string): Promise<Record<string, any>> {
  try { await runTaskflow(argv); fail(`taskflow ${argv.join(' ')} expected ${code} but succeeded.`); }
  catch (error) {
    assert((error as { code?: string }).code === code, `taskflow ${argv.join(' ')} expected ${code}, got ${(error as { code?: string }).code ?? 'unknown'}.`);
    return ((error as { details?: Record<string, any> }).details ?? {}) as Record<string, any>;
  }
}
export async function expectBackendTaskErrorDetails(argv: string[], code: string): Promise<Record<string, any>> {
  try { await withTaskflowOperatorLane(() => runTasksBackend(argv)); fail(`tasks backend ${argv.join(' ')} expected ${code} but succeeded.`); }
  catch (error) {
    assert((error as { code?: string }).code === code, `tasks backend ${argv.join(' ')} expected ${code}, got ${(error as { code?: string }).code ?? 'unknown'}.`);
    return ((error as { details?: Record<string, any> }).details ?? {}) as Record<string, any>;
  }
}
