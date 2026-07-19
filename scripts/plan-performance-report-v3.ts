type Verdict = 'improved' | 'inconclusive' | 'regressed';

type LaneSessionEvent = {
  readonly details?: Record<string, unknown>;
};

type WaveComparison = {
  readonly activeTimeThroughputRatio: number | null;
};

type EffectivenessMethodSummary = {
  readonly sampleCount: number;
  readonly truePositiveCount: number;
  readonly falsePositiveCount: number;
  readonly uniqueBlocks: number;
  readonly evidenceReadbacks: number;
  readonly verdict: Verdict;
  readonly reason: string;
};

export type PlanPerformanceReport = {
  readonly schemaId: 'atm.planPerformanceReport.v1';
  readonly version: 'v3';
  readonly analyzerRole: 'm2';
  readonly matchedCohorts: {
    readonly schemaId: 'atm.matchedCohorts.v1';
    readonly controlCount: number;
    readonly treatmentCount: number;
    readonly pairCount: number;
    readonly verdict: Verdict;
    readonly reason: string;
  };
  readonly brokerDecisionAnalysis: {
    readonly schemaId: 'atm.brokerDecisionAnalysis.v1';
    readonly ticketCount: number;
    readonly correctnessSampleCount: number;
    readonly parallelAdmissionRate: number | null;
    readonly conflictPrecision: number | null;
    readonly conflictRecall: number | null;
    readonly composeAcceptanceRate: number | null;
    readonly composeRollbackCount: number;
    readonly escapedConflictCount: number;
    readonly manualOverrideCount: number;
    readonly decisionLatencyMs: { readonly p50: number | null; readonly p95: number | null };
    readonly waitedMsSaved: { readonly p50: number | null; readonly p95: number | null };
    readonly verdict: Verdict;
    readonly reason: string;
  };
  readonly gateEffectiveness: {
    readonly schemaId: 'atm.gateEffectivenessFourMethods.v1';
    readonly historicalReplay: EffectivenessMethodSummary;
    readonly shadowMode: EffectivenessMethodSummary;
    readonly canonicalParity: EffectivenessMethodSummary;
    readonly matchedBatchAb: EffectivenessMethodSummary;
    readonly retirementProposal: {
      readonly eligibleChecks: readonly string[];
      readonly proposedRetirements: readonly string[];
      readonly verdict: Verdict;
      readonly reason: string;
    };
  };
  readonly telemetrySelfGovernance: {
    readonly schemaId: 'atm.telemetrySelfGovernanceReceipt.v1';
    readonly telemetryDecisionCount: number;
    readonly verdict: Verdict;
    readonly recommendation: string;
    readonly retainedMinimums: readonly string[];
  };
  readonly rolloutVerdict: {
    readonly schemaId: 'atm.rolloutVerdict.v1';
    readonly speed: Verdict;
    readonly cost: Verdict;
    readonly safety: Verdict;
    readonly observability: Verdict;
    readonly overall: Verdict;
    readonly reason: string;
  };
  readonly coverageLimitations: readonly string[];
  readonly dataDrivenDecision: {
    readonly adoptedExistingData: readonly string[];
    readonly missingData: readonly string[];
    readonly changedImplementationStrategy: boolean;
    readonly stopAndDiscussRequired: boolean;
    readonly reason: string;
  };
  readonly nextConfigDigest: string;
};

