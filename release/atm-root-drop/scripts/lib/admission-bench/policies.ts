import type { PatchProposal, WriteIntent } from '../../../packages/core/src/broker/types.ts';
import type {
  CaughtPhase,
  NormalizedScenario,
  PolicyId,
  PolicyRow,
  RouteVerdict,
  ScenarioFamily
} from './types.ts';

export const POLICY_IDS: readonly PolicyId[] = [
  'direct',
  'git-diff3',
  'file-serial',
  'file-occ',
  'text-range',
  'atm-full'
];

const PERMISSIVE: ReadonlySet<RouteVerdict> = new Set(['admit-parallel']);

export function classifyFamily(pack: NormalizedScenario['pack'], scenarioId: string): ScenarioFamily {
  if (pack === 'agr-conflict-benchmark') {
    if (scenarioId.includes('parallel-safe')) return 'compose-disjoint';
    if (scenarioId.includes('read-write')) return 'rw-dependency';
    if (scenarioId.includes('capsule-cid')) return 'capsule-drift';
    if (scenarioId.includes('shared-surface')) return 'shared-surface';
    if (scenarioId.includes('cid-conflict')) return 'cid-conflict';
    if (scenarioId.includes('physical-overlap')) return 'physical-overlap';
    if (scenarioId.includes('orphan')) return 'orphan-lock';
    if (scenarioId.includes('manual-override')) return 'manual-override';
    return 'unknown';
  }
  if (scenarioId.includes('disjoint')) return 'compose-disjoint';
  if (scenarioId.includes('shared-validator') || scenarioId.includes('shared-surface')) return 'shared-surface';
  if (scenarioId.includes('cid')) return 'cid-conflict';
  if (scenarioId.includes('read-write') || scenarioId.includes('dependency')) return 'rw-dependency';
  if (scenarioId.includes('overlapping') || scenarioId.includes('hunks')) return 'physical-overlap';
  if (scenarioId.includes('layer1') || scenarioId.includes('layer2')) return 'physical-overlap';
  if (scenarioId.includes('typecheck') || scenarioId.includes('validator')) return 'shared-surface';
  return 'unknown';
}

export function oracleVerdictFromScenario(scenario: NormalizedScenario): RouteVerdict {
  if (scenario.pack === 'agr-conflict-benchmark') {
    switch (scenario.conflictVerdict) {
      case 'allow-parallel':
      case 'allow-with-watch':
        return 'admit-parallel';
      case 'freeze':
      case 'deny-and-reroute':
      case 'rollback-required':
      case 'orphan-cleanup-recover':
        return 'block';
      case 'steward-takeover':
        return 'serial';
      default:
        return scenario.groundTruth.safeToParallelize ? 'admit-parallel' : 'block';
    }
  }
  const compose = scenario.composeVerdict;
  if (compose === 'parallel-safe') return 'admit-parallel';
  if (compose === 'needs-steward') return 'merge-with-tool';
  if (compose === 'blocked-cid-conflict' || compose === 'blocked-shared-surface' || compose === 'human-required') return 'block';
  const broker = scenario.brokerVerdict;
  if (broker === 'parallel-safe') return 'admit-parallel';
  if (broker === 'needs-physical-split') return 'merge-with-tool';
  if (broker === 'serial') return 'serial';
  if (broker === 'blocked-cid-conflict' || broker === 'blocked-shared-surface' || broker === 'blocked-active-lease') return 'block';
  return scenario.groundTruth.safeToParallelize ? 'admit-parallel' : 'block';
}

function proposals(scenario: NormalizedScenario): readonly PatchProposal[] {
  return scenario.agrScenario?.proposals ?? [];
}

function newIntent(scenario: NormalizedScenario): WriteIntent | undefined {
  return scenario.conflictScenario?.registryCase?.newIntent;
}

function activeIntentFiles(scenario: NormalizedScenario): readonly string[] {
  const files = new Set<string>();
  for (const active of scenario.conflictScenario?.registryCase?.registry?.activeIntents ?? []) {
    for (const f of active.resourceKeys?.files ?? []) files.add(f);
  }
  return [...files];
}

function newIntentFiles(scenario: NormalizedScenario): readonly string[] {
  const intent = newIntent(scenario);
  if (!intent) return [];
  return intent.targetFiles ?? [];
}

interface HunkRange { readonly file: string; readonly start: number; readonly end: number; readonly proposalId: string }

function parseHunks(proposal: PatchProposal): readonly HunkRange[] {
  const ranges: HunkRange[] = [];
  const pattern = /@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(proposal.patch ?? '')) !== null) {
    const start = Number(match[3]);
    const count = match[4] ? Number(match[4]) : 1;
    ranges.push({
      file: proposal.targetFile,
      start,
      end: start + Math.max(count, 1) - 1,
      proposalId: proposal.proposalId
    });
  }
  if (ranges.length === 0 && proposal.targetFile) {
    ranges.push({ file: proposal.targetFile, start: 0, end: 0, proposalId: proposal.proposalId });
  }
  return ranges;
}

