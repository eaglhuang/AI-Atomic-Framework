import assert from 'node:assert/strict';
import { existsSync, existsSync as exists, readFileSync, readFileSync as read, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ATM_GOV_0406_SOURCE_SHAS,
  ATM_GOV_0407_COMPOSE_SHA,
  ATM_GOV_0407_SOURCE_SHA,
  CENSUS_OUTPUT_RELATIVE,
  CENSUS_SCHEMA_ID,
  auditPrfDependencyCensus,
  gitCommitMeta,
  gitRevParse,
  resolvePlanningRoot,
  sealWithoutDigest,
  type Plan41Census
} from './audit-task-dependency-semantics.ts';
import type { ActiveInterval, ParallelProof } from './compile-cross-editor-parallel-proof.ts';

export const PROOF_SCHEMA_ID = 'atm.crossEditorParallelProof.v1' as const;
export const PROOF_OUTPUT_RELATIVE = 'docs/reports/atm-plan-4-1-cross-editor-parallel-proof.json';

export interface TaskEvent {
  action?: string;
  actorId?: string | null;
  taskId?: string;
  createdAt?: string;
  endedAt?: string;
  command?: string;
  source?: string;
}

const SCOPED_ACTIONS = new Set(['scope-amendment', 'evidence-run', 'validator']);
const CLOSER_ACTIONS = new Set(['commit', 'release', 'close']);

export function editorForActor(actorId: string, registryEditor?: string | null): string {
  if (registryEditor) return registryEditor;
  if (/cursor/i.test(actorId)) return 'cursor';
  if (/claude/i.test(actorId)) return 'claude-code';
  if (/codex/i.test(actorId)) return 'codex';
  return 'unknown';
}

function rangesOf(intervals: ActiveInterval[]): Array<[number, number]> {
  const sorted = intervals
    .filter((interval) => interval.endedAt)
    .map((interval) => [Date.parse(interval.startedAt), Date.parse(interval.endedAt!)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1]) merged.push([range[0], range[1]]);
    else last[1] = Math.max(last[1], range[1]);
  }
  return merged;
}

export function overlapMs(left: ActiveInterval, right: ActiveInterval, nowIso?: string): number {
  if (!left.endedAt || !right.endedAt) return 0;
  void nowIso;
  return Math.max(0, Math.min(Date.parse(left.endedAt), Date.parse(right.endedAt)) - Math.max(Date.parse(left.startedAt), Date.parse(right.startedAt)));
}

export function intervalDurationMs(interval: ActiveInterval, nowIso?: string): number {
  if (!interval.endedAt) return 0;
  void nowIso;
  return Math.max(0, Date.parse(interval.endedAt) - Date.parse(interval.startedAt));
}

export function requiredOverlapMs(shorterIntervalMs: number): number {
  return Math.min(15 * 60 * 1000, Math.floor(shorterIntervalMs * 0.25));
}

export function unionDurationMs(intervals: ActiveInterval[]): number {
  return rangesOf(intervals).reduce((sum, [start, end]) => sum + (end - start), 0);
}

export function unionOverlapMs(left: ActiveInterval[], right: ActiveInterval[]): number {
  const a = rangesOf(left);
  const b = rangesOf(right);
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < a.length && j < b.length) {
    total += Math.max(0, Math.min(a[i][1], b[j][1]) - Math.max(a[i][0], b[j][0]));
    if (a[i][1] < b[j][1]) i += 1;
    else j += 1;
  }
  return total;
}

export function maxDistinctConcurrency(intervals: ActiveInterval[], key: 'actorId' | 'editor', nowIso?: string): number {
  const points: Array<{ t: number; id: string; d: number }> = [];
  for (const interval of intervals) {
    const end = interval.endedAt ? Date.parse(interval.endedAt) : nowIso ? Date.parse(nowIso) : Number.NaN;
    if (!Number.isFinite(end)) continue;
    points.push({ t: Date.parse(interval.startedAt), id: interval[key], d: 1 });
    points.push({ t: end, id: interval[key], d: -1 });
  }
  points.sort((left, right) => left.t - right.t || left.d - right.d);
  const active = new Map<string, number>();
  let max = 0;
  for (const point of points) {
    const next = (active.get(point.id) ?? 0) + point.d;
    if (next <= 0) active.delete(point.id);
    else active.set(point.id, next);
    if (active.size > max) max = active.size;
  }
  return max;
}

export function maxConcurrency(intervals: ActiveInterval[], nowIso?: string): number {
  return maxDistinctConcurrency(intervals, 'actorId', nowIso);
}

