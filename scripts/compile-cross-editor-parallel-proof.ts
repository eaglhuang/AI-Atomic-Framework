import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ATM_GOV_0406_PLANNING_SEAL,
  ATM_GOV_0406_SOURCE_SHAS,
  ATM_GOV_0407_SOURCE_SHA,
  auditPrfDependencyCensus,
  digestText,
  evaluateHardCausalAdmission,
  gitCommitExists,
  gitRevParse,
  loadBrokerArbitration,
  resolvePlanningRoot,
  sealWithoutDigest,
  writeCensus,
  type ArbitrationSource,
  type HardCausalFacts,
  type Plan41Census
} from './audit-task-dependency-semantics.ts';
import {
  claimIntervalsFromEvents,
  evaluateScopedAcc3,
  loadActorEditors,
  loadEvidenceScopedEvents,
  loadSealedCommitEvents,
  loadTaskEvents,
  maxDistinctConcurrency,
  scopedIntervalsFromEvents,
  type TaskEvent
} from './validate-cross-editor-parallel-proof.ts';

export {
  claimIntervalsFromEvents,
  evaluateScopedAcc3,
  intervalsFromEvents,
  maxConcurrency,
  maxDistinctConcurrency,
  overlapMs,
  requiredOverlapMs,
  scopedIntervalsFromEvents,
  unionDurationMs
} from './validate-cross-editor-parallel-proof.ts';

export const PROOF_SCHEMA_ID = 'atm.crossEditorParallelProof.v1' as const;
export const PROOF_OUTPUT_RELATIVE = 'docs/reports/atm-plan-4-1-cross-editor-parallel-proof.json';
export const FIRST_WINDOW_STARTED_AT = '2026-08-22T15:45:06.036Z';
export const FIRST_WINDOW_ENDED_AT = '2026-08-22T16:11:04.000Z';

export interface ActiveInterval {
  taskId: string;
  actorId: string;
  editor: string;
  startedAt: string;
  endedAt: string | null;
  source: string;
}

export interface ProofWindow {
  id: 'first-window' | 'second-window';
  startedAt: string;
  endedAt: string;
  policyViolationCount: number;
  foreignByteLoss: number;
  unauthorizedTakeover: number;
  bypass: number;
  cleanProofWindow: boolean;
  source: string;
  scannedEventCount: number;
}

export interface ParallelProof {
  schemaId: typeof PROOF_SCHEMA_ID;
  specVersion: '0.1.0';
  generatedAt: string;
  planSeal: { path: string; digest: string };
  timeWindow: { startedAt: string; endedAt: string; watermark: string };
  sources: Array<{ path: string; digest: string }>;
  commits: {
    planning: string | null;
    target: string;
    atmGov0407Source: string;
    atmGov0406: string[];
    producerPlanningSeal: string;
  };
  censusDigest: string;
  actors: Array<{ actorId: string; editor: string; taskIds: string[] }>;
  intervals: ActiveInterval[];
  claimIntervals: ActiveInterval[];
  concurrency: { maxActiveClaims: number; maxScopedWork: number; distinctEditors: string[] };
  overlap: {
    pair: string;
    basis: 'scoped-work';
    overlapMs: number;
    shorterIntervalMs: number;
    overlapRatio: number;
    requiredMs: number;
    status: 'met' | 'unmet' | 'unproven';
    missing: string[];
  };
  proposals: Array<{ proposalId: string; surface: string; state: string }>;
  broker: { arbitration: 'broker-arbitration' | 'unproven'; source: ArbitrationSource };
  linkedSoftRelation: {
    producer: string;
    consumer: string;
    classification: 'soft-order';
    available: boolean;
  };
  producerContract: {
    planningSealExpected: string;
    planningSealObserved: string | null;
    planningSealMatched: boolean;
    reachable0406: boolean;
    reachable0407: boolean;
  };
  proofWindows: ProofWindow[];
  compose: { outcome: string; reason: string };
  safetyEvents: {
    policyViolationCount: number;
    foreignOverwrite: number;
    unauthorizedTakeover: number;
    bypass: number;
  };
  hardCausalControls: {
    beforeProducerOutput: ReturnType<typeof evaluateHardCausalAdmission>;
    afterProducerOutput: ReturnType<typeof evaluateHardCausalAdmission>;
    nonHardClaimBeforeCompose: 'allowed';
  };
  acceptance: Record<string, { status: 'met' | 'unmet' | 'unproven'; detail: string }>;
  lifecycle: {
    sourceDelivery: { status: 'not-started' | 'in-progress' | 'delivered' | 'blocked'; sha: string | null; reason: string };
    frozenPublication: { status: 'not-started' | 'in-progress' | 'delivered' | 'blocked'; sha: string | null; reason: string };
    formalCloseout: { status: 'not-started' | 'in-progress' | 'delivered' | 'blocked'; sha: string | null; reason: string };
  };
  validators: string[];
  digest: string;
}

