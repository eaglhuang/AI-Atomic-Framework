import {
  curateAtomMapEvolution
} from '../../upgrade/map-curator.ts';
import type {
  MapIntegrationPoliceInput,
  PoliceFamilyReport,
  PoliceFinding
} from '../types.ts';
import {
  makeEvidenceRef,
  makePoliceFinding,
  makePoliceFamilyReport,
  sanitizeId
} from '../shared.ts';

type MapPropagationStatusRecord = {
  readonly mapId: string;
  readonly integrationTestPassed?: boolean;
};

export function runMapIntegrationPolice(input: MapIntegrationPoliceInput = {}): PoliceFamilyReport {
  const report = input.curatorReport ?? (
    input.curatorInput ? curateAtomMapEvolution(input.curatorInput) : null
  );
  const findings: PoliceFinding[] = [];

  for (const draft of report?.proposalDrafts ?? []) {
    const blocked = draft.autoPromoteEligible === false;
    findings.push(makePoliceFinding({
      findingId: `police.map-integration.${sanitizeId(draft.behaviorId)}.${sanitizeId(draft.candidateId)}`,
      policeFamily: 'map-integration',
      severity: blocked ? 'warning' : 'advisory',
      trigger: `map-curator-${draft.signalKind}`,
      scope: draft.targetMapId,
      action: 'proposal-draft',
      routeHint: draft.behaviorId,
      readModel: 'curateAtomMapEvolution.proposalDrafts',
      message: `Map curator produced ${draft.behaviorId} proposal draft ${draft.candidateId}.`,
      evidenceRefs: [
        makeEvidenceRef('map-propagation-log', 'police-artifact'),
        ...draft.sourceEvidenceIds.map((refId) => makeEvidenceRef(refId, 'official-evidence' as const, 'usage-feedback' as const))
      ],
      metadata: {
        autoPromoteEligible: draft.autoPromoteEligible,
        signalKind: draft.signalKind,
        proposalId: draft.proposal?.proposalId ?? null
      }
    }));
  }

  for (const observation of report?.observations ?? []) {
    findings.push(makePoliceFinding({
      findingId: `police.map-integration.observation.${sanitizeId(observation.candidateId)}`,
      policeFamily: 'map-integration',
      severity: 'info',
      trigger: `map-curator-${observation.signalKind}`,
      scope: observation.candidateId,
      action: 'monitor',
      routeHint: 'behavior.compose',
      readModel: 'curateAtomMapEvolution.observations',
      message: `Map curator kept ${observation.candidateId} as observation-only: ${observation.reasons.join(', ')}.`,
      evidenceRefs: [makeEvidenceRef('map-propagation-log', 'police-artifact')],
      metadata: {
        reasons: observation.reasons
      }
    }));
  }

  const mapImpactScope = input.qualityComparisonReport?.mapImpactScope;
  const propagationStatus = mapImpactScope && typeof mapImpactScope === 'object' && !Array.isArray(mapImpactScope) && Array.isArray((mapImpactScope as { propagationStatus?: unknown }).propagationStatus)
    ? (mapImpactScope as { propagationStatus: readonly MapPropagationStatusRecord[] }).propagationStatus
    : [];
  for (const status of propagationStatus) {
    if (status.integrationTestPassed !== false) {
      continue;
    }
    findings.push(makePoliceFinding({
      findingId: `police.map-integration.propagation-risk.${sanitizeId(status.mapId)}`,
      policeFamily: 'map-integration',
      severity: 'warning',
      trigger: 'map-propagation-risk',
      scope: status.mapId,
      action: 'needs-review',
      routeHint: 'behavior.compose',
      readModel: 'qualityComparisonReport.mapImpactScope',
      message: `Map impact scope reports propagation risk for ${status.mapId}.`,
      evidenceRefs: [makeEvidenceRef('map-propagation-log', 'police-artifact')],
      metadata: {
        propagationStatus: status
      }
    }));
  }

  return makePoliceFamilyReport({
    family: 'map-integration',
    mode: 'advisory',
    status: 'pass',
    findings,
    sourceValidator: 'runMapIntegrationPolice'
  });
}
