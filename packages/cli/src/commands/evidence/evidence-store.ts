import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalizeValidatorIdentity, detectAutoLinkedValidator } from './validator-classification.ts';
import { quoteForShell, isRecord } from './shared-utils.ts';

export function evidencePathForTask(cwd: string, taskId: string) {
  return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
}
/**
 * The only adapter-owned legacy evidence root. Runtime callers must use the
 * ledger for new evidence and keep this path solely for historical reads.
 */
export function legacyEvidenceDirectory(cwd: string) {
  return path.join(cwd, '.atm', 'history', 'evidence');
}
export function evidenceBundleManifestRelativePath(taskId: string) {
  return `.atm/history/evidence/${taskId}.bundle-manifest.json`;
}
export function evidenceBundleManifestPathForTask(cwd: string, taskId: string) {
  return path.join(cwd, evidenceBundleManifestRelativePath(taskId));
}
export function taskPathForEvidence(cwd: string, taskId: string) {
  return path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
}
export function runnerSyncReceiptPathForTask(cwd: string, taskId: string) {
  return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.runner-sync-receipt.json`);
}
export function readTaskRunnerSyncReceipt(cwd: string, taskId: string): Record<string, unknown> | null {
  const directPath = runnerSyncReceiptPathForTask(cwd, taskId);
  if (existsSync(directPath)) {
    try {
      const parsed = JSON.parse(readFileSync(directPath, 'utf8')) as unknown;
      if (isRecord(parsed) && parsed.schemaId === 'atm.runnerSyncReceipt.v1') return parsed;
    } catch {
      // ignore
    }
  }
  const evidenceDir = legacyEvidenceDirectory(cwd);
  if (!existsSync(evidenceDir)) return null;
  try {
    const files = readdirSync(evidenceDir).filter((f) => f.endsWith('.runner-sync-receipt.json'));
    for (const f of files) {
      const filePath = path.join(evidenceDir, f);
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
        if (isRecord(parsed) && parsed.schemaId === 'atm.runnerSyncReceipt.v1') {
          const linkedTaskIds = Array.isArray(parsed.linkedTaskIds)
            ? parsed.linkedTaskIds.filter((id): id is string => typeof id === 'string')
            : [];
          const memberTaskIds = Array.isArray(parsed.memberTaskIds)
            ? parsed.memberTaskIds.filter((id): id is string => typeof id === 'string')
            : [];
          if (linkedTaskIds.includes(taskId) || memberTaskIds.includes(taskId) || parsed.taskId === taskId) {
            return parsed;
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null;
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