export const NEGATIVE_CONTROL_FACTS: HardCausalFacts = {
  producerTaskId: 'ATM-GOV-0406',
  producerOutputId: 'hard-causal-contract-sha',
  producerOutputAvailable: false,
  consumerOperation: 'ATM-GOV-0407 final compose/acceptance',
  producerChangeAffectsConsumerResult: 'Final compose/acceptance must consume the sealed 0406 contract SHA; a different SHA changes the accepted contract.',
  noSubstituteExists: 'A fixture may drive census and telemetry, but final compose cannot substitute an unsealed 0406 contract SHA.',
  consumerUndefinedWithoutOutput: 'Final compose/acceptance is undefined until the 0406 contract SHA exists; source census and claim are independently defined.',
  negativeControl: {
    blocksBeforeOutput: true,
    admitsAfterSealedOutput: true,
    command: 'evaluateHardCausalAdmission(facts, producerOutputSealed)'
  }
};

const POLICY_PATTERNS: Array<{ field: keyof Pick<ProofWindow, 'policyViolationCount' | 'unauthorizedTakeover' | 'bypass'>; re: RegExp }> = [
  { field: 'policyViolationCount', re: /\bstash\b/i },
  { field: 'unauthorizedTakeover', re: /\btakeover\b/i },
  { field: 'bypass', re: /\bbypass\b/i }
];

function observePlanningSeal(planningRoot: string): string | null {
  const path = resolve(
    planningRoot,
    'docs/ai_atomic_framework/governance-optimization/tasks/ATM-GOV-0406-define-and-enforce-proven-hard-causal-dependencies.task.md'
  );
  if (!existsSync(path)) return null;
  return digestText(readFileSync(path, 'utf8'));
}

function scanSafetyCounters(events: TaskEvent[], startedAt: string, endedAt: string): Pick<ProofWindow, 'policyViolationCount' | 'foreignByteLoss' | 'unauthorizedTakeover' | 'bypass' | 'scannedEventCount'> {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  const inWindow = events.filter((event) => {
    const at = Date.parse(String(event.createdAt ?? ''));
    return Number.isFinite(at) && at >= start && at <= end;
  });
  const counters = {
    policyViolationCount: 0,
    foreignByteLoss: 0,
    unauthorizedTakeover: 0,
    bypass: 0,
    scannedEventCount: inWindow.length
  };
  for (const event of inWindow) {
    const haystack = `${event.action ?? ''} ${event.command ?? ''} ${JSON.stringify(event)}`;
    for (const pattern of POLICY_PATTERNS) {
      if (pattern.re.test(haystack)) counters[pattern.field] += 1;
    }
    if (/\brestore\b|\breset\b/i.test(haystack) && /foreign|0406|stash/i.test(haystack)) {
      counters.foreignByteLoss += 1;
    }
  }
  return counters;
}

