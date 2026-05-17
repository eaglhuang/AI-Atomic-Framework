import { buildMapProposalContext } from './map-propose.ts';
import { validateRollbackProof } from '../registry/rollback-proof.ts';
import { validateRetirementProof } from '../registry/retirement-proof.ts';
import { analyzePolymorphImpact } from '../polymorph/impact.ts';
import { validatePropagationReport } from '../test-runner/propagation.ts';
import {
  deriveDecompositionDecision,
  resolveReviewTemplate,
  validateDecisionBehaviorPair,
  VALID_DECOMPOSITION_DECISIONS
} from './decomposition-decision.ts';

const VALID_BEHAVIOR_IDS = [
  'behavior.evolve',
  'behavior.split',
  'behavior.merge',
  'behavior.dedup-merge',
  'behavior.sweep',
  'behavior.expire',
  'behavior.polymorphize',
  'behavior.compose',
  'behavior.infect',
  'behavior.atomize'
];

const VALID_REPLACEMENT_MODES = ['draft', 'shadow', 'canary', 'active', 'legacy-retired'];

const INPUT_KIND_PRIORITY = new Map([
  ['hash-diff', 0],
  ['execution-evidence', 1],
  ['non-regression', 2],
  ['quality-comparison', 3],
  ['registry-candidate', 4],
  ['map-equivalence', 5],
  ['polymorph-impact', 6],
  ['propagation-report', 7],
  ['review-advisory', 8],
  ['human-review', 9],
  ['rollback-proof', 10],
  ['retirement-proof', 11]
]);

