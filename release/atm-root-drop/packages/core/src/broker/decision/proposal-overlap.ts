import type {
  ActiveWriteIntent,
  BrokerConflictMatrix,
  BrokerDecision,
  ProposalAdmissionBoundedRegion,
  ProposalAdmissionEvidence,
  WriteIntent
} from '../types.ts';
import { finalizeProposalAdmission, normalizeBoundedRegions } from './admission.ts';
import { withFailureReason } from './failure.ts';
import { findResourceOverlapMatches } from '../resource-overlap.ts';

function collectSharedFiles(newIntent: WriteIntent, activeIntent: ActiveWriteIntent): readonly string[] {
  const matches = findResourceOverlapMatches('file', newIntent.targetFiles, activeIntent.resourceKeys.files);
  const shared = new Set<string>();
  // Prefer the active (literal) key when available; that is the physical path
  // any downstream region resolver will look up in the active intent.
  for (const match of matches) {
    shared.add(match.rightKey);
  }
  return [...shared];
}

export function evaluateProposalOverlap(
  newIntent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[],
  baseAdmission: ProposalAdmissionEvidence,
  conflictMatrix: BrokerConflictMatrix
): BrokerDecision | null {
  if (!baseAdmission.requiresProposal) {
    return null;
  }

  for (const activeIntent of activeIntents) {
    if (activeIntent.taskId === newIntent.taskId) {
      continue;
    }

    const sharedFiles = collectSharedFiles(newIntent, activeIntent);
    if (sharedFiles.length === 0) {
      continue;
    }

    const activeAdmission = activeIntent.admission;
    const activeRequiresProposal = activeAdmission?.requiresProposal ?? false;
    if (!activeRequiresProposal) {
      continue;
    }

    for (const filePath of sharedFiles) {
      const newRegions = resolveProposalRegionsForFile(newIntent, filePath);
      const activeRegions = resolveActiveProposalRegionsForFile(activeIntent, filePath);
      const overlapping = findOverlappingProposalRegion(newRegions, activeRegions);

      if (overlapping) {
        return {
          ...withFailureReason({
          schemaId: 'atm.brokerDecision.v1',
          specVersion: '0.1.0',
          migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
          intentId: `decision-${Date.now()}`,
          taskId: newIntent.taskId,
          verdict: 'blocked-active-lease',
          lane: 'blocked',
          conflicts: [{
            kind: 'file-range',
            detail: `Proposal overlap detected on '${filePath}' lines [${overlapping.lineStart}-${overlapping.lineEnd}] with active task '${activeIntent.taskId}'.`
          }],
          applyMethod: 'none',
          reason: `Second writer must wait; active writer '${activeIntent.taskId}' should be parked for rearbitration before same-region write.`,
          conflictMatrix,
          admission: finalizeProposalAdmission(baseAdmission, 'blocked-before-write', {
            reason: `Proposal overlap detected on the same bounded region for '${filePath}'; rearbitration is required before any write is admitted.`,
            rearbitrationRequired: true
          })
          })
        };
      }

      if (newRegions.length > 0 && activeRegions.length > 0) {
        return withFailureReason({
          schemaId: 'atm.brokerDecision.v1',
          specVersion: '0.1.0',
          migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
          intentId: `decision-${Date.now()}`,
          taskId: newIntent.taskId,
          verdict: 'needs-physical-split',
          lane: 'deterministic-composer',
          conflicts: [{
            kind: 'file-range',
            detail: `Proposal regions on '${filePath}' are disjoint between '${newIntent.taskId}' and '${activeIntent.taskId}'.`
          }],
          applyMethod: 'patch-apply',
          reason: `Same-file proposal compare succeeded; route '${filePath}' through deterministic-composer before the second writer mutates the working tree.`,
          conflictMatrix,
          admission: finalizeProposalAdmission(baseAdmission, 'composer-routed', {
            reason: `Disjoint bounded proposal regions on '${filePath}' require deterministic-composer routing before write.`,
            rearbitrationRequired: true
          })
        });
      }

      return withFailureReason({
        schemaId: 'atm.brokerDecision.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
        intentId: `decision-${Date.now()}`,
        taskId: newIntent.taskId,
        verdict: 'needs-physical-split',
        lane: 'deterministic-composer',
        conflicts: [{
          kind: 'file-range',
          detail: `Proposal-first same-file rearbitration required on '${filePath}' before writer admission.`
        }],
        applyMethod: 'patch-apply',
        reason: `Active proposal-first writer '${activeIntent.taskId}' should be parked while broker rearbitrates same-file work on '${filePath}'.`,
        conflictMatrix,
        admission: finalizeProposalAdmission(baseAdmission, 'parked-for-rearbitration', {
          reason: `An active proposal-first writer already holds '${filePath}'; park and rearbitrate before granting second-writer authority.`,
          rearbitrationRequired: true
        })
      });
    }
  }

  return null;
}