export function evaluateScopedAcc3(scoped: ActiveInterval[]): ParallelProof['overlap'] {
  const cursor = scoped.filter((interval) => interval.editor === 'cursor' || /cursor/i.test(interval.actorId));
  const claude = scoped.filter((interval) => interval.editor === 'claude-code' || /claude/i.test(interval.actorId));
  const missing: string[] = [];
  if (cursor.length === 0) missing.push('no bounded scoped-work interval for cursor');
  if (claude.length === 0) missing.push('no bounded scoped-work interval for claude-code');
  if (cursor.some((interval) => !interval.endedAt) || claude.some((interval) => !interval.endedAt)) {
    missing.push('open scoped interval cannot use generatedAt as an end bound');
  }
  const overlap = unionOverlapMs(cursor, claude);
  const shorter = Math.min(unionDurationMs(cursor), unionDurationMs(claude));
  const required = requiredOverlapMs(shorter);
  if (shorter === 0) missing.push('scoped-work duration is zero; claim duration is not a substitute');
  if (overlap === 0 && missing.length === 0) missing.push('no overlapping scoped-work intervals between distinct editors');
  return {
    pair: 'ATM-GOV-0406/ATM-GOV-0407',
    basis: 'scoped-work',
    overlapMs: overlap,
    shorterIntervalMs: shorter,
    overlapRatio: shorter === 0 ? 0 : overlap / shorter,
    requiredMs: required,
    status: missing.length === 0 && required > 0 && overlap >= required ? 'met' : 'unproven',
    missing
  };
}