export function proposeAtomicUpgrade(request: any) {
  const normalizedRequest = normalizeRequest(request);
  const hashDiffInput = requireInput(normalizedRequest.inputs, 'hash-diff');
  const hashDiffReport = hashDiffInput.document;

  const fromVersion = normalizedRequest.fromVersion ?? hashDiffReport.fromVersion;
  const toVersion = normalizedRequest.toVersion ?? hashDiffReport.toVersion;
  if (!fromVersion) {
    throw new Error('Upgrade proposal requires fromVersion or a hash-diff report with fromVersion.');
  }
  if (!toVersion) {
    throw new Error('Upgrade proposal requires toVersion or a hash-diff report with toVersion.');
  }

  const atomId = normalizedRequest.atomId ?? hashDiffReport.atomId;
  if (!atomId) {
    throw new Error('Upgrade proposal requires atomId or a hash-diff report with atomId.');
  }
  if (normalizedRequest.atomId && hashDiffReport.atomId && normalizedRequest.atomId !== hashDiffReport.atomId) {
    throw new Error(`Upgrade proposal atomId mismatch: ${normalizedRequest.atomId} !== ${hashDiffReport.atomId}`);
  }
  if (normalizedRequest.fromVersion && hashDiffReport.fromVersion && normalizedRequest.fromVersion !== hashDiffReport.fromVersion) {
    throw new Error(`Upgrade proposal fromVersion mismatch: ${normalizedRequest.fromVersion} !== ${hashDiffReport.fromVersion}`);
  }
  if (normalizedRequest.toVersion && hashDiffReport.toVersion && normalizedRequest.toVersion !== hashDiffReport.toVersion) {
    throw new Error(`Upgrade proposal toVersion mismatch: ${normalizedRequest.toVersion} !== ${hashDiffReport.toVersion}`);
  }

  const behaviorId = normalizedRequest.behaviorId ?? 'behavior.evolve';
  if (!VALID_BEHAVIOR_IDS.includes(behaviorId)) {
    throw new Error(`Unsupported behaviorId: ${behaviorId}`);
  }

  const target: { kind: 'atom' | 'map'; mapId?: string } = normalizeTarget(normalizedRequest.target);
  const requestedReplacementMode = normalizeRequestedReplacementMode(normalizedRequest.requestedReplacementMode, target);
  const decompositionDecision = normalizedRequest.decompositionDecision ?? deriveDecompositionDecision({
    behaviorId,
    targetKind: target.kind
  });

  if (!VALID_DECOMPOSITION_DECISIONS.includes(decompositionDecision)) {
    throw new Error(`Unsupported decompositionDecision: ${decompositionDecision}`);
  }

  if (decompositionDecision === 'map-bump' && target.kind !== 'map') {
    throw new Error('map-bump proposals require target.kind === "map".');
  }
  if (decompositionDecision !== 'map-bump' && target.kind === 'map' && !target.mapId) {
    throw new Error('map proposals require mapId.');
  }
  if (decompositionDecision === 'atom-extract' && !normalizedRequest.fork) {
    throw new Error('atom-extract proposals require fork information.');
  }
  validateDecisionBehaviorPair({ behaviorId, decompositionDecision });

  const mapProposalContext = target.kind === 'map'
    ? buildMapProposalContext({
      repositoryRoot: normalizedRequest.repositoryRoot,
      mapId: target.mapId,
      atomId,
      fromVersion,
      toVersion
    })
    : null;
  const proposalId = normalizedRequest.proposalId ?? createProposalId(atomId, fromVersion, toVersion, target, behaviorId);

  const inputs = buildInputRefs(normalizedRequest.inputs);
  const nonRegressionInput = requireInput(normalizedRequest.inputs, 'non-regression');
  const qualityComparisonInput = requireInput(normalizedRequest.inputs, 'quality-comparison');
  const registryCandidateInput = requireInput(normalizedRequest.inputs, 'registry-candidate');

  const nonRegressionGate = buildGateResult('nonRegression', nonRegressionInput.document, nonRegressionInput.path, 'baseline fixtures passed');
  const qualityComparisonGate = buildQualityComparisonGate(qualityComparisonInput.document, qualityComparisonInput.path);
  const registryCandidateGate = buildRegistryCandidateGate(registryCandidateInput.document, registryCandidateInput.path);
  const mapEquivalenceGate = buildMapEquivalenceGate(target, requestedReplacementMode, findInput(normalizedRequest.inputs, 'map-equivalence'));
  const polymorphImpactGate = buildPolymorphImpactGate(
    target,
    requestedReplacementMode,
    normalizedRequest.repositoryRoot,
    toVersion,
    findInput(normalizedRequest.inputs, 'polymorph-impact')
  );
  const propagationReportGate = buildPropagationReportGate(
    target,
    requestedReplacementMode,
    atomId,
    findInput(normalizedRequest.inputs, 'propagation-report')
  );
  const reviewAdvisoryGate = buildReviewAdvisoryGate(
    target,
    requestedReplacementMode,
    proposalId,
    findInput(normalizedRequest.inputs, 'review-advisory')
  );
  const humanReviewGate = buildHumanReviewGate(
    target,
    requestedReplacementMode,
    proposalId,
    atomId,
    findInput(normalizedRequest.inputs, 'human-review')
  );
  const rollbackProofGate = buildRollbackProofGate(target, requestedReplacementMode, findInput(normalizedRequest.inputs, 'rollback-proof'));
  const retirementProofGate = buildRetirementProofGate(target, requestedReplacementMode, findInput(normalizedRequest.inputs, 'retirement-proof'));
  const legacyRetirementSatisfied = requestedReplacementMode !== 'legacy-retired'
    || target.kind !== 'map'
    || rollbackProofGate?.passed === true
    || retirementProofGate?.passed === true;
  const visibleRollbackProofGate = legacyRetirementSatisfied && rollbackProofGate?.passed !== true ? null : rollbackProofGate;
  const visibleRetirementProofGate = legacyRetirementSatisfied && retirementProofGate?.passed !== true ? null : retirementProofGate;
  const contextBudgetGate = normalizedRequest.contextBudgetGate;

  const blockedGateNames = [];
  if (!nonRegressionGate.passed) {
    blockedGateNames.push('nonRegression');
  }
  if (!qualityComparisonGate.passed) {
    blockedGateNames.push('qualityComparison');
  }
  if (!registryCandidateGate.passed) {
    blockedGateNames.push('registryCandidate');
  }
  if (mapEquivalenceGate && !mapEquivalenceGate.passed) {
    blockedGateNames.push('mapEquivalence');
  }
  if (polymorphImpactGate && !polymorphImpactGate.passed) {
    blockedGateNames.push('polymorphImpact');
  }
  if (propagationReportGate && !propagationReportGate.passed) {
    blockedGateNames.push('propagationReport');
  }
  if (reviewAdvisoryGate && !reviewAdvisoryGate.passed) {
    blockedGateNames.push('reviewAdvisory');
  }
  if (humanReviewGate && !humanReviewGate.passed) {
    blockedGateNames.push('humanReview');
  }
  if (requestedReplacementMode === 'legacy-retired' && target.kind === 'map' && !legacyRetirementSatisfied) {
    if (rollbackProofGate && !rollbackProofGate.passed) {
      blockedGateNames.push('rollbackProof');
    }
    if (retirementProofGate && !retirementProofGate.passed) {
      blockedGateNames.push('retirementProof');
    }
  }
  if (contextBudgetGate && !contextBudgetGate.passed) {
    blockedGateNames.push('contextBudget');
  }

  const allPassed = blockedGateNames.length === 0;
  const status = allPassed ? 'pending' : 'blocked';
  const requiredJustification = buildRequiredJustification({
    requestedReplacementMode,
    mapEquivalenceGate,
    polymorphImpactGate,
    propagationReportGate,
    reviewAdvisoryGate,
    humanReviewGate,
    rollbackProofGate,
    retirementProofGate
  });
  const mapImpactScope = normalizedRequest.mapImpactScope
    ?? qualityComparisonInput.document.mapImpactScope
    ?? (target.kind === 'map'
      ? {
          affectedMapIds: [target.mapId],
          propagationStatus: []
        }
      : undefined);

  const proposal: any = {
    schemaId: 'atm.upgradeProposal',
    specVersion: '0.1.0',
    migration: normalizeMigration(normalizedRequest.migration),
    proposalId,
    atomId,
    fromVersion,
    toVersion,
    lifecycleMode: 'evolution',
    behaviorId,
    target,
    decompositionDecision,
    reviewTemplate: resolveReviewTemplate(decompositionDecision),
    automatedGates: {
      nonRegression: nonRegressionGate,
      qualityComparison: qualityComparisonGate,
      registryCandidate: registryCandidateGate,
      ...(mapEquivalenceGate ? { mapEquivalence: mapEquivalenceGate } : {}),
      ...(polymorphImpactGate ? { polymorphImpact: polymorphImpactGate } : {}),
      ...(propagationReportGate ? { propagationReport: propagationReportGate } : {}),
      ...(reviewAdvisoryGate ? { reviewAdvisory: reviewAdvisoryGate } : {}),
      ...(humanReviewGate ? { humanReview: humanReviewGate } : {}),
      ...(visibleRollbackProofGate ? { rollbackProof: visibleRollbackProofGate } : {}),
      ...(visibleRetirementProofGate ? { retirementProof: visibleRetirementProofGate } : {}),
      ...(contextBudgetGate ? { contextBudget: contextBudgetGate } : {}),
      allPassed,
      blockedGateNames
    },
    humanReview: 'pending',
    status,
    inputs,
    proposedBy: normalizedRequest.proposedBy,
    proposedAt: normalizedRequest.proposedAt
  };

  if (requestedReplacementMode) {
    proposal.requestedReplacementMode = requestedReplacementMode;
  }
  if (requiredJustification) {
    proposal.requiredJustification = requiredJustification;
  }

  if (mapProposalContext) {
    proposal.members = mapProposalContext.members;
    proposal.generatorProvenance = mapProposalContext.generatorProvenance;
  }

  if (mapImpactScope) {
    proposal.mapImpactScope = mapImpactScope;
  }

  if (decompositionDecision === 'atom-extract') {
    proposal.fork = {
      sourceAtomId: normalizedRequest.fork.sourceAtomId,
      newAtomId: normalizedRequest.fork.newAtomId
    };
    proposal.extractPlan = {
      preservedSourceAtom: {
        atomId: normalizedRequest.fork.sourceAtomId,
        retainedAtVersion: fromVersion,
        retentionMode: 'legacy-preserved'
      },
      newAtomSpecStub: {
        atomId: normalizedRequest.fork.newAtomId,
        seededFromAtomId: normalizedRequest.fork.sourceAtomId,
        initialVersion: toVersion,
        lifecycleMode: 'evolution'
      }
    };
  }

  return proposal;
}

