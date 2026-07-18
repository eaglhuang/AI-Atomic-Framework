import type {
  ProposalAdmissionBoundedRegion,
  ProposalAdmissionEvidence,
  ProposalAdmissionRequest,
  ProposalAdmissionState,
  WriteIntent
} from '../types.ts';

export function buildProposalAdmissionBase(intent: WriteIntent): ProposalAdmissionEvidence {
  const request = intent.proposalAdmission ?? defaultProposalAdmissionRequest();
  return {
    trigger: request.trigger,
    state: 'not-required',
    requiresProposal: request.trigger !== 'not-required',
    summarySubmitted: request.summarySubmitted,
    hotFiles: normalizeStringList(request.hotFiles ?? []),
    boundedRegions: normalizeBoundedRegions(request.boundedRegions ?? []),
    rearbitrationRequired: false,
    reason: request.notes?.trim() || 'No proposal admission trigger is active.'
  };
}

export function finalizeProposalAdmission(
  base: ProposalAdmissionEvidence,
  preferredState: ProposalAdmissionState,
  overrides: {
    readonly reason: string;
    readonly rearbitrationRequired?: boolean;
  }
): ProposalAdmissionEvidence {
  const state = !base.requiresProposal
    ? preferredState === 'blocked-before-write' || preferredState === 'composer-routed'
      ? preferredState
      : 'not-required'
    : base.summarySubmitted
      ? preferredState
      : preferredState === 'blocked-before-write'
        ? 'blocked-before-write'
        : 'proposal-submitted';
  return {
    ...base,
    state,
    rearbitrationRequired: overrides.rearbitrationRequired ?? false,
    reason: overrides.reason
  };
}

export function defaultProposalAdmissionRequest(): ProposalAdmissionRequest {
  return {
    trigger: 'not-required',
    summarySubmitted: false
  };
}

export function normalizeStringList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeBoundedRegions(values: readonly ProposalAdmissionBoundedRegion[]): readonly ProposalAdmissionBoundedRegion[] {
  return values
    .filter((value) => value.filePath && value.lineStart > 0 && value.lineEnd >= value.lineStart)
    .map((value) => ({
      filePath: value.filePath,
      lineStart: value.lineStart,
      lineEnd: value.lineEnd
    }))
    .sort((left, right) => {
      const fileOrder = left.filePath.localeCompare(right.filePath);
      if (fileOrder !== 0) return fileOrder;
      const startOrder = left.lineStart - right.lineStart;
      if (startOrder !== 0) return startOrder;
      return left.lineEnd - right.lineEnd;
    });
}
