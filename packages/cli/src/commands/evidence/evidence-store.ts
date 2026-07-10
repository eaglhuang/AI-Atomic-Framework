import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalizeValidatorIdentity, detectAutoLinkedValidator } from './validator-classification.ts';
import { quoteForShell, isRecord } from './shared-utils.ts';

export function evidencePathForTask(cwd: string, taskId: string) {
  return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
}
export function taskPathForEvidence(cwd: string, taskId: string) {
  return path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
}
export function readTaskDocument(cwd: string, taskId: string): Record<string, unknown> | null {
  const taskPath = taskPathForEvidence(cwd, taskId);
  if (!existsSync(taskPath)) return null;
  const parsed = JSON.parse(readFileSync(taskPath, 'utf8')) as unknown;
  return isRecord(parsed) ? parsed : null;
}
export function readEvidenceBundle(cwd: string, taskId: string): { evidence: readonly Record<string, unknown>[] } {
  const evidencePath = evidencePathForTask(cwd, taskId);
  if (!existsSync(evidencePath)) return { evidence: [] };
  const parsed = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
  if (!isRecord(parsed)) return { evidence: [] };
  return { evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter(isRecord) : [] };
}
export function buildAutoEvidenceRequiredCommand(
  taskId: string,
  actorId: string,
  command: string,
  gate: string,
  runnerKind: 'dev-source' | 'frozen-runner'
): string {
  const escapedCommand = quoteForShell(command);
  const escapedGate = quoteForShell(gate);
  const linked = detectAutoLinkedValidator(command);
  if (linked && linked === canonicalizeValidatorIdentity(gate)) {
    return `node atm.mjs evidence run --task ${taskId} --actor ${actorId} --command ${escapedCommand} --runner-kind ${runnerKind} --json`;
  }
  return `node atm.mjs evidence run --task ${taskId} --actor ${actorId} --command ${escapedCommand} --validators ${escapedGate} --runner-kind ${runnerKind} --json`;
}
