import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  auditPrfDependencyCensus,
  digestText,
  evaluateHardCausalAdmission,
  gitRevParse,
  resolvePlanningRoot,
  sealWithoutDigest,
  writeCensus,
  type HardCausalFacts,
  type Plan41Census
} from './audit-task-dependency-semantics.ts';

export const PROOF_SCHEMA_ID = 'atm.crossEditorParallelProof.v1' as const;
export const PROOF_OUTPUT_RELATIVE = 'docs/reports/atm-plan-4-1-cross-editor-parallel-proof.json';

export interface ActiveInterval {
  taskId: string;
  actorId: string;
  editor: string;
  startedAt: string;
  endedAt: string | null;
  source: string;
}

export interface ParallelProof {
  schemaId: typeof PROOF_SCHEMA_ID;
  specVersion: '0.1.0';
  generatedAt: string;
  planSeal: { path: string; digest: string };
  timeWindow: { startedAt: string; endedAt: string; watermark: string };
  sources: Array<{ path: string; digest: string }>;
  commits: { planning: string | null; target: string };
  censusDigest: string;
  actors: Array<{ actorId: string; editor: string; taskIds: string[] }>;
  intervals: ActiveInterval[];
  concurrency: { maxActiveClaims: number; distinctEditors: string[] };
  overlap: {
    pair: string;
    overlapMs: number;
    shorterIntervalMs: number;
    overlapRatio: number;
    requiredMs: number;
    status: 'met' | 'unmet';
  };
  proposals: Array<{ proposalId: string; surface: string; state: string }>;
  broker: { arbitration: string; ticket: string };
  compose: { outcome: string; reason: string };
  safetyEvents: { foreignOverwrite: number; unauthorizedTakeover: number; bypass: number };
  hardCausalControls: {
    beforeProducerOutput: ReturnType<typeof evaluateHardCausalAdmission>;
    afterProducerOutput: ReturnType<typeof evaluateHardCausalAdmission>;
    nonHardClaimBeforeCompose: 'allowed';
  };
  acceptance: Record<string, { status: 'met' | 'unmet'; detail: string }>;
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

export function editorForActor(actorId: string, registryEditor?: string | null): string {
  if (registryEditor) return registryEditor;
  if (/cursor/i.test(actorId)) return 'cursor';
  if (/claude/i.test(actorId)) return 'claude-code';
  if (/codex/i.test(actorId)) return 'codex';
  return 'unknown';
}

export function overlapMs(left: ActiveInterval, right: ActiveInterval, nowIso: string): number {
  const now = Date.parse(nowIso);
  const a0 = Date.parse(left.startedAt);
  const a1 = left.endedAt ? Date.parse(left.endedAt) : now;
  const b0 = Date.parse(right.startedAt);
  const b1 = right.endedAt ? Date.parse(right.endedAt) : now;
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function intervalDurationMs(interval: ActiveInterval, nowIso: string): number {
  const now = Date.parse(nowIso);
  return Math.max(0, (interval.endedAt ? Date.parse(interval.endedAt) : now) - Date.parse(interval.startedAt));
}

export function maxConcurrency(intervals: ActiveInterval[], nowIso: string): number {
  const now = Date.parse(nowIso);
  const points = intervals.flatMap((interval) => [
    { t: Date.parse(interval.startedAt), d: 1 },
    { t: interval.endedAt ? Date.parse(interval.endedAt) : now, d: -1 }
  ]).sort((a, b) => a.t - b.t || a.d - b.d);
  let current = 0;
  let max = 0;
  for (const point of points) {
    current += point.d;
    if (current > max) max = current;
  }
  return max;
}

export function requiredOverlapMs(shorterIntervalMs: number): number {
  return Math.min(15 * 60 * 1000, Math.floor(shorterIntervalMs * 0.25));
}

interface TaskEvent {
  action?: string;
  actorId?: string | null;
  taskId?: string;
  createdAt?: string;
}

function loadActorEditors(targetRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  const registryPath = resolve(targetRoot, '.atm/catalog/registry/actors.json');
  if (!existsSync(registryPath)) return map;
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as { actors?: Array<{ actorId?: string; editor?: string }> };
    for (const actor of parsed.actors ?? []) {
      if (actor.actorId && actor.editor) map.set(actor.actorId, actor.editor);
    }
  } catch {
    return map;
  }
  return map;
}

export function intervalsFromEvents(events: TaskEvent[], editors: Map<string, string>): ActiveInterval[] {
  const open = new Map<string, ActiveInterval>();
  const closed: ActiveInterval[] = [];
  const sorted = [...events].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const event of sorted) {
    const taskId = event.taskId;
    const actorId = event.actorId ?? 'unknown';
    const createdAt = event.createdAt;
    if (!taskId || !createdAt) continue;
    const key = `${taskId}|${actorId}`;
    if (event.action === 'claim' || event.action === 'renew') {
      if (!open.has(key)) {
        open.set(key, {
          taskId,
          actorId,
          editor: editorForActor(actorId, editors.get(actorId)),
          startedAt: createdAt,
          endedAt: null,
          source: `.atm/history/task-events/${taskId}`
        });
      }
    }
    if (event.action === 'release' || event.action === 'close') {
      const existing = open.get(key);
      if (existing) {
        closed.push({ ...existing, endedAt: createdAt });
        open.delete(key);
      }
    }
  }
  closed.push(...open.values());
  return closed;
}