function normalizeRequest(request: any = {}) {
  if (!Array.isArray(request.inputs) || request.inputs.length === 0) {
    throw new Error('Upgrade proposal requires at least one input document.');
  }

  return {
    atomId: request.atomId ?? null,
    fromVersion: request.fromVersion ?? null,
    toVersion: request.toVersion ?? null,
    behaviorId: request.behaviorId ?? null,
    decompositionDecision: request.decompositionDecision ?? null,
    target: request.target ?? { kind: 'atom' },
    fork: request.fork ?? null,
    mapImpactScope: request.mapImpactScope ?? null,
    proposedBy: request.proposedBy ?? 'ATM CLI',
    proposedAt: request.proposedAt ?? new Date().toISOString(),
    proposalId: request.proposalId ?? null,
    migration: request.migration ?? null,
    requestedReplacementMode: request.requestedReplacementMode ?? null,
    repositoryRoot: request.repositoryRoot ?? process.cwd(),
    contextBudgetGate: normalizeGateResult(request.contextBudgetGate ?? null, 'contextBudget'),
    inputs: request.inputs.map(normalizeInputDocument)
  };
}

function normalizeInputDocument(input: any) {
  if (!input || typeof input !== 'object') {
    throw new Error('Upgrade proposal inputs must be objects.');
  }

  const document = unwrapKnownInputDocument(input.document ?? input.report ?? input.value ?? null);
  if (!document || typeof document !== 'object') {
    throw new Error('Upgrade proposal inputs require a document payload.');
  }

  const inferredKind = inferInputKind(input.kind ?? document.schemaId);
  const path = input.path ?? input.reportPath ?? input.evidencePath ?? null;
  if (!path) {
    throw new Error(`Upgrade proposal input ${inferredKind} requires a path.`);
  }

  return {
    kind: inferredKind,
    path,
    document
  };
}

