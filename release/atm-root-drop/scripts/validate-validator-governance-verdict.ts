import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type StrategyId = 'legacy' | 'causal';

interface ReplayObservation {
  readonly selectedCaseIds: readonly string[];
  readonly latencyMs: number;
  readonly cacheHit: boolean;
  readonly phaseDetected: boolean;
  readonly falseBlock: boolean;
  readonly flaky: boolean;
  readonly defectDetected: boolean;
  readonly failClosed?: boolean;
}

interface ReplayCandidate {
  readonly id: string;
  readonly defectPresent: boolean;
  readonly legacy: ReplayObservation;
  readonly causal: ReplayObservation;
}

interface ReplayFixture {
  readonly schemaId: 'atm.validatorGovernanceReplayFixture.v1';
  readonly environmentSeal: Record<string, unknown>;
  readonly candidates: readonly ReplayCandidate[];
  readonly counterexamples: readonly {
    readonly id: string;
    readonly acceptedByVerdict: boolean;
    readonly rejectionCode: string;
  }[];
  readonly adapterConformance: readonly {
    readonly adapter: string;
    readonly projection: string;
    readonly status: string;
  }[];
}

interface StrategyMetrics {
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
  readonly selectedRatio: number;
  readonly cacheReuseRatio: number;
  readonly phaseDetectionRatio: number;
  readonly falseBlocks: number;
  readonly flakyCases: number;
  readonly detectedDefects: number;
  readonly escapedDefects: number;
}

interface ValidatorGovernanceVerdict {
  readonly schemaId: 'atm.validatorGovernanceVerdict.v1';
  readonly specVersion: '0.1.0';
  readonly fixturePath: string;
  readonly environmentSeal: Record<string, unknown>;
  readonly legacy: StrategyMetrics;
  readonly causal: StrategyMetrics;
  readonly deltas: Record<string, number>;
  readonly counterexamples: readonly {
    readonly id: string;
    readonly acceptedByVerdict: boolean;
    readonly rejectionCode: string;
  }[];
  readonly adapterConformance: ReplayFixture['adapterConformance'];
  readonly verdict: {
    readonly status: 'pass' | 'fail';
    readonly summary: string;
    readonly migrationRecommendation: string;
  };
}

const fixturePath = 'tests/fixtures/validator-governance-replay/historical-ab-candidates.json';
const artifactPath = 'artifacts/generated/atm-validator-governance-verdict.json';
const guidePath = 'docs/governance/validator-governance.md';

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function metricsFor(candidates: readonly ReplayCandidate[], strategy: StrategyId): StrategyMetrics {
  const observations = candidates.map((candidate) => candidate[strategy]);
  const totalSelected = observations.reduce((sum, entry) => sum + entry.selectedCaseIds.length, 0);
  const legacySelected = candidates.reduce((sum, candidate) => sum + candidate.legacy.selectedCaseIds.length, 0);
  const defectCandidates = candidates.filter((candidate) => candidate.defectPresent);
  return {
    latencyP50Ms: percentile(observations.map((entry) => entry.latencyMs), 50),
    latencyP95Ms: percentile(observations.map((entry) => entry.latencyMs), 95),
    selectedRatio: round4(totalSelected / Math.max(1, legacySelected)),
    cacheReuseRatio: round4(observations.filter((entry) => entry.cacheHit).length / Math.max(1, observations.length)),
    phaseDetectionRatio: round4(observations.filter((entry) => entry.phaseDetected).length / Math.max(1, observations.length)),
    falseBlocks: observations.filter((entry) => entry.falseBlock).length,
    flakyCases: observations.filter((entry) => entry.flaky).length,
    detectedDefects: defectCandidates.filter((candidate) => candidate[strategy].defectDetected).length,
    escapedDefects: defectCandidates.filter((candidate) => !candidate[strategy].defectDetected).length
  };
}