export function claimIntervalsFromEvents(events: TaskEvent[], editors: Map<string, string>): ActiveInterval[] {
  const open = new Map<string, ActiveInterval>();
  const closed: ActiveInterval[] = [];
  for (const event of [...events].sort((left, right) => Date.parse(String(left.createdAt)) - Date.parse(String(right.createdAt)))) {
    const taskId = event.taskId;
    const actorId = event.actorId ?? 'unknown';
    const createdAt = event.createdAt;
    if (!taskId || !createdAt) continue;
    const key = `${taskId}|${actorId}`;
    if (event.action === 'claim' && !open.has(key)) {
      open.set(key, { taskId, actorId, editor: editorForActor(actorId, editors.get(actorId)), startedAt: createdAt, endedAt: null, source: event.source ?? `.atm/history/task-events/${taskId}` });
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

export function intervalsFromEvents(events: TaskEvent[], editors: Map<string, string>): ActiveInterval[] {
  return claimIntervalsFromEvents(events, editors);
}

export function scopedIntervalsFromEvents(events: TaskEvent[], editors: Map<string, string>): ActiveInterval[] {
  const grouped = new Map<string, TaskEvent[]>();
  for (const event of events) {
    if (!event.taskId || !event.createdAt) continue;
    const key = `${event.taskId}|${event.actorId ?? 'unknown'}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  const intervals: ActiveInterval[] = [];
  for (const [key, list] of grouped) {
    const [taskId, actorId] = key.split('|');
    const editor = editorForActor(actorId, editors.get(actorId));
    const sorted = [...list].sort((left, right) => Date.parse(String(left.createdAt)) - Date.parse(String(right.createdAt)));
    const claimAt = sorted.find((event) => event.action === 'claim')?.createdAt;
    let burstStart: string | null = null;
    let lastEnd: string | null = null;
    let source = 'scoped-work';
    const emit = (endedAt: string) => {
      if (burstStart) intervals.push({ taskId, actorId, editor, startedAt: burstStart, endedAt, source });
      burstStart = null;
      lastEnd = null;
    };
    for (const event of sorted) {
      const action = String(event.action);
      if (SCOPED_ACTIONS.has(action)) {
        if (claimAt && Date.parse(String(event.createdAt)) < Date.parse(claimAt)) continue;
        if (!burstStart) burstStart = String(event.createdAt);
        lastEnd = event.endedAt ?? event.createdAt ?? null;
        source = event.source ?? action;
      } else if (CLOSER_ACTIONS.has(action) && burstStart) emit(String(event.createdAt));
    }
    if (burstStart && lastEnd) emit(lastEnd);
  }
  return intervals;
}

export function loadActorEditors(targetRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  const registryPath = resolve(targetRoot, '.atm/catalog/registry/actors.json');
  if (!exists(registryPath)) return map;
  try {
    const parsed = JSON.parse(read(registryPath, 'utf8')) as { actors?: Array<{ actorId?: string; editor?: string }> };
    for (const actor of parsed.actors ?? []) {
      if (actor.actorId && actor.editor) map.set(actor.actorId, actor.editor);
    }
  } catch {
    return map;
  }
  return map;
}

export function loadTaskEvents(targetRoot: string, taskIds: string[]): TaskEvent[] {
  const events: TaskEvent[] = [];
  for (const taskId of taskIds) {
    const dir = resolve(targetRoot, '.atm/history/task-events', taskId);
    if (!exists(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(read(resolve(dir, name), 'utf8')) as TaskEvent;
        events.push({ ...parsed, taskId: parsed.taskId ?? taskId, source: `.atm/history/task-events/${taskId}` });
      } catch {
        continue;
      }
    }
  }
  return events;
}

export function loadEvidenceScopedEvents(targetRoot: string, taskIds: string[]): TaskEvent[] {
  const events: TaskEvent[] = [];
  for (const taskId of taskIds) {
    const path = resolve(targetRoot, '.atm/history/evidence', `${taskId}.json`);
    if (!exists(path)) continue;
    try {
      const parsed = JSON.parse(read(path, 'utf8')) as { evidence?: Array<{ producedBy?: string; details?: { commandRuns?: Array<{ startedAt?: string; finishedAt?: string }> } }> };
      for (const item of parsed.evidence ?? []) {
        for (const run of item.details?.commandRuns ?? []) {
          if (!run.startedAt || !run.finishedAt) continue;
          events.push({ action: 'evidence-run', actorId: item.producedBy ?? 'unknown', taskId, createdAt: run.startedAt, endedAt: run.finishedAt, source: `.atm/history/evidence/${taskId}.json` });
        }
      }
    } catch {
      continue;
    }
  }
  return events;
}

export function loadSealedCommitEvents(targetRoot: string, taskIds: string[]): TaskEvent[] {
  const events: TaskEvent[] = [];
  for (const sha of new Set<string>([...ATM_GOV_0406_SOURCE_SHAS, ATM_GOV_0407_SOURCE_SHA, ATM_GOV_0407_COMPOSE_SHA, gitRevParse(targetRoot)])) {
    const meta = gitCommitMeta(targetRoot, sha);
    if (!meta?.committedAt) continue;
    const taskId = meta.body.match(/ATM-Task:\s*(ATM-GOV-\d+)/)?.[1];
    if (!taskId || !taskIds.includes(taskId)) continue;
    events.push({ action: 'commit', actorId: meta.body.match(/ATM-Actor:\s*(\S+)/)?.[1] ?? 'unknown', taskId, createdAt: new Date(meta.committedAt).toISOString(), source: `git:${sha}` });
  }
  return events;
}

function readDocument(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function fail(code: string, message: string): never {
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
  throw new Error(`${code}: ${message}`);
}

export function validateCensus(census: Plan41Census): string[] {
  const errors: string[] = [];
  if (census.schemaId !== CENSUS_SCHEMA_ID) errors.push('census schemaId mismatch');
  if (census.unclassifiedEdgeIds.length !== 0) errors.push('unclassified edges present');
  if (census.counts.unclassified !== 0) errors.push('unclassified count is not zero');
  if (census.counts.denominator !== census.edges.length) errors.push('denominator does not equal edge count');
  if (census.hardDependencyRate.numerator !== census.counts.hardCausal) errors.push('hard rate numerator mismatch');
  if (census.hardDependencyRate.quotaTargetRejected !== true) errors.push('quota gaming guard missing');
  if (census.digest !== sealWithoutDigest(census)) errors.push('census digest does not reproduce');
  for (const edge of census.edges) {
    if (edge.lifecycleType === 'hard-causal' && !edge.hardCausalProven) {
      errors.push(`${edge.edgeId} is hard-causal without six facts`);
    }
    if (edge.declaredAsHard && edge.hardCausalProven === false && edge.lifecycleType === 'hard-causal') {
      errors.push(`${edge.edgeId} treated unproven declaration as hard-causal`);
    }
    if (edge.planningAuthorityUnchanged !== true) errors.push(`${edge.edgeId} changed PRF planning authority`);
  }
  return errors;
}

export function validateProof(proof: ParallelProof, census: Plan41Census): string[] {
  const errors: string[] = [];
  if (proof.schemaId !== PROOF_SCHEMA_ID) errors.push('proof schemaId mismatch');
  if (proof.censusDigest !== census.digest) errors.push('proof censusDigest mismatch');
  if (!proof.timeWindow.startedAt || !proof.timeWindow.endedAt || !proof.timeWindow.watermark) {
    errors.push('proof time window incomplete');
  }
  if (proof.digest !== sealWithoutDigest(proof)) errors.push('proof digest does not reproduce');
  if (JSON.stringify(proof).includes('prop-0407-shared-dashboard-surface')) {
    errors.push('hardcoded false-green proposal id remains');
  }
  if (JSON.stringify(proof).includes('execute-now-on-0407-private-report-surface')) {
    errors.push('hardcoded false-green broker ticket remains');
  }
  const first = proof.proofWindows.find((window) => window.id === 'first-window');
  const second = proof.proofWindows.find((window) => window.id === 'second-window');
  if (!first || first.policyViolationCount !== 1 || first.foreignByteLoss !== 0 || first.cleanProofWindow !== false) {
    errors.push('first-window sealed safety counters are missing or mutated');
  }
  if (!second || second.source !== 'task-events-0406-0407-scan') {
    errors.push('second-window was not computed from task events');
  }
  if (proof.safetyEvents.policyViolationCount !== (first?.policyViolationCount ?? 0) + (second?.policyViolationCount ?? 0)) {
    errors.push('aggregated policyViolationCount does not equal window sum');
  }
  if (proof.broker.arbitration === 'broker-arbitration') {
    if (proof.acceptance.acc4.status !== 'met') errors.push('broker-arbitration requires ACC-4 met');
    if (!proof.broker.source.available) errors.push('broker-arbitration requires a validated source');
    if (proof.broker.source.schemaId !== 'atm.teamRun.v1') errors.push('arbitration schemaId mismatch');
    if (proof.broker.source.taskId !== 'ATM-GOV-0407') errors.push('arbitration taskId mismatch');
    if (proof.broker.source.verdict !== 'parallel-safe') errors.push('arbitration verdict mismatch');
    if (proof.broker.source.lane !== 'direct-brokered') errors.push('arbitration lane mismatch');
    if (!proof.broker.source.digest) errors.push('arbitration digest missing');
  } else if (proof.acceptance.acc4.status === 'met') {
    errors.push('ACC-4 cannot be met without validated Broker arbitration');
  }
  if (proof.hardCausalControls.beforeProducerOutput.claim !== 'blocked') {
    errors.push('hard-causal negative control did not block before producer output');
  }
  if (proof.hardCausalControls.afterProducerOutput.claim !== 'allowed') {
    errors.push('hard-causal negative control did not admit after producer output');
  }
  if (proof.hardCausalControls.nonHardClaimBeforeCompose !== 'allowed') {
    errors.push('non-hard control must start before compose/validation');
  }
  if (proof.lifecycle.frozenPublication.status !== 'not-started') {
    errors.push('frozen publication must remain not-started for this card');
  }
  if (proof.lifecycle.formalCloseout.status !== 'not-started') {
    errors.push('formal closeout must remain not-started for this card');
  }
  if (proof.overlap.basis !== 'scoped-work') errors.push('overlap.basis must be scoped-work');
  if (typeof proof.concurrency.maxScopedWork !== 'number') errors.push('maxScopedWork missing');
  if (!Array.isArray(proof.claimIntervals)) errors.push('claimIntervals missing');
  if (proof.intervals.some((interval) => String(interval.source).includes('harness'))) {
    errors.push('production intervals must not embed harness intervals');
  }
  if (proof.acceptance.acc3.status === 'met') {
    if (proof.overlap.status !== 'met') errors.push('ACC-3 met requires scoped-work overlap met');
    if (proof.concurrency.maxScopedWork < 2) errors.push('ACC-3 met requires scoped-work concurrency >= 2');
    if (proof.overlap.missing.length > 0) errors.push('ACC-3 met cannot retain missing scoped-work sources');
  }
  if (proof.acceptance.acc3.detail.includes('harness')) {
    errors.push('production ACC-3 must not use harness as a substitute');
  }
  return errors;
}

export function validatePlan41Artifacts(targetRoot: string): { ok: true; census: Plan41Census; proof: ParallelProof } {
  const censusPath = resolve(targetRoot, CENSUS_OUTPUT_RELATIVE);
  const proofPath = resolve(targetRoot, PROOF_OUTPUT_RELATIVE);
  if (!existsSync(censusPath) || !existsSync(proofPath)) {
    fail('ATM_PARALLEL_PROOF_INPUT_INVALID', 'Census or proof report is missing. Run the compile script first.');
  }
  const census = readDocument(censusPath) as unknown as Plan41Census;
  const proof = readDocument(proofPath) as unknown as ParallelProof;
  const errors = [...validateCensus(census), ...validateProof(proof, census)];
  if (errors.length > 0) {
    fail('ATM_PARALLEL_PROOF_THRESHOLD_UNMET', errors.join('; '));
  }
  return { ok: true, census, proof };
}

const invoked = process.argv[1] && /validate-cross-editor-parallel-proof\.ts$/.test(process.argv[1].replace(/\\/g, '/'));
if (invoked) {
  const targetRoot = resolve(process.cwd());
  if (process.argv.includes('--rebuild')) {
    const planningRoot = resolvePlanningRoot();
    const census = auditPrfDependencyCensus({ planningRoot, targetRoot });
    void import('./compile-cross-editor-parallel-proof.ts').then(({ compileParallelProof }) => {
      compileParallelProof({ targetRoot, planningRoot, census });
    });
  }
  const result = validatePlan41Artifacts(targetRoot);
  assert.equal(result.ok, true);
  process.stdout.write(`${JSON.stringify({ ok: true, censusDigest: result.census.digest, proofDigest: result.proof.digest }, null, 2)}\n`);
}