function inferInputKind(kindOrSchemaId: any) {
  switch (kindOrSchemaId) {
    case 'hash-diff':
    case 'atm.hashDiffReport':
      return 'hash-diff';
    case 'execution-evidence':
    case 'atm.executionEvidence':
      return 'execution-evidence';
    case 'non-regression':
    case 'atm.police.nonRegressionReport':
      return 'non-regression';
    case 'quality-comparison':
    case 'atm.police.qualityComparisonReport':
      return 'quality-comparison';
    case 'registry-candidate':
    case 'atm.police.registryCandidateReport':
      return 'registry-candidate';
    case 'map-equivalence':
    case 'atm.mapEquivalenceReport':
      return 'map-equivalence';
    case 'polymorph-impact':
    case 'atm.polymorphImpactReport':
      return 'polymorph-impact';
    case 'propagation-report':
    case 'atm.propagationReport':
      return 'propagation-report';
    case 'review-advisory':
    case 'atm.reviewAdvisoryReport':
      return 'review-advisory';
    case 'human-review':
    case 'atm.humanReviewDecision':
      return 'human-review';
    case 'rollback-proof':
    case 'atm.rollbackProof':
    case 'atm.evidence.rollbackProof':
      return 'rollback-proof';
    case 'retirement-proof':
    case 'atm.retirementProof':
      return 'retirement-proof';
    default:
      throw new Error(`Unsupported upgrade proposal input kind: ${kindOrSchemaId}`);
  }
}

function findInput(inputs: any, expectedKind: any) {
  return inputs.find((entry: any) => entry.kind === expectedKind) ?? null;
}

function requireInput(inputs: any, expectedKind: any) {
  const input = findInput(inputs, expectedKind);
  if (!input) {
    throw new Error(`Upgrade proposal requires a ${expectedKind} input document.`);
  }
  return input;
}

function buildInputRefs(inputs: any) {
  return [...inputs]
    .sort((left, right) => {
      const leftPriority = INPUT_KIND_PRIORITY.get(left.kind) ?? 99;
      const rightPriority = INPUT_KIND_PRIORITY.get(right.kind) ?? 99;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.path.localeCompare(right.path);
    })
    .map((input) => {
      const ref: any = {
        kind: input.kind,
        path: input.path,
          schemaId: resolveInputSchemaId(input.kind, input.document),
        summary: createInputSummary(input.kind)
      };
      if (typeof input.document.reportId === 'string' && input.document.reportId.length > 0) {
        ref.reportId = input.document.reportId;
        } else if (typeof input.document.proofId === 'string' && input.document.proofId.length > 0) {
          ref.reportId = input.document.proofId;
        } else if (typeof input.document.evidenceId === 'string' && input.document.evidenceId.length > 0) {
          ref.reportId = input.document.evidenceId;
      }
      return ref;
    });
}

function buildGateResult(gateName: any, report: any, reportPath: any, successSummary: any) {
  const passed = report?.passed === true;
  return {
    passed,
    reportId: report?.reportId ?? `${gateName}.missing`,
    reportPath,
    summary: passed ? `pass (${successSummary})` : `blocked (${gateFailureSummary(gateName, report)})`
  };
}

function buildQualityComparisonGate(report: any, reportPath: any) {
  const passed = report?.passed === true && report?.regressed !== true;
  const mapPropagationPassed = report?.mapImpactScope?.propagationStatus?.every((entry: any) => entry.integrationTestPassed !== false) ?? true;
  return {
    passed: passed && mapPropagationPassed,
    reportId: report?.reportId ?? 'quality-comparison.missing',
    reportPath,
    summary: passed && mapPropagationPassed
      ? 'pass (quality metrics improved; map propagation passed)'
      : `blocked (${qualityComparisonFailureReason(report)})`
  };
}

function buildRegistryCandidateGate(report: any, reportPath: any) {
  const passed = report?.passed === true && report?.canPromote === true;
  return {
    passed,
    reportId: report?.reportId ?? 'registry-candidate.missing',
    reportPath,
    summary: passed ? 'pass (candidate can promote)' : 'blocked (candidate cannot promote)'
  };
}

