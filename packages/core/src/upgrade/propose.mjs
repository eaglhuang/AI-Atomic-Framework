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

const INPUT_KIND_PRIORITY = new Map([
  ['hash-diff', 0],
  ['execution-evidence', 1],
  ['non-regression', 2],
  ['quality-comparison', 3],
  ['registry-candidate', 4]
]);

export function proposeAtomicUpgrade(request) {
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

  const target = normalizeTarget(normalizedRequest.target);
  const decompositionDecision = normalizedRequest.decompositionDecision ?? deriveDecompositionDecision({
    behaviorId,
    targetKind: target.kind
  });

  if (decompositionDecision === 'map-bump' && target.kind !== 'map') {
    throw new Error('map-bump proposals require target.kind === "map".');
  }
  if (decompositionDecision !== 'map-bump' && target.kind === 'map' && !target.mapId) {
    throw new Error('map proposals require mapId.');
  }
  if (decompositionDecision === 'atom-extract' && !normalizedRequest.fork) {
    throw new Error('atom-extract proposals require fork information.');
  }
  if (behaviorId === 'behavior.atomize' && decompositionDecision !== 'atom-extract') {
    throw new Error('behavior.atomize proposals must use atom-extract.');
  }

  const inputs = buildInputRefs(normalizedRequest.inputs);
  const nonRegressionInput = requireInput(normalizedRequest.inputs, 'non-regression');
  const qualityComparisonInput = requireInput(normalizedRequest.inputs, 'quality-comparison');
  const registryCandidateInput = requireInput(normalizedRequest.inputs, 'registry-candidate');

  const nonRegressionGate = buildGateResult('nonRegression', nonRegressionInput.document, nonRegressionInput.path, 'baseline fixtures passed');
  const qualityComparisonGate = buildQualityComparisonGate(qualityComparisonInput.document, qualityComparisonInput.path);
  const registryCandidateGate = buildRegistryCandidateGate(registryCandidateInput.document, registryCandidateInput.path);

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

  const allPassed = blockedGateNames.length === 0;
  const status = allPassed ? 'pending' : 'blocked';
  const proposalId = normalizedRequest.proposalId ?? createProposalId(atomId, fromVersion, toVersion, target, behaviorId);
  const mapImpactScope = normalizedRequest.mapImpactScope
    ?? qualityComparisonInput.document.mapImpactScope
    ?? (target.kind === 'map'
      ? {
          affectedMapIds: [target.mapId],
          propagationStatus: []
        }
      : undefined);

  const proposal = {
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
    automatedGates: {
      nonRegression: nonRegressionGate,
      qualityComparison: qualityComparisonGate,
      registryCandidate: registryCandidateGate,
      allPassed,
      blockedGateNames
    },
    humanReview: 'pending',
    status,
    inputs,
    proposedBy: normalizedRequest.proposedBy,
    proposedAt: normalizedRequest.proposedAt
  };

  if (mapImpactScope) {
    proposal.mapImpactScope = mapImpactScope;
  }

  if (decompositionDecision === 'atom-extract') {
    proposal.fork = {
      sourceAtomId: normalizedRequest.fork.sourceAtomId,
      newAtomId: normalizedRequest.fork.newAtomId
    };
  }

  return proposal;
}

function normalizeRequest(request = {}) {
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
    inputs: request.inputs.map(normalizeInputDocument)
  };
}

function normalizeInputDocument(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Upgrade proposal inputs must be objects.');
  }

  const document = input.document ?? input.report ?? input.value ?? null;
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

function inferInputKind(kindOrSchemaId) {
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
    default:
      throw new Error(`Unsupported upgrade proposal input kind: ${kindOrSchemaId}`);
  }
}

function requireInput(inputs, expectedKind) {
  const input = inputs.find((entry) => entry.kind === expectedKind);
  if (!input) {
    throw new Error(`Upgrade proposal requires a ${expectedKind} input document.`);
  }
  return input;
}

