import { existsSync } from 'node:fs';
import path from 'node:path';

export interface CurrentTaskCloseEvidence {
  readonly schemaId: 'atm.taskflowCurrentCloseEvidence.v1';
  readonly taskId: string;
  readonly supportedPaths: readonly string[];
}

function normalizeTaskId(taskId: string): string {
  return taskId.trim();
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * The supported evidence types are a closed contract.  Callers must not infer
 * ownership from a broad task-id glob because unknown evidence needs to remain
 * visible to fail-closed closeout diagnostics.
 */
export function buildCurrentTaskCloseEvidence(taskId: string): CurrentTaskCloseEvidence {
  const normalizedTaskId = normalizeTaskId(taskId);
  const evidenceRoot = `.atm/history/evidence/${normalizedTaskId}`;
  return {
    schemaId: 'atm.taskflowCurrentCloseEvidence.v1',
    taskId: normalizedTaskId,
    supportedPaths: [
      `${evidenceRoot}.json`,
      `${evidenceRoot}.bundle-manifest.json`,
      `${evidenceRoot}.closure-packet.json`,
      `${evidenceRoot}.live-index-reconciliation.json`,
      `${evidenceRoot}.runner-publication-takeover.json`,
      `${evidenceRoot}.runner-sync-receipt.json`,
      `${evidenceRoot}.seal-and-commit.json`
    ]
  };
}

export function isCurrentTaskCloseEvidenceFile(taskId: string, filePath: string): boolean {
  const evidence = buildCurrentTaskCloseEvidence(taskId);
  const normalizedFile = normalizeRelativePath(filePath);
  return evidence.supportedPaths.some((supportedPath) => normalizeRelativePath(supportedPath) === normalizedFile);
}

export function listCurrentTaskCloseEvidenceFiles(root: string, taskId: string): string[] {
  return buildCurrentTaskCloseEvidence(taskId).supportedPaths
    .filter((relativePath) => existsSync(path.join(root, relativePath)));
}