function buildMapEquivalenceGate(target: any, requestedReplacementMode: any, input: any) {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'map-equivalence.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement requires a passing map equivalence report)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.mapEquivalenceReport';
  const mapMatches = input.document?.mapId === target.mapId;
  const passed = schemaValid && mapMatches && input.document?.passed === true;
  const reason = !schemaValid
    ? 'report schemaId must be atm.mapEquivalenceReport'
    : !mapMatches
      ? `report mapId ${String(input.document?.mapId ?? 'unknown')} does not match ${target.mapId}`
      : 'map equivalence report did not pass';

  return {
    passed,
    reportId: input.document?.reportId ?? 'map-equivalence.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (map equivalence passed for active replacement)'
      : `blocked (${reason})`
  };
}

function buildPolymorphImpactGate(target: any, requestedReplacementMode: any, repositoryRoot: any, toVersion: any, input: any) {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }

  const analysis = analyzePolymorphImpact({
    repositoryRoot,
    mapId: target.mapId,
    toVersion
  });
  if (!analysis.reportRequired) {
    return null;
  }

  if (!input) {
    return {
      passed: false,
      reportId: 'polymorph-impact.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement with polymorph template members requires a passing polymorph impact report)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.polymorphImpactReport';
  const mapMatches = input.document?.targetMapId === target.mapId;
  const versionMatches = input.document?.toVersion === analysis.toVersion;
  const templateSetMatches = sameStringSet(
    (Array.isArray(input.document?.templateHits) ? input.document.templateHits : []).map((entry: any) => String(entry?.templateId ?? '').trim()).filter(Boolean),
    analysis.templateHits.map((entry: any) => entry.templateId)
  );
  const impactedSetMatches = sameStringSet(input.document?.impactedMapIds, analysis.impactedMapIds);
  const passed = schemaValid
    && mapMatches
    && versionMatches
    && templateSetMatches
    && impactedSetMatches
    && input.document?.passed === true;
  const reason = !schemaValid
    ? 'report schemaId must be atm.polymorphImpactReport'
    : !mapMatches
      ? `report targetMapId ${String(input.document?.targetMapId ?? 'unknown')} does not match ${target.mapId}`
      : !versionMatches
        ? `report toVersion ${String(input.document?.toVersion ?? 'unknown')} does not match ${analysis.toVersion}`
        : !templateSetMatches
          ? 'report templateHits do not match the current polymorph scan'
          : !impactedSetMatches
            ? 'report impactedMapIds do not match the current polymorph scan'
            : 'polymorph impact report did not pass';

  return {
    passed,
    reportId: input.document?.reportId ?? 'polymorph-impact.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (polymorph impact verified for active replacement)'
      : `blocked (${reason})`
  };
}

function buildRollbackProofGate(target: any, requestedReplacementMode: any, input: any) {
  if (target.kind !== 'map' || requestedReplacementMode !== 'legacy-retired') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'rollback-proof.missing',
      reportPath: '[missing]',
      summary: 'blocked (legacy-retired replacement requires a passing rollback proof)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.rollbackProof';
  const targetKindValid = input.document?.targetKind === 'map';
  const mapMatches = input.document?.mapId === target.mapId;
  const validation = schemaValid && targetKindValid && mapMatches
    ? safeValidateRollbackProof(input.document)
    : { ok: false, issues: [] };
  const passed = schemaValid
    && targetKindValid
    && mapMatches
    && input.document?.verificationStatus === 'passed'
    && validation.ok;
  const reason = !schemaValid
    ? 'report schemaId must be atm.rollbackProof'
    : !targetKindValid
      ? 'rollback proof targetKind must be map'
      : !mapMatches
        ? `rollback proof mapId ${String(input.document?.mapId ?? 'unknown')} does not match ${target.mapId}`
        : input.document?.verificationStatus !== 'passed'
          ? 'rollback proof verificationStatus must be passed'
          : validation.issues.join(', ') || 'rollback proof validation failed';

  return {
    passed,
    reportId: input.document?.proofId ?? 'rollback-proof.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (rollback proof verified for legacy-retired replacement)'
      : `blocked (${reason})`
  };
}

function buildPropagationReportGate(target: any, requestedReplacementMode: any, atomId: any, input: any) {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'propagation-report.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement requires a passing propagation report)'
    };
  }

  const validation = safeValidatePropagationReport(input.document, {
    atomId,
    mapId: target.mapId
  });
  const passed = validation.ok;
  return {
    passed,
    reportId: input.document?.reportId ?? 'propagation-report.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (propagation report verified downstream map coverage for active replacement)'
      : `blocked (${validation.issues.join(', ') || 'propagation report validation failed'})`
  };
}

