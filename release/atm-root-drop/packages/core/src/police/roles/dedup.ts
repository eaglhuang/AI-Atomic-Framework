import {
  createRegistryIndex,
  normalizeSemanticFingerprint,
  semanticFingerprintPrefix
} from '../../registry/registry-index.ts';
import type {
  DedupPoliceInput,
  PoliceFamilyReport,
  PoliceFinding
} from '../types.ts';
import {
  makeEvidenceRef,
  makePoliceFinding,
  makePoliceFamilyReport,
  sanitizeId,
  uniqueNodeRefs,
  toComparableNodeRef,
  isPolymorphIgnored
} from '../shared.ts';

type DedupCandidateRecord = {
  readonly atomId: string;
  readonly similarity: number;
  readonly polymorphGroupId?: string | null;
};

export function runDedupPolice(input: DedupPoliceInput = {}): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];
  const index = input.registryIndex ?? (
    input.registryDocument ? createRegistryIndex(input.registryDocument, { allowDuplicates: true }) : null
  );
  const ignoredAtomIds = new Set(input.polymorphContext?.instanceAtomIds ?? []);
  const ignoredGroupId = input.polymorphContext?.groupId ?? null;
  const seenGroups = new Set<string>();

  if (index) {
    for (const nodeRef of index.nodeRefs) {
      const fingerprint = normalizeSemanticFingerprint(
        nodeRef.entry?.semanticFingerprint ?? nodeRef.entry?.mapSemanticFingerprint ?? null
      );
      if (!fingerprint) {
        continue;
      }
      if (seenGroups.has(fingerprint)) {
        continue;
      }
      seenGroups.add(fingerprint);
      const exactHits = index.findBySemanticFingerprint(fingerprint)
        .map(toComparableNodeRef)
        .filter((candidate) => !isPolymorphIgnored(candidate, ignoredAtomIds, ignoredGroupId));
      const prefixHits = index.findByFingerprintPrefix(semanticFingerprintPrefix(fingerprint))
        .map(toComparableNodeRef)
        .filter((candidate) => !isPolymorphIgnored(candidate, ignoredAtomIds, ignoredGroupId));
      const uniqueHits = uniqueNodeRefs([...exactHits, ...prefixHits]);
      if (uniqueHits.length < 2) {
        continue;
      }
      findings.push(makePoliceFinding({
        findingId: `police.dedup.semantic-fingerprint-overlap.${sanitizeId(semanticFingerprintPrefix(fingerprint))}`,
        policeFamily: 'dedup',
        severity: 'advisory',
        trigger: 'semantic-fingerprint-overlap',
        scope: uniqueHits.map((hit) => hit.canonicalId).join(','),
        action: 'needs-review',
        routeHint: 'behavior.dedup-merge',
        readModel: 'RegistryIndex.semanticFingerprintPrefix',
        message: `Semantic fingerprint overlap detected for ${uniqueHits.map((hit) => hit.canonicalId).join(', ')}.`,
        evidenceRefs: [makeEvidenceRef('fingerprint-snapshot', 'police-artifact')],
        metadata: {
          matchMode: exactHits.length > 1 ? 'exact' : 'prefix',
          candidates: uniqueHits.map((hit) => ({
            canonicalId: hit.canonicalId,
            nodeKind: hit.nodeKind,
            semanticFingerprint: hit.entry?.semanticFingerprint ?? hit.entry?.mapSemanticFingerprint ?? null
          }))
        }
      }));
    }
  }

  const dedupCandidates = Array.isArray(input.qualityComparisonReport?.dedupCandidates)
    ? input.qualityComparisonReport.dedupCandidates as readonly DedupCandidateRecord[]
    : [];
  for (const candidate of dedupCandidates) {
    if (candidate?.polymorphGroupId && candidate.polymorphGroupId === ignoredGroupId) {
      continue;
    }
    if (ignoredAtomIds.has(candidate?.atomId)) {
      continue;
    }
    findings.push(makePoliceFinding({
      findingId: `police.dedup.quality-hint.${sanitizeId(candidate.atomId)}`,
      policeFamily: 'dedup',
      severity: 'advisory',
      trigger: 'quality-dedup-candidate',
      scope: candidate.atomId,
      action: 'needs-review',
      routeHint: 'behavior.dedup-merge',
      readModel: 'qualityComparisonReport.dedupCandidates',
      message: `Quality comparison reported dedup candidate ${candidate.atomId} at similarity ${candidate.similarity}.`,
      evidenceRefs: [makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison')],
      metadata: {
        candidate
      }
    }));
  }

  return makePoliceFamilyReport({
    family: 'dedup',
    mode: 'advisory',
    status: 'pass',
    findings,
    sourceValidator: 'runDedupPolice'
  });
}
