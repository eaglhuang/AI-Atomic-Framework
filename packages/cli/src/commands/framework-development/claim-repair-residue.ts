import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isCanonicalTaskIdDeclaration } from '../tasks/canonical-task-id-boundary.ts';

/** Resolve generated audit ownership from its producer contract, never filename guessing. */
export function readClaimRepairReportOwner(cwd: string | null | undefined, filePath: string): string | null {
  if (!cwd || !/^\.atm\/history\/reports\/claim-repair\/[^/]+\.json$/i.test(filePath)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path.join(cwd, filePath), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const report = value as Record<string, unknown>;
    if (report.schemaId !== 'atm.claimRepairReport.v1' || typeof report.taskId !== 'string'
      || !isCanonicalTaskIdDeclaration(report.taskId) || typeof report.actorId !== 'string'
      || !report.actorId.trim() || typeof report.reason !== 'string' || !report.reason.trim()
      || typeof report.generatedAt !== 'string' || !Number.isFinite(Date.parse(report.generatedAt))
      || !isRecord(report.before) || !isRecord(report.after)
      || !Array.isArray(report.repairActions) || !report.repairActions.every((action) => typeof action === 'string')
      || !Array.isArray(report.issues)) return null;
    return report.taskId.trim().toUpperCase();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