export function buildValidatorGovernanceVerdict(fixture: ReplayFixture): ValidatorGovernanceVerdict {
  const legacy = metricsFor(fixture.candidates, 'legacy');
  const causal = metricsFor(fixture.candidates, 'causal');
  const escapedDefectDelta = causal.escapedDefects - legacy.escapedDefects;
  const counterexamplesRejected = fixture.counterexamples.every((entry) => entry.acceptedByVerdict === false && entry.rejectionCode.startsWith('ATM_VALIDATOR_GOVERNANCE_'));
  const adaptersPass = fixture.adapterConformance.every((entry) => entry.status === 'pass');
  const causalImprovesRuntime = causal.latencyP50Ms < legacy.latencyP50Ms && causal.latencyP95Ms < legacy.latencyP95Ms;
  const status = counterexamplesRejected && adaptersPass && causalImprovesRuntime && escapedDefectDelta <= 0 ? 'pass' : 'fail';
  return {
    schemaId: 'atm.validatorGovernanceVerdict.v1',
    specVersion: '0.1.0',
    fixturePath,
    environmentSeal: fixture.environmentSeal,
    legacy,
    causal,
    deltas: {
      latencyP50ImprovementRatio: round4((legacy.latencyP50Ms - causal.latencyP50Ms) / Math.max(1, legacy.latencyP50Ms)),
      latencyP95ImprovementRatio: round4((legacy.latencyP95Ms - causal.latencyP95Ms) / Math.max(1, legacy.latencyP95Ms)),
      selectedRatioDelta: round4(causal.selectedRatio - legacy.selectedRatio),
      cacheReuseRatioDelta: round4(causal.cacheReuseRatio - legacy.cacheReuseRatio),
      phaseDetectionRatioDelta: round4(causal.phaseDetectionRatio - legacy.phaseDetectionRatio),
      falseBlockDelta: causal.falseBlocks - legacy.falseBlocks,
      flakyCaseDelta: causal.flakyCases - legacy.flakyCases,
      escapedDefectDelta
    },
    counterexamples: fixture.counterexamples.map((entry) => ({
      id: entry.id,
      acceptedByVerdict: entry.acceptedByVerdict,
      rejectionCode: entry.rejectionCode
    })),
    adapterConformance: fixture.adapterConformance,
    verdict: {
      status,
      summary: status === 'pass'
        ? 'Causal validator selection improves latency and selection cost without increasing escaped defects; stale receipts and zero-test false greens are rejected.'
        : 'Causal validator selection is not promotable because a safety or migration gate failed.',
      migrationRecommendation: status === 'pass'
        ? 'promote-causal-selector-through-shadow-canary'
        : 'retain-legacy-all-run-default'
    }
  };
}

function validateGuide(verdict: ValidatorGovernanceVerdict): void {
  const guide = readFileSync(guidePath, 'utf8');
  for (const required of ['Shadow mode', 'Canary promotion', 'Full rollback', 'Plan 3.1 final-verdict consumption']) {
    assert(guide.includes(required), `migration guide missing section: ${required}`);
  }
  assert(guide.includes(verdict.verdict.migrationRecommendation), 'guide must reference the computed migration recommendation');
}

const fixture = readJson<ReplayFixture>(fixturePath);
assert.equal(fixture.schemaId, 'atm.validatorGovernanceReplayFixture.v1');
const computed = buildValidatorGovernanceVerdict(fixture);
const recorded = readJson<ValidatorGovernanceVerdict>(artifactPath);
assert.deepEqual(recorded, computed, 'recorded verdict artifact must match the replay computation');
assert.equal(recorded.verdict.status, 'pass', 'runtime improvement cannot pass if defect detection regresses or counterexamples are accepted');
assert(recorded.deltas.escapedDefectDelta <= 0, 'escaped defects must not regress');
assert(recorded.counterexamples.every((entry) => entry.acceptedByVerdict === false), 'counterexamples must be rejected');
assert(recorded.adapterConformance.length >= 6, 'all supported adapter projections must be represented');
assert(recorded.adapterConformance.every((entry) => entry.status === 'pass'), 'all adapter projections must pass conformance');
validateGuide(recorded);

console.log(JSON.stringify({
  marker: '[validator-governance-verdict] ok',
  schemaId: recorded.schemaId,
  status: recorded.verdict.status,
  latencyP50ImprovementRatio: recorded.deltas.latencyP50ImprovementRatio,
  escapedDefectDelta: recorded.deltas.escapedDefectDelta,
  rejectedCounterexamples: recorded.counterexamples.map((entry) => entry.id),
  adapterCount: recorded.adapterConformance.length
}));
