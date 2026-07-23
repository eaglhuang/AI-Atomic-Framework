import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectCommandBackedMatrix, hasCommandBackedCellEvidence } from './command-backed-matrix.ts';
import { selectRuntimeDogfoodTasks } from './implementation.ts';

export type Plan3ClosureVerdict = 'ready-to-close' | 'remain-open';

export type Plan3LifecycleClass =
  | 'executed-dogfood-lifecycle'
  | 'compose-batch-membership'
  | 'neutral-steward-apply'
  | 'shared-delivery-commit'
  | 'safe-compose-or-queue-fallback-proof'
  | 'matched-performance-ab-ba'
  | 'event-derived-correctness-counters'
  | 'source-frozen-behavior-parity'
  | 'call-site-parity-0262';

export type Plan3InvariantCode = 'INV-ATM-008' | 'INV-ATM-009' | 'INV-ATM-010';

export interface Plan3InvariantFinding {
  readonly code: Plan3InvariantCode;
  readonly detail: string;
}

export interface Plan3ClosureStatusBreakdown {
  readonly candidateAvailability: 'present' | 'missing';
  readonly executedDogfood: 'proven' | 'missing' | 'invalid-not-required';
  readonly matchedPerformance: 'proven' | 'missing' | 'invalid-formula';
  readonly rollbackParity: 'proven' | 'missing';
  readonly backlog: 'clear' | 'open';
  readonly finalVerdict: Plan3ClosureVerdict;
}

export interface Plan3FakeGreenFixture {
  readonly schemaId: 'atm.plan3FakeGreenClosureFixture.v1';
  readonly candidateCount: number;
  readonly ticketState: string;
  readonly requiredIntersection: readonly string[];
  readonly cellCount: number;
  readonly commandBackedCount: number;
  readonly formulaHardcodedSignals: readonly string[];
  readonly predecessorDisposition: 'superseded-for-plan-closure' | string;
  readonly weakWorkloadCommands: readonly string[];
  readonly sameFilePathOnlySerialization: boolean;
  readonly callSiteParityOk: boolean;
  readonly sourceFrozenParityOk: boolean;
}

export interface Plan3SemanticClosureReport {
  readonly schemaId: 'atm.plan3SemanticClosurePolicy.v1';
  readonly verdict: Plan3ClosureVerdict;
  readonly missingLifecycleClasses: readonly Plan3LifecycleClass[];
  readonly invariantFindings: readonly Plan3InvariantFinding[];
  readonly dispositionFindings: readonly string[];
  readonly status: Plan3ClosureStatusBreakdown;
  readonly blockers: readonly string[];
  readonly formulaDisclosureInformationalOnly: true;
}

const REQUIRED_LIFECYCLE_CLASSES: readonly Plan3LifecycleClass[] = [
  'executed-dogfood-lifecycle',
  'compose-batch-membership',
  'neutral-steward-apply',
  'shared-delivery-commit',
  'safe-compose-or-queue-fallback-proof',
  'matched-performance-ab-ba',
  'event-derived-correctness-counters',
  'source-frozen-behavior-parity',
  'call-site-parity-0262'
];

const WEAK_WORKLOAD_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s"'`\\/])--version(?:\s|$)/i,
  /\batm\.mjs\s+--version\b/i,
  /\bsleep\b/i,
  /\btimeout\s+\d+\b/i
];

