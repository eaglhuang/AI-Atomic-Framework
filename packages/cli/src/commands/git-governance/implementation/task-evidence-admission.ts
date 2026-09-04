import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeRelativePath } from '../commit-scope-policy.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;

function isUndeclaredClosurePacket(filePath: string, taskId: string, taskDocument: LegacyValue): boolean {
  const expectedPath = typeof taskDocument.closurePacket === 'string'
    ? normalizeRelativePath(taskDocument.closurePacket)
    : null;
  const candidatePath = normalizeRelativePath(filePath);
  const defaultPath = `.atm/history/evidence/${taskId.toLowerCase()}.closure-packet.json`;
  return candidatePath.toLowerCase() === defaultPath && expectedPath?.toLowerCase() !== candidatePath.toLowerCase();
}

function hasSingleMatchingEvidenceTaskId(cwd: string, filePath: string, taskId: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  const lower = normalized.toLowerCase();
  if (!lower.startsWith('.atm/history/evidence/') || lower.startsWith('.atm/history/evidence/historical-batches/')) return true;
  try {
    const evidence = JSON.parse(readFileSync(path.join(cwd, normalized), 'utf8')) as LegacyValue;
    const taskIds = new Set<string>();
    if (typeof evidence?.taskId === 'string') taskIds.add(evidence.taskId.trim().toLowerCase());
    if (Array.isArray(evidence?.attestations)) for (const attestation of evidence.attestations) if (typeof attestation?.taskId === 'string') taskIds.add(attestation.taskId.trim().toLowerCase());
    if (Array.isArray(evidence?.tasks)) for (const task of evidence.tasks) if (typeof task?.taskId === 'string') taskIds.add(task.taskId.trim().toLowerCase());
    return taskIds.size === 1 && taskIds.has(taskId.trim().toLowerCase());
  } catch { return false; }
}

export function isUncommittableTaskEvidenceArtifact(cwd: string, filePath: string, taskId: string, taskDocument: LegacyValue, terminalHistoryCleanupAllowed = false): boolean {
  return isUndeclaredClosurePacket(filePath, taskId, taskDocument) || (!terminalHistoryCleanupAllowed && !hasSingleMatchingEvidenceTaskId(cwd, filePath, taskId));
}