function buildReviewAdvisoryGate(target: any, requestedReplacementMode: any, proposalId: any, input: any) {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'review-advisory.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement requires a review advisory report)'
    };
  }

  const advisoryTargetId = typeof input.document?.target?.id === 'string' ? input.document.target.id : null;
  const status = String(input.document?.status ?? '').trim();
  const targetMatches = advisoryTargetId == null || advisoryTargetId === proposalId || advisoryTargetId === target.mapId;
  const passed = targetMatches
    && input.document?.advisoryUnavailable !== true
    && (status === 'ok' || status === 'warn');
  const reason = !targetMatches
    ? `review advisory target ${String(advisoryTargetId ?? 'unknown')} does not match proposal ${proposalId}`
    : input.document?.advisoryUnavailable === true || status === 'advisory-unavailable'
      ? 'review advisory is unavailable'
      : 'review advisory status must be ok or warn';

  return {
    passed,
    reportId: input.document?.reportId ?? 'review-advisory.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (review advisory completed for active replacement)'
      : `blocked (${reason})`
  };
}

function buildHumanReviewGate(target: any, requestedReplacementMode: any, proposalId: any, atomId: any, input: any) {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'human-review.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement requires an approved human review decision)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.humanReviewDecision';
  const proposalMatches = input.document?.proposalId === proposalId || input.document?.queueRecord?.proposalId === proposalId;
  const atomMatches = input.document?.atomId === atomId || input.document?.queueRecord?.atomId === atomId;
  const reviewedMapId = input.document?.queueRecord?.proposal?.target?.mapId ?? input.document?.proposal?.target?.mapId ?? null;
  const mapMatches = reviewedMapId == null || reviewedMapId === target.mapId;
  const decisionApproved = input.document?.decision === 'approve';
  const queueApproved = input.document?.queueRecord?.status === 'approved';
  const passed = schemaValid && proposalMatches && atomMatches && mapMatches && decisionApproved && queueApproved;
  const reason = !schemaValid
    ? 'human review decision schemaId must be atm.humanReviewDecision'
    : !proposalMatches
      ? `human review proposalId ${String(input.document?.proposalId ?? input.document?.queueRecord?.proposalId ?? 'unknown')} does not match ${proposalId}`
      : !atomMatches
        ? `human review atomId ${String(input.document?.atomId ?? input.document?.queueRecord?.atomId ?? 'unknown')} does not match ${atomId}`
        : !mapMatches
          ? `human review target map ${String(reviewedMapId ?? 'unknown')} does not match ${target.mapId}`
          : !decisionApproved || !queueApproved
            ? 'human review decision must be approve with queueRecord.status approved'
            : 'human review validation failed';

  return {
    passed,
    reportId: input.document?.evidenceId ?? input.document?.proposalId ?? 'human-review.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (human review approved active replacement)'
      : `blocked (${reason})`
  };
}

function buildRetirementProofGate(target: any, requestedReplacementMode: any, input: any) {
  if (target.kind !== 'map' || requestedReplacementMode !== 'legacy-retired') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'retirement-proof.missing',
      reportPath: '[missing]',
      summary: 'blocked (legacy-retired replacement requires a passing retirement proof)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.retirementProof';
  const mapMatches = input.document?.mapId === target.mapId;
  const validation = schemaValid && mapMatches
    ? safeValidateRetirementProof(input.document)
    : { ok: false, issues: [] };
  const passed = schemaValid
    && mapMatches
    && input.document?.verificationStatus === 'passed'
    && validation.ok;
  const reason = !schemaValid
    ? 'retirement proof schemaId must be atm.retirementProof'
    : !mapMatches
      ? `retirement proof mapId ${String(input.document?.mapId ?? 'unknown')} does not match ${target.mapId}`
      : input.document?.verificationStatus !== 'passed'
        ? 'retirement proof verificationStatus must be passed'
        : validation.issues.join(', ') || 'retirement proof validation failed';

  return {
    passed,
    reportId: input.document?.proofId ?? 'retirement-proof.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (retirement proof cleared caller and entrypoint risk for legacy-retired replacement)'
      : `blocked (${reason})`
  };
}