export function buildPlanPerformanceReport(input: {
  readonly laneEvents: readonly LaneSessionEvent[];
  readonly autoBatchPipeline: { readonly rolloutVerdict: { readonly verdict: string }; readonly evidenceSources: { readonly brokerTickets: number } };
  readonly coverageReport: unknown;
  readonly comparison: WaveComparison;
}): PlanPerformanceReport {
  const tickets = brokerTickets(input.laneEvents);
  const coverageLimitations = coverageLimitationsFrom(input.coverageReport);
  const matchedCohorts = summarizeMatchedCohorts(tickets);
  const brokerDecisionAnalysis = summarizeBrokerDecisions(tickets);
  const gateEffectiveness = summarizeGateEffectiveness(tickets);
  const telemetryDecisionCount = tickets.filter((ticket) => ticket.optimizationApplied === true || typeof ticket.optimizationId === 'string').length;
  const observability: Verdict = coverageLimitations.length === 0 && input.autoBatchPipeline.evidenceSources.brokerTickets > 0 ? 'improved' : 'inconclusive';
  const speed: Verdict = input.autoBatchPipeline.rolloutVerdict.verdict === 'improved' ? 'improved' : 'inconclusive';
  const safety: Verdict = brokerDecisionAnalysis.verdict === 'regressed' ? 'regressed' : gateEffectiveness.matchedBatchAb.verdict;
  const cost: Verdict = input.comparison.activeTimeThroughputRatio !== null && input.comparison.activeTimeThroughputRatio >= 1
    ? 'improved'
    : brokerDecisionAnalysis.waitedMsSaved.p50 !== null && brokerDecisionAnalysis.waitedMsSaved.p50 > 0
      ? 'improved'
      : 'inconclusive';
  const overall = rolloutOverall([speed, cost, safety, observability]);
  const missingData = [
    matchedCohorts.verdict === 'inconclusive' ? 'matched control/treatment cohorts' : null,
    brokerDecisionAnalysis.verdict === 'inconclusive' ? 'broker correctness outcomeRef samples' : null,
    gateEffectiveness.historicalReplay.verdict === 'inconclusive' ? 'historical incident replay samples' : null,
    gateEffectiveness.shadowMode.verdict === 'inconclusive' ? 'shadow false-positive/latency samples' : null,
    gateEffectiveness.canonicalParity.verdict === 'inconclusive' ? 'canonical evaluator parity samples' : null,
    coverageLimitations.length ? 'ready M2 coverage report' : null
  ].filter((entry): entry is string => Boolean(entry));
  return {
    schemaId: 'atm.planPerformanceReport.v1',
    version: 'v3',
    analyzerRole: 'm2',
    matchedCohorts,
    brokerDecisionAnalysis,
    gateEffectiveness,
    telemetrySelfGovernance: telemetrySelfGovernance(telemetryDecisionCount),
    rolloutVerdict: {
      schemaId: 'atm.rolloutVerdict.v1',
      speed,
      cost,
      safety,
      observability,
      overall,
      reason: overall === 'improved' ? 'All rollout dimensions have comparable positive evidence.' : 'At least one rollout dimension lacks comparable evidence or has an inconclusive safety/observability input.'
    },
    coverageLimitations,
    dataDrivenDecision: {
      adoptedExistingData: ['task-event claim/close ledger', 'lane-session brokerTicket details when present', '0195 coverage/M2 preflight report when supplied', 'runtime framework lock snapshot as observability-only evidence'],
      missingData,
      changedImplementationStrategy: missingData.length > 0,
      stopAndDiscussRequired: false,
      reason: missingData.length > 0 ? 'Analyzer emits an explicit inconclusive M2 verdict instead of converting missing data into zero-cost, zero-block, or success claims.' : 'Analyzer has sufficient comparable inputs for a rollout verdict.'
    },
    nextConfigDigest: digestObject({ matchedCohorts, brokerDecisionAnalysis, gateEffectiveness, coverageLimitations })
  };
}

function brokerTickets(events: readonly LaneSessionEvent[]) {
  return events.map((event) => event.details?.brokerTicket).filter((ticket): ticket is Record<string, unknown> => Boolean(ticket && typeof ticket === 'object'));
}

function summarizeMatchedCohorts(tickets: readonly Record<string, unknown>[]): PlanPerformanceReport['matchedCohorts'] {
  const role = (ticket: Record<string, unknown>) => String(ticket.baselineOrTreatmentRole ?? ticket.role ?? '').toLowerCase();
  const controlCount = tickets.filter((ticket) => role(ticket) === 'control').length;
  const treatmentCount = tickets.filter((ticket) => role(ticket) === 'treatment').length;
  const pairCount = Math.min(controlCount, treatmentCount);
  return { schemaId: 'atm.matchedCohorts.v1', controlCount, treatmentCount, pairCount, verdict: pairCount > 0 ? 'improved' : 'inconclusive', reason: pairCount > 0 ? 'At least one comparable control/treatment pair is available.' : 'No matched control/treatment pair is available.' };
}