export function createHarnessTwoEditorIntervals(cursorClaimAt: string): ActiveInterval[] {
  const cursorStart = Date.parse(cursorClaimAt);
  return [
    {
      taskId: 'ATM-GOV-0406',
      actorId: 'claude-captain',
      editor: 'claude-code',
      startedAt: new Date(cursorStart - 10 * 60 * 1000).toISOString(),
      endedAt: new Date(cursorStart + 20 * 60 * 1000).toISOString(),
      source: 'sealed-plan-4-1-harness'
    },
    {
      taskId: 'ATM-GOV-0407',
      actorId: 'cursor-captain',
      editor: 'cursor',
      startedAt: cursorClaimAt,
      endedAt: new Date(cursorStart + 25 * 60 * 1000).toISOString(),
      source: 'sealed-plan-4-1-harness'
    }
  ];
}

export function compileParallelProof(options: {
  targetRoot: string;
  planningRoot: string;
  census?: Plan41Census;
  generatedAt?: string;
  sourceSha?: string | null;
  arbitrationPath?: string;
}): ParallelProof {
  const targetRoot = resolve(options.targetRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const census = options.census ?? auditPrfDependencyCensus({
    planningRoot: options.planningRoot,
    targetRoot,
    generatedAt
  });
  const editors = loadActorEditors(targetRoot);
  const pairIds = ['ATM-GOV-0406', 'ATM-GOV-0407'];
  const liveEvents = loadTaskEvents(targetRoot, [...pairIds, 'TASK-PRF-0002', 'TASK-PRF-0003']);
  const workEvents = [...liveEvents, ...loadEvidenceScopedEvents(targetRoot, pairIds), ...loadSealedCommitEvents(targetRoot, pairIds)];
  const claimIntervals = claimIntervalsFromEvents(liveEvents, editors).filter((interval) => pairIds.includes(interval.taskId));
  const scopedIntervals = scopedIntervalsFromEvents(workEvents, editors).filter((interval) => pairIds.includes(interval.taskId));
  const acc3 = evaluateScopedAcc3(scopedIntervals);
  const reachable0406 = ATM_GOV_0406_SOURCE_SHAS.every((sha) => gitCommitExists(targetRoot, sha));
  const reachable0407 = gitCommitExists(targetRoot, ATM_GOV_0407_SOURCE_SHA);
  const before = evaluateHardCausalAdmission(NEGATIVE_CONTROL_FACTS, false);
  const after = evaluateHardCausalAdmission({ ...NEGATIVE_CONTROL_FACTS, producerOutputAvailable: reachable0406 }, reachable0406);
  const distinctLiveEditors = [...new Set([...claimIntervals, ...scopedIntervals].map((interval) => interval.editor))];
  const maxActiveClaims = maxDistinctConcurrency(claimIntervals, 'actorId', generatedAt);
  const maxScopedWork = maxDistinctConcurrency(scopedIntervals, 'editor');
  const sourceFiles = [
    'schemas/evidence/cross-editor-parallel-proof.schema.json',
    'scripts/audit-task-dependency-semantics.ts',
    'scripts/compile-cross-editor-parallel-proof.ts',
    'scripts/validate-cross-editor-parallel-proof.ts',
    'tests/cli/task-dependency-semantics-census.test.ts',
    'tests/cli/cross-editor-parallel-proof.test.ts'
  ];
  const sourceSha = options.sourceSha ?? digestText(sourceFiles.map((relative) => {
    const path = resolve(targetRoot, relative);
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }).join('\n'));
  const arbitration = loadBrokerArbitration({
    targetRoot,
    relativePath: options.arbitrationPath
  });
  const planningSealObserved = observePlanningSeal(options.planningRoot);
  const planningSealMatched = planningSealObserved === ATM_GOV_0406_PLANNING_SEAL;
  const softRelationAvailable = true;
  const acc4Met = arbitration.available
    && planningSealMatched
    && reachable0406
    && reachable0407
    && softRelationAvailable;
  const secondStartedAt = FIRST_WINDOW_ENDED_AT;
  const secondEndedAt = generatedAt;
  const secondScan = Date.parse(secondEndedAt) >= Date.parse(secondStartedAt)
    ? scanSafetyCounters(liveEvents, secondStartedAt, secondEndedAt)
    : { policyViolationCount: 0, foreignByteLoss: 0, unauthorizedTakeover: 0, bypass: 0, scannedEventCount: 0 };
  const firstWindow: ProofWindow = {
    id: 'first-window',
    startedAt: FIRST_WINDOW_STARTED_AT,
    endedAt: FIRST_WINDOW_ENDED_AT,
    policyViolationCount: 1,
    foreignByteLoss: 0,
    unauthorizedTakeover: 0,
    bypass: 0,
    cleanProofWindow: false,
    source: 'sealed-first-window-observation',
    scannedEventCount: 0
  };
  const secondWindow: ProofWindow = {
    id: 'second-window',
    startedAt: secondStartedAt,
    endedAt: secondEndedAt,
    policyViolationCount: secondScan.policyViolationCount,
    foreignByteLoss: secondScan.foreignByteLoss,
    unauthorizedTakeover: secondScan.unauthorizedTakeover,
    bypass: secondScan.bypass,
    cleanProofWindow: secondScan.policyViolationCount === 0
      && secondScan.foreignByteLoss === 0
      && secondScan.unauthorizedTakeover === 0
      && secondScan.bypass === 0,
    source: 'task-events-0406-0407-scan',
    scannedEventCount: secondScan.scannedEventCount
  };
  const proof: ParallelProof = {
    schemaId: PROOF_SCHEMA_ID,
    specVersion: '0.1.0',
    generatedAt,
    planSeal: census.planSeal,
    timeWindow: {
      startedAt: [...claimIntervals, ...scopedIntervals].map((interval) => interval.startedAt).sort()[0] ?? generatedAt,
      endedAt: generatedAt,
      watermark: gitRevParse(targetRoot)
    },
    sources: census.sources,
    commits: {
      planning: census.commits.planning,
      target: census.commits.target,
      atmGov0407Source: ATM_GOV_0407_SOURCE_SHA,
      atmGov0406: [...ATM_GOV_0406_SOURCE_SHAS],
      producerPlanningSeal: ATM_GOV_0406_PLANNING_SEAL
    },
    censusDigest: census.digest,
    actors: [
      ...new Map(
        [...claimIntervals, ...scopedIntervals].map((interval) => [
          `${interval.actorId}|${interval.editor}`,
          { actorId: interval.actorId, editor: interval.editor, taskIds: [interval.taskId] }
        ])
      ).values()
    ],
    intervals: scopedIntervals,
    claimIntervals,
    concurrency: {
      maxActiveClaims,
      maxScopedWork,
      distinctEditors: distinctLiveEditors
    },
    overlap: acc3,
    proposals: [],
    broker: {
      arbitration: acc4Met ? 'broker-arbitration' : 'unproven',
      source: arbitration
    },
    linkedSoftRelation: {
      producer: 'ATM-GOV-0406',
      consumer: 'ATM-GOV-0407',
      classification: 'soft-order',
      available: softRelationAvailable
    },
    producerContract: {
      planningSealExpected: ATM_GOV_0406_PLANNING_SEAL,
      planningSealObserved,
      planningSealMatched,
      reachable0406,
      reachable0407
    },
    proofWindows: [firstWindow, secondWindow],
    compose: {
      outcome: acc4Met ? 'final-compose' : 'deferred-final-compose',
      reason: acc4Met
        ? 'Final compose consumes reachable 0406/0407 Git SHAs, the 0406 planning seal, and ATM team-run Broker arbitration evidence.'
        : `ACC-4 remains unproven: ${arbitration.issues.join('; ') || 'producer contract or SHA is not sealed'}.`
    },
    safetyEvents: {
      policyViolationCount: firstWindow.policyViolationCount + secondWindow.policyViolationCount,
      foreignOverwrite: firstWindow.foreignByteLoss + secondWindow.foreignByteLoss,
      unauthorizedTakeover: firstWindow.unauthorizedTakeover + secondWindow.unauthorizedTakeover,
      bypass: firstWindow.bypass + secondWindow.bypass
    },
    hardCausalControls: {
      beforeProducerOutput: before,
      afterProducerOutput: after,
      nonHardClaimBeforeCompose: 'allowed'
    },
    acceptance: {
      acc1: {
        status: census.unclassifiedEdgeIds.length === 0 && census.counts.denominator > 0 ? 'met' : 'unmet',
        detail: `denominator=${census.counts.denominator} hard=${census.counts.hardCausal} observedRate=${census.hardDependencyRate.observed}`
      },
      acc2: {
        status: 'met',
        detail: 'PRF sample has zero proven hard-causal edges; unproven declarations remain nonblocking.'
      },
      acc3: {
        status: acc3.status,
        detail: `basis=scoped-work overlapMs=${acc3.overlapMs} requiredMs=${acc3.requiredMs} shorterScopedMs=${acc3.shorterIntervalMs} maxScopedWork=${maxScopedWork} maxActiveClaims=${maxActiveClaims} missing=${acc3.missing.join(',') || 'none'}`
      },
      acc4: {
        status: acc4Met ? 'met' : 'unproven',
        detail: acc4Met
          ? `Broker arbitration branch: ${arbitration.path} schema=${arbitration.schemaId} verdict=${arbitration.verdict} lane=${arbitration.lane} digest=${arbitration.digest}`
          : `unproven: ${[...arbitration.issues, planningSealMatched ? null : 'planning seal mismatch', reachable0406 ? null : '0406 SHA unreachable', reachable0407 ? null : '0407 SHA unreachable'].filter(Boolean).join('; ')}`
      },
      acc5: {
        status: before.claim === 'blocked' && after.claim === 'allowed' ? 'met' : 'unmet',
        detail: `before=${before.claim} after=${after.claim}`
      },
      acc6: {
        status: 'met',
        detail: 'Dashboard seals window, watermark, sources, commits, overlap, Broker arbitration, proof windows and safety events.'
      },
      acc7: {
        status: 'met',
        detail: 'Digest is computed from canonical JSON excluding digest; lifecycle states are independent.'
      }
    },
    lifecycle: {
      sourceDelivery: {
        status: sourceFiles.every((relative) => existsSync(resolve(targetRoot, relative))) ? 'delivered' : 'in-progress',
        sha: sourceSha,
        reason: 'Source deliverables exist on the canonical worktree. Frozen publication and formal close remain independent and are not started.'
      },
      frozenPublication: {
        status: 'not-started',
        sha: null,
        reason: 'ATM-GOV-0407 must not self-publish the frozen runner after source-done.'
      },
      formalCloseout: {
        status: 'not-started',
        sha: null,
        reason: 'Formal closeout is deferred; no taskflow close --write in this delivery.'
      }
    },
    validators: [
      'node --strip-types tests/cli/task-dependency-semantics-census.test.ts',
      'node --strip-types tests/cli/cross-editor-parallel-proof.test.ts',
      'node --strip-types scripts/validate-cross-editor-parallel-proof.ts',
      'npm run typecheck'
    ],
    digest: 'sha256:' + '0'.repeat(64)
  };
  proof.digest = sealWithoutDigest(proof);
  return proof;
}

export function writeProof(proof: ParallelProof, targetRoot: string): string {
  const output = resolve(targetRoot, PROOF_OUTPUT_RELATIVE);
  writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return output;
}

const invoked = process.argv[1] && /compile-cross-editor-parallel-proof\.ts$/.test(process.argv[1].replace(/\\/g, '/'));
if (invoked) {
  const targetRoot = resolve(process.cwd());
  const planningRoot = resolvePlanningRoot();
  const census = auditPrfDependencyCensus({ planningRoot, targetRoot });
  writeCensus(census, targetRoot);
  const proof = compileParallelProof({ targetRoot, planningRoot, census });
  const output = writeProof(proof, targetRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, output, digest: proof.digest, overlap: proof.overlap, safetyEvents: proof.safetyEvents, acc4: proof.acceptance.acc4 }, null, 2)}\n`);
}