function normalizeGateResult(gate: any, gateName: any) {
  if (gate == null) {
    return null;
  }
  if (!gate || typeof gate !== 'object') {
    throw new Error(`Upgrade proposal ${gateName} gate must be an object.`);
  }
  if (typeof gate.passed !== 'boolean') {
    throw new Error(`Upgrade proposal ${gateName} gate requires a boolean passed field.`);
  }
  if (typeof gate.reportPath !== 'string' || gate.reportPath.length === 0) {
    throw new Error(`Upgrade proposal ${gateName} gate requires a reportPath.`);
  }
  if (typeof gate.summary !== 'string' || gate.summary.length === 0) {
    throw new Error(`Upgrade proposal ${gateName} gate requires a summary.`);
  }
  return {
    passed: gate.passed,
    reportId: typeof gate.reportId === 'string' && gate.reportId.length > 0 ? gate.reportId : `${gateName}.provided`,
    reportPath: gate.reportPath,
    summary: gate.summary
  };
}

function resolveInputSchemaId(kind: any, document: any) {
  if (typeof document?.schemaId === 'string' && document.schemaId.length > 0) {
    return document.schemaId;
  }
  if (kind === 'review-advisory') {
    return 'atm.reviewAdvisoryReport';
  }
  return String(kind);
}

function createInputSummary(kind: any) {
  switch (kind) {
    case 'hash-diff':
      return 'hash-diff input';
    case 'execution-evidence':
      return 'execution-evidence input';
    case 'non-regression':
      return 'non-regression input';
    case 'quality-comparison':
      return 'quality-comparison input';
    case 'registry-candidate':
      return 'registry-candidate input';
    case 'map-equivalence':
      return 'map-equivalence input';
    case 'polymorph-impact':
      return 'polymorph-impact input';
    case 'propagation-report':
      return 'propagation-report input';
    case 'review-advisory':
      return 'review-advisory input';
    case 'human-review':
      return 'human-review input';
    case 'rollback-proof':
      return 'rollback-proof input';
    case 'retirement-proof':
      return 'retirement-proof input';
    default:
      return 'upgrade-input';
  }
}

function gateFailureSummary(gateName: any, report: any) {
  switch (gateName) {
    case 'nonRegression':
      return 'baseline fixtures failed';
    case 'qualityComparison':
      return qualityComparisonFailureReason(report);
    case 'registryCandidate':
      return 'candidate cannot promote';
    default:
      return 'gate failed';
  }
}

function qualityComparisonFailureReason(report: any) {
  if (Array.isArray(report?.regressedMetrics) && report.regressedMetrics.length > 0) {
    return `regressed metrics: ${report.regressedMetrics.join(', ')}`;
  }
  const failedMaps = report?.mapImpactScope?.propagationStatus?.filter((entry: any) => entry.integrationTestPassed === false) ?? [];
  if (failedMaps.length > 0) {
    return `failed map integrations: ${failedMaps.map((entry: any) => entry.mapId).join(', ')}`;
  }
  return 'quality metrics failed';
}

function normalizeTarget(target: any) {
  if (!target || typeof target !== 'object') {
    return { kind: 'atom' as const };
  }

  const kind = target.kind ?? 'atom';
  if (kind !== 'atom' && kind !== 'map') {
    throw new Error(`Unsupported target.kind: ${kind}`);
  }

  const normalized: { kind: 'atom' | 'map'; mapId?: string } = { kind };
  if (typeof target.mapId === 'string' && target.mapId.length > 0) {
    normalized.mapId = target.mapId;
  }
  return normalized;
}

function normalizeRequestedReplacementMode(value: any, target: any) {
  if (value == null) {
    return null;
  }

  const mode = String(value).trim();
  if (!VALID_REPLACEMENT_MODES.includes(mode)) {
    throw new Error(`Unsupported requestedReplacementMode: ${mode}`);
  }
  if (target.kind !== 'map') {
    throw new Error('requestedReplacementMode requires target.kind === "map".');
  }
  return mode;
}