function summarizeBrokerDecisions(tickets: readonly Record<string, unknown>[]): PlanPerformanceReport['brokerDecisionAnalysis'] {
  const correctness = tickets.filter((ticket) => typeof ticket.decisionCorrect === 'boolean' || typeof ticket.outcomeRef === 'string');
  const conflictsDetected = tickets.filter((ticket) => ticket.conflictDetected === true).length;
  const trueConflicts = tickets.filter((ticket) => ticket.trueConflict === true).length;
  const correctConflicts = tickets.filter((ticket) => ticket.conflictDetected === true && ticket.trueConflict === true).length;
  const composeAttempts = tickets.filter((ticket) => ticket.composeAttempted === true);
  const decisionLatency = numberField(tickets, 'decisionLatencyMs');
  const waitedSaved = tickets.map((ticket) => Number(ticket.waitedMsSaved ?? ticket.waitedMs)).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const escapedConflictCount = tickets.filter((ticket) => ticket.escapedConflict === true).length;
  const correctnessFailures = tickets.filter((ticket) => ticket.decisionCorrect === false).length + escapedConflictCount;
  return {
    schemaId: 'atm.brokerDecisionAnalysis.v1',
    ticketCount: tickets.length,
    correctnessSampleCount: correctness.length,
    parallelAdmissionRate: tickets.length ? tickets.filter((ticket) => ticket.parallelAdmitted === true).length / tickets.length : null,
    conflictPrecision: conflictsDetected ? correctConflicts / conflictsDetected : null,
    conflictRecall: trueConflicts ? correctConflicts / trueConflicts : null,
    composeAcceptanceRate: composeAttempts.length ? composeAttempts.filter((ticket) => ticket.composeAccepted === true).length / composeAttempts.length : null,
    composeRollbackCount: tickets.filter((ticket) => ticket.composeRollback === true).length,
    escapedConflictCount,
    manualOverrideCount: tickets.filter((ticket) => ticket.manualOverride === true).length,
    decisionLatencyMs: { p50: percentile(decisionLatency, 0.5), p95: percentile(decisionLatency, 0.95) },
    waitedMsSaved: { p50: percentile(waitedSaved, 0.5), p95: percentile(waitedSaved, 0.95) },
    verdict: !correctness.length ? 'inconclusive' : correctnessFailures > 0 ? 'regressed' : 'improved',
    reason: !correctness.length ? 'Broker decisions lack correctness outcomeRef/decisionCorrect samples.' : correctnessFailures > 0 ? 'At least one broker decision was incorrect or escaped.' : 'All observed broker correctness samples passed.'
  };
}

function summarizeGateEffectiveness(tickets: readonly Record<string, unknown>[]): PlanPerformanceReport['gateEffectiveness'] {
  const proposedRetirements = [...new Set(tickets.filter((ticket) => Number(ticket.eligible) >= 500 && Number(ticket.uniqueBlocks ?? 0) === 0 && Number(ticket.truePositiveCount ?? 0) === 0 && Number(ticket.evidenceReadbacks ?? 0) === 0 && ticket.escapedIncident !== true).map((ticket) => String(ticket.checkId ?? '')).filter(Boolean))].sort();
  return {
    schemaId: 'atm.gateEffectivenessFourMethods.v1',
    historicalReplay: summarizeEffectiveness(tickets, 'historicalReplay'),
    shadowMode: summarizeEffectiveness(tickets, 'shadowMode'),
    canonicalParity: summarizeEffectiveness(tickets, 'canonicalParity'),
    matchedBatchAb: summarizeEffectiveness(tickets, 'matchedBatchAb'),
    retirementProposal: {
      eligibleChecks: [...new Set(tickets.map((ticket) => String(ticket.checkId ?? '')).filter(Boolean))].sort(),
      proposedRetirements,
      verdict: proposedRetirements.length ? 'improved' : 'inconclusive',
      reason: proposedRetirements.length ? 'At least one check meets frequency-aware zero-effect proposal criteria; owner review is still required.' : 'No check has enough frequency-aware evidence for retirement.'
    }
  };
}