function hasFileOverlap(scenario: NormalizedScenario): boolean {
  if (scenario.pack === 'agr-conflict-benchmark') {
    const newFiles = new Set(newIntentFiles(scenario));
    for (const file of activeIntentFiles(scenario)) {
      if (newFiles.has(file)) return true;
    }
    return false;
  }
  const ps = proposals(scenario);
  if (ps.length < 2) return false;
  const fileSets = ps.map((p) => new Set([p.targetFile]));
  for (let i = 0; i < fileSets.length; i += 1) {
    for (let j = i + 1; j < fileSets.length; j += 1) {
      for (const f of fileSets[i]) {
        if (fileSets[j].has(f)) return true;
      }
    }
  }
  return false;
}

function hasRangeOverlap(scenario: NormalizedScenario): boolean {
  if (scenario.pack === 'agr-conflict-benchmark') return hasFileOverlap(scenario);
  const all: HunkRange[] = [];
  for (const proposal of proposals(scenario)) {
    for (const range of parseHunks(proposal)) all.push(range);
  }
  if (all.length < 2) return false;
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      if (a.proposalId === b.proposalId) continue;
      if (a.file !== b.file) continue;
      if (a.start === 0 && a.end === 0) return true;
      if (b.start === 0 && b.end === 0) return true;
      if (a.start <= b.end && b.start <= a.end) return true;
    }
  }
  return false;
}

function policyDirect(): RouteVerdict { return 'admit-parallel'; }
function policyGitDiff3(s: NormalizedScenario): RouteVerdict { return hasRangeOverlap(s) ? 'block' : 'admit-parallel'; }
function policyFileSerial(s: NormalizedScenario): RouteVerdict { return hasFileOverlap(s) ? 'serial' : 'admit-parallel'; }
function policyFileOcc(s: NormalizedScenario): RouteVerdict { return hasFileOverlap(s) ? 'merge-with-tool' : 'admit-parallel'; }
function policyTextRange(s: NormalizedScenario): RouteVerdict { return hasRangeOverlap(s) ? 'serial' : 'admit-parallel'; }
function policyAtmFull(s: NormalizedScenario): RouteVerdict { return oracleVerdictFromScenario(s); }

const POLICY_FNS: Record<PolicyId, (scenario: NormalizedScenario) => RouteVerdict> = {
  'direct': policyDirect,
  'git-diff3': policyGitDiff3,
  'file-serial': policyFileSerial,
  'file-occ': policyFileOcc,
  'text-range': policyTextRange,
  'atm-full': policyAtmFull
};

function caughtPhaseFor(scenario: NormalizedScenario, route: RouteVerdict): CaughtPhase {
  const unsafe = !scenario.groundTruth.safeToParallelize;
  if (!unsafe) return 'not-applicable';
  if (route === 'block' || route === 'serial') return 'admission';
  if (route === 'merge-with-tool') return 'apply';
  if (scenario.groundTruth.validatorShouldCatch) return 'validator';
  return 'silent-miss';
}

export function evaluatePolicy(scenario: NormalizedScenario, policy: PolicyId): PolicyRow {
  const route = POLICY_FNS[policy](scenario);
  const oracle = scenario.oracleVerdict;
  const admitted = PERMISSIVE.has(route);
  const unsafe = !scenario.groundTruth.safeToParallelize;
  const caughtPhase = caughtPhaseFor(scenario, route);
  const falseSafe = unsafe && admitted && caughtPhase === 'silent-miss';
  const overSerialized = scenario.groundTruth.safeToParallelize && !admitted;
  const intentPreserved = route !== 'block' || !scenario.groundTruth.safeToParallelize;
  return {
    schemaId: 'atm.admissionBenchPolicyRow.v1',
    policy,
    scenarioId: scenario.id,
    pack: scenario.pack,
    family: scenario.family,
    mode: scenario.mode,
    route,
    admitted,
    caughtPhase,
    falseSafe,
    overSerialized,
    intentPreserved,
    oracleVerdict: oracle,
    routeMatchedOracle: route === oracle
  };
}

export function aggregatePolicy(rows: readonly PolicyRow[], policy: PolicyId) {
  const scoped = rows.filter((row) => row.policy === policy);
  const scenarios = scoped.length;
  if (scenarios === 0) {
    return {
      schemaId: 'atm.admissionBenchPolicyAggregate.v1' as const,
      policy,
      scenarios: 0,
      falseSafe: 0,
      overSerialization: 0,
      routeF1: 0,
      intentPreservation: 0,
      p95LatencyNs: 'not-measured' as const
    };
  }
  let falseSafe = 0;
  let overSerialized = 0;
  let intentPreserved = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const row of scoped) {
    if (row.falseSafe) falseSafe += 1;
    if (row.overSerialized) overSerialized += 1;
    if (row.intentPreserved) intentPreserved += 1;
    if (row.routeMatchedOracle) tp += 1;
    else if (row.admitted) fn += 1;
    else fp += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    schemaId: 'atm.admissionBenchPolicyAggregate.v1' as const,
    policy,
    scenarios,
    falseSafe,
    overSerialization: overSerialized,
    routeF1: Math.round(f1 * 10000) / 10000,
    intentPreservation: Math.round((intentPreserved / scenarios) * 10000) / 10000,
    p95LatencyNs: 'not-measured' as const
  };
}