function buildRequiredJustification({
  requestedReplacementMode,
  mapEquivalenceGate,
  polymorphImpactGate,
  propagationReportGate,
  reviewAdvisoryGate,
  humanReviewGate,
  rollbackProofGate,
  retirementProofGate
}: any) {
  if (requestedReplacementMode === 'active') {
    const requiredGateNames = [];
    const requiredEvidenceKinds = [];
    const requiredCliOptions = [];
    if (mapEquivalenceGate && !mapEquivalenceGate.passed) {
      requiredGateNames.push('mapEquivalence');
      requiredEvidenceKinds.push('map-equivalence');
      requiredCliOptions.push('--equivalence-report');
    }
    if (polymorphImpactGate && !polymorphImpactGate.passed) {
      requiredGateNames.push('polymorphImpact');
      requiredEvidenceKinds.push('polymorph-impact');
      requiredCliOptions.push('--polymorph-impact-report');
    }
    if (propagationReportGate && !propagationReportGate.passed) {
      requiredGateNames.push('propagationReport');
      requiredEvidenceKinds.push('propagation-report');
      requiredCliOptions.push('--propagation-report');
    }
    if (reviewAdvisoryGate && !reviewAdvisoryGate.passed) {
      requiredGateNames.push('reviewAdvisory');
      requiredEvidenceKinds.push('review-advisory');
      requiredCliOptions.push('--review-advisory');
    }
    if (humanReviewGate && !humanReviewGate.passed) {
      requiredGateNames.push('humanReview');
      requiredEvidenceKinds.push('human-review');
      requiredCliOptions.push('--human-review');
    }
    if (requiredGateNames.length > 0) {
      return {
        requestedReplacementMode,
        requiredGateNames,
        requiredEvidenceKinds,
        requiredCliOptions,
        humanReviewRequired: true,
        rationale: buildActiveReplacementRationale(requiredGateNames)
      };
    }
  }
  if (requestedReplacementMode === 'legacy-retired' && rollbackProofGate && retirementProofGate
    && !rollbackProofGate.passed && !retirementProofGate.passed) {
    return {
      requestedReplacementMode,
      requiredGateNames: ['rollbackProof', 'retirementProof'],
      requiredEvidenceKinds: ['rollback-proof', 'retirement-proof'],
      requiredCliOptions: ['--rollback-proof', '--retirement-proof'],
      humanReviewRequired: true,
      rationale: 'Map promotion to legacy-retired requires a passing rollback proof or retirement proof, and retirement proof must clear caller and entrypoint risk.'
    };
  }
  return null;
}

function createProposalId(atomId: any, fromVersion: any, toVersion: any, target: any, behaviorId: any) {
  const safeAtomId = String(atomId).toLowerCase();
  const targetSuffix = target.kind === 'map'
    ? `.map-${String(target.mapId ?? 'unknown').toLowerCase()}`
    : '.atom';
  const behaviorSuffix = `.behavior-${behaviorId.replace(/^behavior\./, '')}`;
  return `proposal.${safeAtomId}.from-${fromVersion}.to-${toVersion}${targetSuffix}${behaviorSuffix}`;
}

function normalizeMigration(migration: any) {
  return {
    strategy: migration?.strategy ?? 'none',
    fromVersion: migration?.fromVersion ?? null,
    notes: migration?.notes ?? 'Initial upgrade proposal contract.'
  };
}

function safeValidateRollbackProof(document: any) {
  try {
    return validateRollbackProof(document);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidateRetirementProof(document: any) {
  try {
    return validateRetirementProof(document);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidatePropagationReport(document: any, options: any) {
  try {
    return validatePropagationReport(document, options);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function buildActiveReplacementRationale(requiredGateNames: readonly string[]) {
  if (requiredGateNames.length === 1 && requiredGateNames[0] === 'mapEquivalence') {
    return 'Map promotion to active requires a passing map equivalence report before review can proceed.';
  }
  if (requiredGateNames.length === 1 && requiredGateNames[0] === 'polymorphImpact') {
    return 'Map promotion to active requires a passing polymorph impact report when member atoms participate in template propagation.';
  }
  if (requiredGateNames.length === 1 && requiredGateNames[0] === 'propagationReport') {
    return 'Map promotion to active requires a passing propagation report that proves downstream maps remain healthy.';
  }
  if (requiredGateNames.length === 1 && requiredGateNames[0] === 'reviewAdvisory') {
    return 'Map promotion to active requires a review advisory report before human approval can proceed.';
  }
  if (requiredGateNames.length === 1 && requiredGateNames[0] === 'humanReview') {
    return 'Map promotion to active requires an approved human review decision before review can proceed.';
  }
  return 'Map promotion to active requires all replacement evidence gates to pass before review can proceed.';
}

function unwrapKnownInputDocument(document: any) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return document;
  }
  if (document.expectedReport && !document.schemaId) {
    return document.expectedReport;
  }
  if (document.evidence?.propagationReport && !document.schemaId) {
    return document.evidence.propagationReport;
  }
  if (document.evidence?.report && !document.schemaId) {
    return document.evidence.report;
  }
  if (document.evidence?.decisionLog && !document.schemaId) {
    return document.evidence.decisionLog;
  }
  return document;
}

function sameStringSet(left: any, right: any) {
  const leftValues = normalizeStringSet(left);
  const rightValues = normalizeStringSet(right);
  if (leftValues.length !== rightValues.length) {
    return false;
  }
  return leftValues.every((value, index) => value === rightValues[index]);
}

function normalizeStringSet(values: any) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))].sort();
}