function summarizeEffectiveness(tickets: readonly Record<string, unknown>[], method: string): EffectivenessMethodSummary {
  const samples = tickets.filter((ticket) => String(ticket.validationMethod ?? ticket.method ?? '') === method);
  const truePositiveCount = sumNumbers(samples, 'truePositiveCount') + samples.filter((ticket) => ticket.truePositive === true).length;
  const falsePositiveCount = sumNumbers(samples, 'falsePositiveCount') + samples.filter((ticket) => ticket.falsePositive === true).length;
  const uniqueBlocks = sumNumbers(samples, 'uniqueBlocks');
  const evidenceReadbacks = sumNumbers(samples, 'evidenceReadbacks');
  const failures = samples.filter((ticket) => ticket.parityMismatch === true || ticket.escapedIncident === true).length;
  return {
    sampleCount: samples.length,
    truePositiveCount,
    falsePositiveCount,
    uniqueBlocks,
    evidenceReadbacks,
    verdict: !samples.length ? 'inconclusive' : failures > 0 ? 'regressed' : uniqueBlocks > 0 || truePositiveCount > 0 || evidenceReadbacks > 0 ? 'improved' : 'inconclusive',
    reason: !samples.length ? `No ${method} samples are available.` : failures > 0 ? `${method} found an escaped incident or parity mismatch.` : uniqueBlocks > 0 || truePositiveCount > 0 || evidenceReadbacks > 0 ? `${method} has positive block/readback evidence.` : `${method} samples exist but have not proven unique block, true positive, or evidence readback value.`
  };
}

function coverageLimitationsFrom(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object') return ['coverage report unavailable'];
  const report = value as Record<string, unknown>;
  const verdict = String(report.m2PreflightVerdict ?? report.verdict ?? '').toLowerCase();
  const limitations: string[] = verdict && verdict !== 'ready' ? [`m2PreflightVerdict=${verdict}`] : [];
  const nodes = Array.isArray(report.nodes) ? report.nodes : Array.isArray(report.requiredNodes) ? report.requiredNodes : [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    const status = String(record.status ?? record.coverageStatus ?? '').toLowerCase();
    if (status && !['covered', 'instrumented'].includes(status)) limitations.push(`${String(record.nodeId ?? record.id ?? 'node')}:${status}`);
  }
  return [...new Set(limitations)];
}

function telemetrySelfGovernance(telemetryDecisionCount: number): PlanPerformanceReport['telemetrySelfGovernance'] {
  return {
    schemaId: 'atm.telemetrySelfGovernanceReceipt.v1',
    telemetryDecisionCount,
    verdict: telemetryDecisionCount > 0 ? 'improved' : 'inconclusive',
    recommendation: telemetryDecisionCount > 0 ? 'Telemetry already drove at least one optimization decision; keep current detail until the next cohort seal.' : 'Telemetry has not yet driven a reorder, cache, frequency, merge, or retirement decision; keep meta-health/sealed digest/rollback receipt but consider lower detail or sampling after M2.',
    retainedMinimums: ['meta-health', 'dropped/malformed counters', 'sealed digest', 'retirement/rollback receipt']
  };
}

function rolloutOverall(verdicts: readonly Verdict[]): Verdict {
  return verdicts.includes('regressed') ? 'regressed' : verdicts.every((verdict) => verdict === 'improved') ? 'improved' : 'inconclusive';
}

function numberField(records: readonly Record<string, unknown>[], field: string): number[] {
  return records.map((record) => Number(record[field])).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
}

function sumNumbers(records: readonly Record<string, unknown>[], field: string): number {
  return records.reduce((sum, record) => {
    const value = Number(record[field]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const index = Math.ceil(values.length * p) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))];
}

function digestObject(value: unknown): string {
  const text = JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  return `config-${Math.abs(hash).toString(16)}`;
}

function flattenKeys(value: unknown, output: Record<string, true> = {}): Record<string, true> {
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = true;
    flattenKeys(child, output);
  }
  return output;
}
