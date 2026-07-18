import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readGitHeadCommit } from '../steward.ts';
import type { ProposalAdmissionBoundedRegion, ProposalAdmissionEvidence, ProposalAdmissionRequest, WriteIntentAtomRef } from '../types.ts';

export function readSessionId(): string | null {
  for (const key of ['ATM_SESSION_ID', 'CODEX_SESSION_ID', 'GITHUB_RUN_ID']) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function readGitBranchRef(cwd: string): string | null {
  const result = spawnSync('git', ['-C', cwd, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const branch = String(result.stdout ?? '').trim();
  return branch || null;
}

export function normalizePathList(entries: readonly string[]): readonly string[] {
  return normalizeStringList(entries.map((entry) => entry.replace(/\\/g, '/')));
}

export function normalizeStringList(entries: readonly string[]): readonly string[] {
  return [...new Set(entries.map((entry) => entry.replace(/\\/g, '/').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function buildFileHashesBefore(cwd: string, relativePaths: readonly string[]): Record<string, string | null> {
  const output: Record<string, string | null> = {};
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(cwd, relativePath);
    output[relativePath] = existsSync(absolutePath)
      ? `sha256:${createHash('sha256').update(readFileSync(absolutePath)).digest('hex')}`
      : null;
  }
  return output;
}

export function deriveTeamAtomRefs(task: Record<string, unknown> | null, taskId: string): WriteIntentAtomRef[] {
  const atomizationImpact = task?.atomizationImpact as Record<string, unknown> | undefined;
  const ownerAtom = String(atomizationImpact?.ownerAtomOrMap ?? atomizationImpact?.owner_atom_or_map ?? taskId).trim();
  const firstRegion = deriveBoundedRegions(task)[0];
  const atomCid = deriveTeamAtomCid(task, ownerAtom, taskId, firstRegion);
  return [{
    atomId: ownerAtom,
    atomCid,
    operation: 'modify',
    ...(firstRegion ? {
      sourceRange: {
        filePath: firstRegion.filePath,
        lineStart: firstRegion.lineStart,
        lineEnd: firstRegion.lineEnd
      }
    } : {})
  }];
}

export function deriveTeamAtomCid(
  task: Record<string, unknown> | null,
  ownerAtom: string,
  taskId: string,
  firstRegion: ProposalAdmissionBoundedRegion | undefined
): string {
  const atomizationImpact = task?.atomizationImpact as Record<string, unknown> | undefined;
  const proposalAdmission = asRecord(task?.proposalAdmission) ?? asRecord(task?.brokerProposalAdmission);
  const explicitAtomCid = normalizeOptionalString(
    atomizationImpact?.atomCid
    ?? atomizationImpact?.atom_cid
    ?? task?.atomCid
    ?? task?.atom_cid
    ?? proposalAdmission?.atomCid
    ?? proposalAdmission?.atom_cid
  );
  if (explicitAtomCid) {
    return explicitAtomCid;
  }
  const base = toSyntheticAtomSlug(ownerAtom || taskId);
  if (!firstRegion) {
    return base;
  }
  const fileComponent = path.posix.basename(firstRegion.filePath).replace(/\.[^.]+$/, '');
  return `${base}-${toSyntheticAtomSlug(fileComponent)}-${firstRegion.lineStart}-${firstRegion.lineEnd}`;
}

export function deriveTeamProposalAdmission(
  task: Record<string, unknown> | null,
  hotFiles: readonly string[]
): ProposalAdmissionRequest | undefined {
  const raw =
    asRecord(task?.proposalAdmission)
    ?? asRecord(task?.brokerProposalAdmission)
    ?? asRecord(task?.writeAdmission);
  const boundedRegions = deriveBoundedRegions(task);
  const configuredTrigger = normalizeProposalTrigger(raw?.trigger);
  const notes = typeof raw?.notes === 'string' && raw.notes.trim()
    ? raw.notes.trim()
    : hotFiles.length > 0
      ? 'Hot files require proposal-first admission before live write.'
      : boundedRegions.length > 0
        ? 'Bounded-region proposal admission metadata supplied by task.'
        : '';
  const trigger = configuredTrigger
    ?? (hotFiles.length > 0 ? 'hot-file' : boundedRegions.length > 0 ? 'shared-surface-risk' : null);
  if (!trigger) {
    return undefined;
  }
  return {
    trigger,
    summarySubmitted: raw?.summarySubmitted === true,
    hotFiles: normalizeStringList([...(hotFiles ?? []), ...normalizeStringArray(raw?.hotFiles)]),
    boundedRegions,
    notes
  };
}

export function deriveBoundedRegions(task: Record<string, unknown> | null): readonly ProposalAdmissionBoundedRegion[] {
  const rawRegions = normalizeRegionArray(
    asArray(task?.proposalAdmission && asRecord(task.proposalAdmission)?.boundedRegions)
    ?? asArray(task?.brokerProposalAdmission && asRecord(task.brokerProposalAdmission)?.boundedRegions)
    ?? asArray(task?.writeBoundedRegions)
    ?? asArray(task?.boundedRegions)
    ?? []
  );
  return rawRegions;
}

export function normalizeRegionArray(value: readonly unknown[]): readonly ProposalAdmissionBoundedRegion[] {
  const regions: ProposalAdmissionBoundedRegion[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const filePath = typeof record?.filePath === 'string' ? record.filePath.replace(/\\/g, '/').trim() : '';
    const lineStart = normalizePositiveInteger(record?.lineStart);
    const lineEnd = normalizePositiveInteger(record?.lineEnd);
    if (!filePath || lineStart === null || lineEnd === null || lineEnd < lineStart) {
      continue;
    }
    regions.push({ filePath, lineStart, lineEnd });
  }
  return normalizeBoundedRegionList(regions);
}

export function normalizeBoundedRegionList(regions: readonly ProposalAdmissionBoundedRegion[]): readonly ProposalAdmissionBoundedRegion[] {
  const seen = new Set<string>();
  const output: ProposalAdmissionBoundedRegion[] = [];
  for (const region of regions) {
    const key = `${region.filePath}:${region.lineStart}:${region.lineEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(region);
  }
  return output.sort((left, right) =>
    `${left.filePath}:${left.lineStart}:${left.lineEnd}`.localeCompare(`${right.filePath}:${right.lineStart}:${right.lineEnd}`)
  );
}

export function normalizeProposalTrigger(value: unknown): ProposalAdmissionRequest['trigger'] | null {
  const trigger = typeof value === 'string' ? value.trim() : '';
  if (
    trigger === 'hot-file'
    || trigger === 'same-file-overlap-risk'
    || trigger === 'shared-surface-risk'
    || trigger === 'manual-review-surface'
  ) {
    return trigger;
  }
  return null;
}

export function normalizeStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
    : [];
}

export function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

export function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function toSyntheticAtomSlug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'unknown-atom';
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function toProposalAdmissionRequest(admission: ProposalAdmissionEvidence | undefined): ProposalAdmissionRequest | undefined {
  if (!admission) {
    return undefined;
  }
  return {
    trigger: admission.trigger,
    summarySubmitted: admission.summarySubmitted,
    ...(admission.boundedRegions.length > 0 ? { boundedRegions: admission.boundedRegions } : {}),
    ...(admission.hotFiles.length > 0 ? { hotFiles: admission.hotFiles } : {}),
    ...(admission.reason ? { notes: admission.reason } : {})
  };
}
