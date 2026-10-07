import type { ActiveWriteIntent, ProposalAdmissionBoundedRegion, WriteIntent } from '../types.ts';
import { normalizeBoundedRegions } from './admission.ts';

/** Proposal bounds take precedence over coarse atom ownership ranges. */
export function resolveProposalRegionsForFile(intent: WriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[] {
  const declared = (intent.proposalAdmission?.boundedRegions ?? []).filter((region) => region.filePath === filePath);
  return normalizeBoundedRegions(declared.length > 0 ? declared : intent.atomRefs.flatMap((ref) =>
    ref.sourceRange?.filePath === filePath ? [ref.sourceRange] : []));
}

export function resolveActiveProposalRegionsForFile(intent: ActiveWriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[] {
  const declared = (intent.admission?.boundedRegions ?? []).filter((region) => region.filePath === filePath);
  return normalizeBoundedRegions(declared.length > 0 ? declared : (intent.resourceKeys.atomRanges ?? [])
    .filter((range) => range.filePath === filePath));
}

export function findOverlappingProposalRegion(left: readonly ProposalAdmissionBoundedRegion[],
  right: readonly ProposalAdmissionBoundedRegion[]): ProposalAdmissionBoundedRegion | null {
  for (const a of left) {
    for (const b of right) {
      if (a.filePath === b.filePath && a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd) {
        return { filePath: a.filePath, lineStart: Math.max(a.lineStart, b.lineStart), lineEnd: Math.min(a.lineEnd, b.lineEnd) };
      }
    }
  }
  return null;
}