function buildInputRefs(inputs) {
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
      const ref = {
        kind: input.kind,
        path: input.path,
        schemaId: input.document.schemaId,
        summary: createInputSummary(input.kind)
      };
      if (typeof input.document.reportId === 'string' && input.document.reportId.length > 0) {
        ref.reportId = input.document.reportId;
      }
      return ref;
    });
}

function buildGateResult(gateName, report, reportPath, successSummary) {
  const passed = report?.passed === true;
  return {
    passed,
    reportId: report?.reportId ?? `${gateName}.missing`,
    reportPath,
    summary: passed ? `pass (${successSummary})` : `blocked (${gateFailureSummary(gateName, report)})`
  };
}

function buildQualityComparisonGate(report, reportPath) {
  const passed = report?.passed === true && report?.regressed !== true;
  const mapPropagationPassed = report?.mapImpactScope?.propagationStatus?.every((entry) => entry.integrationTestPassed !== false) ?? true;
  return {
    passed: passed && mapPropagationPassed,
    reportId: report?.reportId ?? 'quality-comparison.missing',
    reportPath,
    summary: passed && mapPropagationPassed
      ? 'pass (quality metrics improved; map propagation passed)'
      : `blocked (${qualityComparisonFailureReason(report)})`
  };
}

function buildRegistryCandidateGate(report, reportPath) {
  const passed = report?.passed === true && report?.canPromote === true;
  return {
    passed,
    reportId: report?.reportId ?? 'registry-candidate.missing',
    reportPath,
    summary: passed ? 'pass (candidate can promote)' : 'blocked (candidate cannot promote)'
  };
}

function createInputSummary(kind) {
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
    default:
      return 'upgrade-input';
  }
}

function gateFailureSummary(gateName, report) {
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

function qualityComparisonFailureReason(report) {
  if (Array.isArray(report?.regressedMetrics) && report.regressedMetrics.length > 0) {
    return `regressed metrics: ${report.regressedMetrics.join(', ')}`;
  }
  const failedMaps = report?.mapImpactScope?.propagationStatus?.filter((entry) => entry.integrationTestPassed === false) ?? [];
  if (failedMaps.length > 0) {
    return `failed map integrations: ${failedMaps.map((entry) => entry.mapId).join(', ')}`;
  }
  return 'quality metrics failed';
}

function normalizeTarget(target) {
  if (!target || typeof target !== 'object') {
    return { kind: 'atom' };
  }

  const kind = target.kind ?? 'atom';
  if (kind !== 'atom' && kind !== 'map') {
    throw new Error(`Unsupported target.kind: ${kind}`);
  }

  const normalized = { kind };
  if (typeof target.mapId === 'string' && target.mapId.length > 0) {
    normalized.mapId = target.mapId;
  }
  return normalized;
}

function deriveDecompositionDecision({ behaviorId, targetKind }) {
  if (targetKind === 'map') {
    return 'map-bump';
  }
  if (behaviorId === 'behavior.atomize') {
    return 'atom-extract';
  }
  return 'atom-bump';
}

function createProposalId(atomId, fromVersion, toVersion, target, behaviorId) {
  const safeAtomId = String(atomId).toLowerCase();
  const targetSuffix = target.kind === 'map'
    ? `.map-${String(target.mapId ?? 'unknown').toLowerCase()}`
    : '.atom';
  const behaviorSuffix = `.behavior-${behaviorId.replace(/^behavior\./, '')}`;
  return `proposal.${safeAtomId}.from-${fromVersion}.to-${toVersion}${targetSuffix}${behaviorSuffix}`;
}

function normalizeMigration(migration) {
  return {
    strategy: migration?.strategy ?? 'none',
    fromVersion: migration?.fromVersion ?? null,
    notes: migration?.notes ?? 'Initial upgrade proposal contract.'
  };
}