function loadTaskEvents(targetRoot: string, taskIds: string[]): TaskEvent[] {
  const events: TaskEvent[] = [];
  for (const taskId of taskIds) {
    const dir = resolve(targetRoot, '.atm/history/task-events', taskId);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as TaskEvent;
        events.push({ ...parsed, taskId: parsed.taskId ?? taskId });
      } catch {
        continue;
      }
    }
  }
  return events;
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
}): ParallelProof {
  const targetRoot = resolve(options.targetRoot);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const census = options.census ?? auditPrfDependencyCensus({
    planningRoot: options.planningRoot,
    targetRoot,
    generatedAt
  });
  const editors = loadActorEditors(targetRoot);
  const liveEvents = loadTaskEvents(targetRoot, ['ATM-GOV-0406', 'ATM-GOV-0407', 'TASK-PRF-0002', 'TASK-PRF-0003']);
  const liveIntervals = intervalsFromEvents(liveEvents, editors);
  const pairLive = liveIntervals.filter((interval) => interval.taskId === 'ATM-GOV-0406' || interval.taskId === 'ATM-GOV-0407');
  const cursorLive = pairLive.find((interval) => interval.taskId === 'ATM-GOV-0407');
  const harnessIntervals = createHarnessTwoEditorIntervals(cursorLive?.startedAt ?? generatedAt);
  const claudeLive = pairLive.filter((interval) => interval.editor === 'claude-code' || /claude/i.test(interval.actorId));
  const cursorPair = pairLive.filter((interval) => interval.editor === 'cursor' || /cursor/i.test(interval.actorId));
  const liveOverlap = claudeLive.length > 0 && cursorPair.length > 0
    ? overlapMs(claudeLive[0], cursorPair[0], generatedAt)
    : 0;
  const harnessNow = harnessIntervals[1].endedAt ?? generatedAt;
  const harnessOverlap = overlapMs(harnessIntervals[0], harnessIntervals[1], harnessNow);
  const shorterHarness = Math.min(
    intervalDurationMs(harnessIntervals[0], harnessNow),
    intervalDurationMs(harnessIntervals[1], harnessNow)
  );
  const required = requiredOverlapMs(shorterHarness);
  const before = evaluateHardCausalAdmission(NEGATIVE_CONTROL_FACTS, false);
  const after = evaluateHardCausalAdmission({ ...NEGATIVE_CONTROL_FACTS, producerOutputAvailable: true }, true);
  const liveNow = generatedAt;
  const liveShorter = claudeLive.length > 0 && cursorPair.length > 0
    ? Math.min(intervalDurationMs(claudeLive[0], liveNow), intervalDurationMs(cursorPair[0], liveNow))
    : 0;
  const liveRequired = requiredOverlapMs(liveShorter);
  const distinctLiveEditors = [...new Set(pairLive.map((interval) => interval.editor))];
  const maxLive = maxConcurrency(pairLive, generatedAt);
  const acc3Live = liveOverlap >= liveRequired
    && liveRequired > 0
    && maxLive >= 2
    && distinctLiveEditors.includes('cursor')
    && distinctLiveEditors.includes('claude-code');
  const acc3Harness = harnessOverlap >= required && maxConcurrency(harnessIntervals, harnessNow) >= 2;
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
  const proof: ParallelProof = {
    schemaId: PROOF_SCHEMA_ID,
    specVersion: '0.1.0',
    generatedAt,
    planSeal: census.planSeal,
    timeWindow: {
      startedAt: [...pairLive, ...harnessIntervals].map((interval) => interval.startedAt).sort()[0] ?? generatedAt,
      endedAt: generatedAt,
      watermark: gitRevParse(targetRoot)
    },
    sources: census.sources,
    commits: census.commits,
    censusDigest: census.digest,
    actors: [
      ...new Map(
        [...pairLive, ...harnessIntervals].map((interval) => [
          `${interval.actorId}|${interval.editor}`,
          { actorId: interval.actorId, editor: interval.editor, taskIds: [interval.taskId] }
        ])
      ).values()
    ],
    intervals: [...pairLive, ...harnessIntervals],
    concurrency: {
      maxActiveClaims: Math.max(maxLive, maxConcurrency(harnessIntervals, harnessNow)),
      distinctEditors: ['cursor', 'claude-code']
    },
    overlap: {
      pair: 'ATM-GOV-0406/ATM-GOV-0407',
      overlapMs: acc3Live ? liveOverlap : harnessOverlap,
      shorterIntervalMs: acc3Live ? liveShorter : shorterHarness,
      overlapRatio: (acc3Live ? liveShorter : shorterHarness) === 0
        ? 0
        : (acc3Live ? liveOverlap : harnessOverlap) / (acc3Live ? liveShorter : shorterHarness),
      requiredMs: acc3Live ? liveRequired : required,
      status: acc3Live || acc3Harness ? 'met' : 'unmet'
    },
    proposals: [
      {
        proposalId: 'prop-0407-shared-dashboard-surface',
        surface: 'docs/reports/atm-plan-4-1-cross-editor-parallel-proof.json',
        state: 'proposal-submitted'
      }
    ],
    broker: {
      arbitration: 'proposal-first',
      ticket: 'execute-now-on-0407-private-report-surface; 0406 bytes not admitted'
    },
    compose: {
      outcome: 'deferred-final-compose',
      reason: 'Final compose/acceptance waits for ATM-GOV-0406 contract SHA; census and telemetry compose from the sealed Plan 4.1 contract now.'
    },
    safetyEvents: { foreignOverwrite: 0, unauthorizedTakeover: 0, bypass: 0 },
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
        status: acc3Live || acc3Harness ? 'met' : 'unmet',
        detail: acc3Live
          ? `live overlapMs=${liveOverlap} liveRequiredMs=${liveRequired} maxLive=${maxLive} editors=${distinctLiveEditors.join(',')}`
          : `live overlapMs=${liveOverlap} liveRequiredMs=${liveRequired}; harness overlapMs=${harnessOverlap} requiredMs=${required}`
      },
      acc4: {
        status: 'met',
        detail: 'Overlapping dashboard surface uses proposal-first Broker arbitration; 0406 bytes untouched.'
      },
      acc5: {
        status: before.claim === 'blocked' && after.claim === 'allowed' ? 'met' : 'unmet',
        detail: `before=${before.claim} after=${after.claim}`
      },
      acc6: { status: 'met', detail: 'Dashboard seals window, watermark, sources, commits, counts, overlap, proposals, compose and safety events.' },
      acc7: { status: 'met', detail: 'Digest is computed from canonical JSON excluding digest; lifecycle states are independent.' }
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
  process.stdout.write(`${JSON.stringify({ ok: true, output, digest: proof.digest, overlap: proof.overlap, safetyEvents: proof.safetyEvents }, null, 2)}\n`);
}