export function resolveProposalRegionsForFile(intent: WriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[] {
  const fromAdmission = (intent.proposalAdmission?.boundedRegions ?? []).filter((region) => region.filePath === filePath);
  if (fromAdmission.length > 0) {
    return normalizeBoundedRegions(fromAdmission);
  }
  return normalizeBoundedRegions(
    intent.atomRefs
      .filter((ref) => ref.sourceRange?.filePath === filePath)
      .map((ref) => ({
        filePath,
        lineStart: ref.sourceRange!.lineStart,
        lineEnd: ref.sourceRange!.lineEnd
      }))
  );
}

export function resolveActiveProposalRegionsForFile(intent: ActiveWriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[] {
  const fromAdmission = (intent.admission?.boundedRegions ?? []).filter((region) => region.filePath === filePath);
  if (fromAdmission.length > 0) {
    return normalizeBoundedRegions(fromAdmission);
  }
  return normalizeBoundedRegions(
    (intent.resourceKeys.atomRanges ?? [])
      .filter((range) => range.filePath === filePath)
      .map((range) => ({
        filePath,
        lineStart: range.lineStart,
        lineEnd: range.lineEnd
      }))
  );
}

export function findOverlappingProposalRegion(
  left: readonly ProposalAdmissionBoundedRegion[],
  right: readonly ProposalAdmissionBoundedRegion[]
): ProposalAdmissionBoundedRegion | null {
  for (const leftRegion of left) {
    for (const rightRegion of right) {
      if (leftRegion.filePath !== rightRegion.filePath) {
        continue;
      }
      if (leftRegion.lineStart <= rightRegion.lineEnd && rightRegion.lineStart <= leftRegion.lineEnd) {
        return {
          filePath: leftRegion.filePath,
          lineStart: Math.max(leftRegion.lineStart, rightRegion.lineStart),
          lineEnd: Math.min(leftRegion.lineEnd, rightRegion.lineEnd)
        };
      }
    }
  }
  return null;
}

export function shouldRefineProposalScopedCidConflict(
  newIntent: WriteIntent,
  activeIntent: ActiveWriteIntent,
  baseAdmission: ProposalAdmissionEvidence
): boolean {
  if (!baseAdmission.requiresProposal) {
    return false;
  }

  const activeAdmission = activeIntent.admission;
  if (!activeAdmission?.requiresProposal) {
    return false;
  }

  const sharedFiles = collectSharedFiles(newIntent, activeIntent);
  if (sharedFiles.length === 0) {
    return false;
  }

  let sawDisjointComparableRegion = false;
  for (const filePath of sharedFiles) {
    const newRegions = resolveProposalRegionsForFile(newIntent, filePath);
    const activeRegions = resolveActiveProposalRegionsForFile(activeIntent, filePath);
    if (newRegions.length === 0 || activeRegions.length === 0) {
      continue;
    }
    if (findOverlappingProposalRegion(newRegions, activeRegions)) {
      return false;
    }
    sawDisjointComparableRegion = true;
  }

  return sawDisjointComparableRegion;
}