export function isSemanticallyValidClosureWorkload(command: string): boolean {
  const normalized = String(command ?? '').trim();
  if (!normalized) return false;
  return !WEAK_WORKLOAD_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function classifyClosureReceipt(value: unknown): 'valid-shape' | 'digest-only' | 'weak-workload' | 'invalid' {
  if (!value || typeof value !== 'object') return 'invalid';
  const receipt = value as Record<string, unknown>;
  const command = typeof receipt.command === 'string' ? receipt.command.trim() : '';
  const stdoutDigest = typeof receipt.stdoutDigest === 'string'
    ? receipt.stdoutDigest
    : typeof receipt.stdoutSha256 === 'string'
      ? receipt.stdoutSha256
      : '';
  const stderrDigest = typeof receipt.stderrDigest === 'string'
    ? receipt.stderrDigest
    : typeof receipt.stderrSha256 === 'string'
      ? receipt.stderrSha256
      : '';
  if (!command && (stdoutDigest || stderrDigest)) return 'digest-only';
  if (!hasCommandBackedCellEvidence({ workloadReceipts: [receipt] }) && !hasCommandBackedCellEvidence({ commandReceipts: [receipt] })) {
    return 'invalid';
  }
  if (!isSemanticallyValidClosureWorkload(command)) return 'weak-workload';
  return 'valid-shape';
}

export function resolveCanonicalDecisionClass(input: {
  readonly verdict: string | null | undefined;
  readonly admissionState?: string | null;
}): 'composer-routed' | 'must-serialize' | 'blocked' | 'unclassified' {
  const admissionState = String(input.admissionState ?? '').trim();
  if (admissionState === 'composer-routed') return 'composer-routed';
  if (admissionState === 'blocked-before-write' || input.verdict === 'blocked-active-lease' || input.verdict === 'blocked-cid-conflict') {
    return 'must-serialize';
  }
  if (input.verdict === 'needs-physical-split' && admissionState === 'parked-for-rearbitration') {
    return 'must-serialize';
  }
  if (input.verdict === 'blocked-shared-surface') return 'blocked';
  if (input.verdict === 'needs-physical-split') {
    // Legacy top-level verdict alone must not force serialization.
    return 'unclassified';
  }
  return 'unclassified';
}

export function loadPlan3FakeGreenFixture(cwd: string, relativePath = 'tests/fixtures/plan3-fake-green/current-protected-closure.json'): Plan3FakeGreenFixture | null {
  const absolutePath = path.join(cwd, relativePath);
  if (!existsSync(absolutePath)) return null;
  const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Plan3FakeGreenFixture;
  if (parsed?.schemaId !== 'atm.plan3FakeGreenClosureFixture.v1') return null;
  return parsed;
}

export function evaluatePlan3SemanticClosure(input: {
  readonly cwd: string;
  readonly requiredIntersection?: readonly string[];
  readonly fixture?: Plan3FakeGreenFixture | null;
  readonly useLiveEvidence?: boolean;
}): Plan3SemanticClosureReport {
  const requiredIntersection = input.requiredIntersection ?? ['docs/governance/atm-3-replay-evidence.md'];
  const fixture = input.fixture === undefined
    ? loadPlan3FakeGreenFixture(input.cwd)
    : input.fixture;
  const live = input.useLiveEvidence === false
    ? null
    : collectLiveClosureSignals(input.cwd, requiredIntersection);

  const signals = mergeClosureSignals(live, fixture);
  const missingLifecycleClasses: Plan3LifecycleClass[] = [];
  const invariantFindings: Plan3InvariantFinding[] = [];
  const dispositionFindings: string[] = [];

  if (signals.ticketState === 'not-required' && signals.candidateCount >= 2 && signals.hasDeclaredIntersection) {
    invariantFindings.push({
      code: 'INV-ATM-008',
      detail: 'Deliberate same-file intersection dogfood reported ticket state not-required; broker tickets are required for shared-write proof.'
    });
  }

  if (signals.formulaHardcodedSignals.length > 0) {
    invariantFindings.push({
      code: 'INV-ATM-009',
      detail: `Performance matrix control flow still embeds hardcoded/fixed cost signals (${signals.formulaHardcodedSignals.join(', ')}).`
    });
  }

  if (signals.sameFilePathOnlySerialization) {
    invariantFindings.push({
      code: 'INV-ATM-010',
      detail: 'Same-file scenario evidence shows path-only serialization without compose-batch membership and neutral-steward apply.'
    });
  }

  if (signals.predecessorDisposition === 'superseded-for-plan-closure') {
    dispositionFindings.push('superseded-for-plan-closure');
  }

  if (signals.weakWorkloadCount > 0 || signals.digestOnlyCount > 0) {
    missingLifecycleClasses.push('executed-dogfood-lifecycle');
  }

  if (!signals.executedDogfoodProven) missingLifecycleClasses.push('executed-dogfood-lifecycle');
  if (!signals.composeBatchProven) missingLifecycleClasses.push('compose-batch-membership');
  if (!signals.stewardApplyProven) missingLifecycleClasses.push('neutral-steward-apply');
  if (!signals.sharedDeliveryProven) missingLifecycleClasses.push('shared-delivery-commit');
  if (!signals.safeComposeOrFallbackProven) missingLifecycleClasses.push('safe-compose-or-queue-fallback-proof');
  if (!signals.matchedPerformanceProven) missingLifecycleClasses.push('matched-performance-ab-ba');
  if (!signals.eventDerivedCountersProven) missingLifecycleClasses.push('event-derived-correctness-counters');
  if (!signals.sourceFrozenParityOk) missingLifecycleClasses.push('source-frozen-behavior-parity');
  if (!signals.callSiteParityOk) missingLifecycleClasses.push('call-site-parity-0262');

  const uniqueMissing = uniqueLifecycle(missingLifecycleClasses);
  const blockers = [
    ...uniqueMissing.map((entry) => `missing-lifecycle-class:${entry}`),
    ...invariantFindings.map((entry) => `${entry.code}: ${entry.detail}`),
    ...dispositionFindings.map((entry) => `evidence-disposition:${entry}`)
  ];

  // Candidate presence, formula disclosure, or predecessor done must never convert remain-open into ready-to-close.
  const verdict: Plan3ClosureVerdict = blockers.length === 0 ? 'ready-to-close' : 'remain-open';
  const executedDogfood: Plan3ClosureStatusBreakdown['executedDogfood'] = signals.ticketState === 'not-required'
    ? 'invalid-not-required'
    : signals.executedDogfoodProven
      ? 'proven'
      : 'missing';
  const matchedPerformance: Plan3ClosureStatusBreakdown['matchedPerformance'] = signals.formulaHardcodedSignals.length > 0
    ? 'invalid-formula'
    : signals.matchedPerformanceProven
      ? 'proven'
      : 'missing';

  return {
    schemaId: 'atm.plan3SemanticClosurePolicy.v1',
    verdict,
    missingLifecycleClasses: uniqueMissing,
    invariantFindings,
    dispositionFindings,
    status: {
      candidateAvailability: signals.candidateCount >= 2 ? 'present' : 'missing',
      executedDogfood,
      matchedPerformance,
      rollbackParity: signals.rollbackParityOk ? 'proven' : 'missing',
      backlog: signals.backlogClear ? 'clear' : 'open',
      finalVerdict: verdict
    },
    blockers,
    formulaDisclosureInformationalOnly: true
  };
}

interface LiveClosureSignals {
  readonly candidateCount: number;
  readonly hasDeclaredIntersection: boolean;
  readonly ticketState: string;
  readonly formulaHardcodedSignals: readonly string[];
  readonly weakWorkloadCount: number;
  readonly digestOnlyCount: number;
  readonly sameFilePathOnlySerialization: boolean;
  readonly predecessorDisposition: string;
  readonly executedDogfoodProven: boolean;
  readonly composeBatchProven: boolean;
  readonly stewardApplyProven: boolean;
  readonly sharedDeliveryProven: boolean;
  readonly safeComposeOrFallbackProven: boolean;
  readonly matchedPerformanceProven: boolean;
  readonly eventDerivedCountersProven: boolean;
  readonly sourceFrozenParityOk: boolean;
  readonly callSiteParityOk: boolean;
  readonly rollbackParityOk: boolean;
  readonly backlogClear: boolean;
}

function collectLiveClosureSignals(cwd: string, requiredIntersection: readonly string[]): LiveClosureSignals {
  let candidates: ReturnType<typeof selectRuntimeDogfoodTasks> = [];
  try {
    candidates = selectRuntimeDogfoodTasks({
      cwd,
      requiredIntersection,
      minimum: 2
    });
  } catch {
    candidates = [];
  }

  const matrix = inspectCommandBackedMatrix(cwd);
  const cellsPath = path.join(cwd, matrix.cellsPath);
  let weakWorkloadCount = 0;
  let digestOnlyCount = 0;
  if (existsSync(cellsPath)) {
    const cells = JSON.parse(readFileSync(cellsPath, 'utf8'));
    const cellArray = Array.isArray(cells) ? cells : [];
    for (const cell of cellArray) {
      const receipts = [
        ...(((cell as { commandReceipts?: unknown[] }).commandReceipts) ?? []),
        ...(((cell as { workloadReceipts?: unknown[] }).workloadReceipts) ?? [])
      ];
      if (receipts.length === 0) continue;
      for (const receipt of receipts) {
        const classification = classifyClosureReceipt(receipt);
        if (classification === 'weak-workload') weakWorkloadCount += 1;
        if (classification === 'digest-only') digestOnlyCount += 1;
      }
    }
  }

  const formulaHardcodedSignals = detectFormulaHardcodedSignals(cwd);
  const callSiteParityOk = hasPassingCallSiteParityEvidence(cwd);
  // Live Plan 3.1 weak evidence: candidate cards + formula matrix receipts are not semantic closure.
  const ticketState = candidates.length >= 2 ? 'not-required' : 'missing';

  return {
    candidateCount: candidates.length,
    hasDeclaredIntersection: candidates.length >= 2,
    ticketState,
    formulaHardcodedSignals,
    weakWorkloadCount,
    digestOnlyCount,
    sameFilePathOnlySerialization: true,
    predecessorDisposition: 'superseded-for-plan-closure',
    executedDogfoodProven: false,
    composeBatchProven: false,
    stewardApplyProven: false,
    sharedDeliveryProven: false,
    safeComposeOrFallbackProven: false,
    matchedPerformanceProven: false,
    eventDerivedCountersProven: false,
    sourceFrozenParityOk: false,
    callSiteParityOk,
    rollbackParityOk: false,
    backlogClear: false
  };
}

function mergeClosureSignals(live: LiveClosureSignals | null, fixture: Plan3FakeGreenFixture | null): LiveClosureSignals {
  if (!live && !fixture) {
    return {
      candidateCount: 0,
      hasDeclaredIntersection: false,
      ticketState: 'missing',
      formulaHardcodedSignals: [],
      weakWorkloadCount: 0,
      digestOnlyCount: 0,
      sameFilePathOnlySerialization: false,
      predecessorDisposition: 'superseded-for-plan-closure',
      executedDogfoodProven: false,
      composeBatchProven: false,
      stewardApplyProven: false,
      sharedDeliveryProven: false,
      safeComposeOrFallbackProven: false,
      matchedPerformanceProven: false,
      eventDerivedCountersProven: false,
      sourceFrozenParityOk: false,
      callSiteParityOk: false,
      rollbackParityOk: false,
      backlogClear: false
    };
  }

  if (fixture && (!live || live.candidateCount > 0 || live.formulaHardcodedSignals.length > 0)) {
    // Prefer locked fake-green semantics whenever the fixture exists; live weak evidence must not outrank it.
    return {
      candidateCount: fixture.candidateCount,
      hasDeclaredIntersection: fixture.requiredIntersection.length > 0 && fixture.candidateCount >= 2,
      ticketState: fixture.ticketState,
      formulaHardcodedSignals: fixture.formulaHardcodedSignals,
      weakWorkloadCount: fixture.weakWorkloadCommands.length,
      digestOnlyCount: 0,
      sameFilePathOnlySerialization: fixture.sameFilePathOnlySerialization,
      predecessorDisposition: fixture.predecessorDisposition,
      executedDogfoodProven: false,
      composeBatchProven: false,
      stewardApplyProven: false,
      sharedDeliveryProven: false,
      safeComposeOrFallbackProven: false,
      matchedPerformanceProven: false,
      eventDerivedCountersProven: false,
      sourceFrozenParityOk: fixture.sourceFrozenParityOk,
      callSiteParityOk: fixture.callSiteParityOk,
      rollbackParityOk: false,
      backlogClear: false
    };
  }

  return live!;
}

function detectFormulaHardcodedSignals(cwd: string): readonly string[] {
  const scriptPath = path.join(cwd, 'scripts/run-paired-ab-v4.ts');
  if (!existsSync(scriptPath)) return [];
  const source = readFileSync(scriptPath, 'utf8');
  return [
    'const serialBase =',
    'const armFactor =',
    'const throughputFactor =',
    'const costFactor ='
  ].filter((signal) => source.includes(signal));
}

function hasPassingCallSiteParityEvidence(cwd: string): boolean {
  const evidencePath = path.join(cwd, '.atm/history/evidence/ATM-GOV-0262.json');
  if (!existsSync(evidencePath)) return false;
  const raw = readFileSync(evidencePath, 'utf8');
  return raw.includes('broker-overlap-callsite-parity.test.ts');
}

function uniqueLifecycle(values: readonly Plan3LifecycleClass[]): readonly Plan3LifecycleClass[] {
  const seen = new Set<Plan3LifecycleClass>();
  const ordered: Plan3LifecycleClass[] = [];
  for (const value of REQUIRED_LIFECYCLE_CLASSES) {
    if (values.includes(value) && !seen.has(value)) {
      seen.add(value);
      ordered.push(value);
    }
  }
  return ordered;
}
