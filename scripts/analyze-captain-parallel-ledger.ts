import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type TaskTransition = {
  readonly taskId?: string;
  readonly action?: string;
  readonly actorId?: string | null;
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly createdAt?: string;
};

type TaskInterval = {
  readonly taskId: string;
  readonly actorId: string;
  readonly claimAt: string;
  readonly closeAt: string;
  readonly activeMs: number;
  readonly repairClosureCount: number;
};

type ActivityInterval = {
  readonly id: string;
  readonly actorId: string;
  readonly startAt: string;
  readonly endAt: string;
};

type LaneSessionEvent = {
  readonly schemaId?: string;
  readonly eventId?: string;
  readonly laneId?: string;
  readonly sequence?: number;
  readonly action?: string;
  readonly actorId?: string | null;
  readonly createdAt?: string;
  readonly details?: Record<string, unknown>;
};

type LaneEvidenceSummary = {
  readonly eventRoot: string;
  readonly eventCount: number;
  readonly laneCount: number;
  readonly actorCount: number;
  readonly taskCount: number;
  readonly actions: Record<string, number>;
  readonly firstEventAt: string | null;
  readonly lastEventAt: string | null;
  readonly maxEventsPerLane: number;
  readonly hasAppendOnlyHistory: boolean;
  readonly maxConcurrency: number;
  readonly overlapMs: number;
  readonly activeWindowMs: number;
  readonly concurrentLaneIds: readonly string[];
};

type WaveSummary = {
  readonly label: string;
  readonly taskPattern: string;
  readonly taskCount: number;
  readonly actorCount: number;
  readonly actors: readonly string[];
  readonly firstClaimAt: string | null;
  readonly lastCloseAt: string | null;
  readonly makespanMs: number;
  readonly activeMs: number;
  readonly activeWindowMs: number;
  readonly idleWindowMs: number;
  readonly overlapMs: number;
  readonly overlapRatio: number;
  readonly maxConcurrency: number;
  readonly averageConcurrency: number;
  readonly throughputTasksPerHour: number;
  readonly throughputTasksPerActiveHour: number;
  readonly repairClosureCount: number;
  readonly queueWaitMs: {
    readonly p50: number | null;
    readonly p95: number | null;
  };
};

type CaptainParallelLedgerAnalysis = {
  readonly schemaId: 'atm.captainParallelLedgerAnalysis.v1';
  readonly generatedAt: string;
  readonly source: {
    readonly eventRoot: string;
    readonly sessionEventRoot: string;
    readonly lockRoot: string;
    readonly completedRftIntervals: number;
  };
  readonly waves: readonly WaveSummary[];
  readonly laneEvidence: LaneEvidenceSummary;
  readonly runtimeFrameworkLockSnapshot: FrameworkLockSnapshot;
  readonly comparison: WaveComparison;
  readonly observabilityGaps: readonly ObservabilityGap[];
  readonly notes: readonly string[];
};

type FrameworkLockSnapshot = {
  readonly lockRoot: string;
  readonly lockCount: number;
  readonly actorCount: number;
  readonly freshLockCount: number;
  readonly staleLockCount: number;
  readonly earliestLockedAt: string | null;
  readonly latestHeartbeatAt: string | null;
  readonly maxSnapshotConcurrency: number;
  readonly caveat: string;
};

type FrameworkLockRecord = {
  readonly workItemId?: string;
  readonly actorId?: string;
  readonly lockedBy?: string;
  readonly lockedAt?: string;
  readonly heartbeatAt?: string;
  readonly ttlSeconds?: number;
};

type ObservabilityGap = {
  readonly lane: string;
  readonly status: 'not-observable-from-this-ledger' | 'snapshot-only';
  readonly impact: string;
};

type WaveComparison = {
  readonly makespanRatio: number | null;
  readonly throughputRatio: number | null;
  readonly activeTimeThroughputRatio: number | null;
  readonly activeWorkDensityRatio: number | null;
  readonly repairClosureDelta: number;
};

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const next = process.argv[i + 1];
  args.set(arg.slice(2), next && !next.startsWith('--') ? next : 'true');
}

const eventRoot = args.get('event-root') ?? '.atm/history/task-events';
const sessionEventRoot = args.get('session-event-root') ?? '.atm/history/session-events';
const lockRoot = args.get('lock-root') ?? '.atm/runtime/locks';
const reportPath = args.get('report') ?? null;
const tasks = loadTaskTransitions(eventRoot);
const intervals = buildIntervals(tasks).filter((interval) => /^TASK-RFT-\d{4}$/.test(interval.taskId));
const allIntervals = buildIntervals(tasks);
const laneEvents = loadLaneSessionEvents(sessionEventRoot);

const serial = summarizeWave('serial-baseline-rft-0020-0025', intervals, /^TASK-RFT-00(20|21|22|23|24|25)$/);
const parallel = summarizeWave('parallel-wave-rft-0030-0082', intervals, /^TASK-RFT-00(3\d|4\d|5\d|6\d|7\d|8[0-2])$/);
const latest = summarizeWave('latest-rft-0078-0082', intervals, /^TASK-RFT-00(78|79|80|81|82)$/);
const laneDogfood = summarizeWave('lane-dogfood-hard-overlap-0204-0001-0002-0003-0010', allIntervals, /^TASK-(CODEX-0204|LANE-0001|LANE-0002|LANE-0003|LANE-0010)$/);

const result: CaptainParallelLedgerAnalysis = {
  schemaId: 'atm.captainParallelLedgerAnalysis.v1',
  generatedAt: new Date().toISOString(),
  source: {
    eventRoot,
    sessionEventRoot,
    lockRoot,
    completedRftIntervals: intervals.length
  },
  waves: [serial, parallel, latest, laneDogfood],
  laneEvidence: summarizeLaneEvidence(sessionEventRoot, laneEvents),
  runtimeFrameworkLockSnapshot: summarizeFrameworkLocks(lockRoot),
  comparison: compare(serial, parallel),
  observabilityGaps: [
    {
      lane: 'framework-mode temp claims',
      status: 'snapshot-only',
      impact: 'Runtime lock files expose current or retained lock state, but do not provide an append-only historical claim/release window comparable to task-events.'
    },
    {
      lane: 'journaling/backlog lightweight writes',
      status: 'not-observable-from-this-ledger',
      impact: 'Journal routes that do not emit task claim/close transitions are excluded from overlap and throughput calculations.'
    }
  ],
  notes: [
    'The analysis is read-only and derives active windows from task-event claim -> close transitions.',
    'Repair-closure events are counted after close, but excluded from active window duration.',
    'Queue wait is inferred from reserve -> claim when both events exist; it is null when no reserving event is recorded.',
    'Active-time normalized throughput divides tasks by the union of active claim windows, excluding gaps with no active task claim.'
  ]
};

const json = JSON.stringify(result, null, 2);
console.log(json);
if (reportPath) {
  writeFileSync(reportPath, renderMarkdown(result), 'utf8');
}

function loadTaskTransitions(root: string): Map<string, TaskTransition[]> {
  const byTask = new Map<string, TaskTransition[]>();
  if (!existsSync(root)) return byTask;
  for (const taskDir of readdirSync(root, { withFileTypes: true })) {
    if (!taskDir.isDirectory()) continue;
    const taskPath = join(root, taskDir.name);
    for (const entry of readdirSync(taskPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const transition = JSON.parse(readFileSync(join(taskPath, entry.name), 'utf8')) as TaskTransition;
      const taskId = transition.taskId ?? taskDir.name;
      const list = byTask.get(taskId) ?? [];
      list.push(transition);
      byTask.set(taskId, list);
    }
  }
  for (const list of byTask.values()) {
    list.sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? ''));
  }
  return byTask;
}

function loadLaneSessionEvents(root: string): LaneSessionEvent[] {
  if (!existsSync(root)) return [];
  const events: LaneSessionEvent[] = [];
  for (const laneDir of readdirSync(root, { withFileTypes: true })) {
    if (!laneDir.isDirectory()) continue;
    const lanePath = join(root, laneDir.name);
    for (const entry of readdirSync(lanePath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(lanePath, entry.name), 'utf8')) as LaneSessionEvent;
        if (parsed.schemaId !== 'atm.laneSessionEvent.v1' || !parsed.laneId || !parsed.createdAt) continue;
        events.push(parsed);
      } catch {
        // Ignore malformed historical event files so one bad event cannot hide the rest of the ledger.
      }
    }
  }
  return events.sort((left, right) => Date.parse(left.createdAt ?? '') - Date.parse(right.createdAt ?? ''));
}

function summarizeLaneEvidence(root: string, events: readonly LaneSessionEvent[]): LaneEvidenceSummary {
  const actions: Record<string, number> = {};
  const lanes = new Set<string>();
  const actors = new Set<string>();
  const tasks = new Set<string>();
  const perLane = new Map<string, number>();
  for (const event of events) {
    const action = event.action ?? 'event';
    actions[action] = (actions[action] ?? 0) + 1;
    if (event.laneId) {
      lanes.add(event.laneId);
      perLane.set(event.laneId, (perLane.get(event.laneId) ?? 0) + 1);
    }
    if (event.actorId) actors.add(event.actorId);
    const taskId = typeof event.details?.taskId === 'string' ? event.details.taskId : null;
    if (taskId) tasks.add(taskId);
  }
  const createdAts = events.map((event) => event.createdAt).filter((value): value is string => Boolean(value));
  const concurrency = summarizeLaneSessionConcurrency(events);
  return {
    eventRoot: root,
    eventCount: events.length,
    laneCount: lanes.size,
    actorCount: actors.size,
    taskCount: tasks.size,
    actions,
    firstEventAt: minIso(createdAts),
    lastEventAt: maxIso(createdAts),
    maxEventsPerLane: perLane.size ? Math.max(...perLane.values()) : 0,
    hasAppendOnlyHistory: events.length > 0,
    maxConcurrency: concurrency.maxConcurrency,
    overlapMs: concurrency.overlapMs,
    activeWindowMs: concurrency.activeWindowMs,
    concurrentLaneIds: concurrency.concurrentLaneIds
  };
}

/** Light overlap metric over lane-session event windows (first→last event per lane). */
function summarizeLaneSessionConcurrency(events: readonly LaneSessionEvent[]): {
  readonly maxConcurrency: number;
  readonly overlapMs: number;
  readonly activeWindowMs: number;
  readonly concurrentLaneIds: readonly string[];
} {
  const byLane = new Map<string, { startAt: string; endAt: string; actorId: string }>();
  for (const event of events) {
    if (!event.laneId || !event.createdAt) continue;
    const existing = byLane.get(event.laneId);
    if (!existing) {
      byLane.set(event.laneId, {
        startAt: event.createdAt,
        endAt: event.createdAt,
        actorId: event.actorId ?? 'unknown'
      });
      continue;
    }
    if (Date.parse(event.createdAt) < Date.parse(existing.startAt)) existing.startAt = event.createdAt;
    if (Date.parse(event.createdAt) > Date.parse(existing.endAt)) existing.endAt = event.createdAt;
  }
  const intervals: ActivityInterval[] = [...byLane.entries()]
    .filter(([, window]) => Date.parse(window.endAt) > Date.parse(window.startAt))
    .map(([laneId, window]) => ({
      id: laneId,
      actorId: window.actorId,
      startAt: window.startAt,
      endAt: window.endAt
    }));
  const stats = intervalConcurrencyStats(intervals);
  return {
    maxConcurrency: stats.maxConcurrency,
    overlapMs: stats.overlapMs,
    activeWindowMs: stats.activeWindowMs,
    concurrentLaneIds: intervals.map((interval) => interval.id).sort()
  };
}

function buildIntervals(tasks: Map<string, TaskTransition[]>): TaskInterval[] {
  const intervals: TaskInterval[] = [];
  for (const [taskId, events] of tasks) {
    const claim = events.find((event) => event.action === 'claim' && event.createdAt);
    const close = events.find((event) => (event.action === 'close' || event.toStatus === 'done') && event.createdAt);
    if (!claim?.createdAt || !close?.createdAt) continue;
    const claimMs = Date.parse(claim.createdAt);
    const closeMs = Date.parse(close.createdAt);
    if (!Number.isFinite(claimMs) || !Number.isFinite(closeMs) || closeMs < claimMs) continue;
    intervals.push({
      taskId,
      actorId: claim.actorId ?? 'unknown',
      claimAt: claim.createdAt,
      closeAt: close.createdAt,
      activeMs: closeMs - claimMs,
      repairClosureCount: events.filter((event) => event.action === 'repair-closure').length
    });
  }
  intervals.sort((a, b) => Date.parse(a.claimAt) - Date.parse(b.claimAt));
  return intervals;
}

function summarizeWave(label: string, allIntervals: readonly TaskInterval[], pattern: RegExp): WaveSummary {
  const selected = allIntervals.filter((interval) => pattern.test(interval.taskId));
  const actors = [...new Set(selected.map((interval) => interval.actorId))].sort();
  const start = selected.length ? Math.min(...selected.map((interval) => Date.parse(interval.claimAt))) : 0;
  const end = selected.length ? Math.max(...selected.map((interval) => Date.parse(interval.closeAt))) : 0;
  const makespanMs = selected.length ? end - start : 0;
  const activeMs = selected.reduce((sum, interval) => sum + interval.activeMs, 0);
  const concurrency = concurrencyStats(selected);
  const waits = queueWaits(selected.map((interval) => interval.taskId));
  return {
    label,
    taskPattern: String(pattern),
    taskCount: selected.length,
    actorCount: actors.length,
    actors,
    firstClaimAt: selected.length ? new Date(start).toISOString() : null,
    lastCloseAt: selected.length ? new Date(end).toISOString() : null,
    makespanMs,
    activeMs,
    activeWindowMs: concurrency.activeWindowMs,
    idleWindowMs: Math.max(0, makespanMs - concurrency.activeWindowMs),
    overlapMs: concurrency.overlapMs,
    overlapRatio: makespanMs > 0 ? concurrency.overlapMs / makespanMs : 0,
    maxConcurrency: concurrency.maxConcurrency,
    averageConcurrency: makespanMs > 0 ? activeMs / makespanMs : 0,
    throughputTasksPerHour: makespanMs > 0 ? selected.length / (makespanMs / 3_600_000) : 0,
    throughputTasksPerActiveHour: concurrency.activeWindowMs > 0 ? selected.length / (concurrency.activeWindowMs / 3_600_000) : 0,
    repairClosureCount: selected.reduce((sum, interval) => sum + interval.repairClosureCount, 0),
    queueWaitMs: {
      p50: percentile(waits, 0.5),
      p95: percentile(waits, 0.95)
    }
  };
}

function concurrencyStats(intervals: readonly TaskInterval[]): { activeWindowMs: number; overlapMs: number; maxConcurrency: number } {
  return intervalConcurrencyStats(intervals.map((interval) => ({
    id: interval.taskId,
    actorId: interval.actorId,
    startAt: interval.claimAt,
    endAt: interval.closeAt
  })));
}

function intervalConcurrencyStats(intervals: readonly ActivityInterval[]): { activeWindowMs: number; overlapMs: number; maxConcurrency: number } {
  const points: Array<{ time: number; delta: number }> = [];
  for (const interval of intervals) {
    points.push({ time: Date.parse(interval.startAt), delta: 1 });
    points.push({ time: Date.parse(interval.endAt), delta: -1 });
  }
  points.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0;
  let previous: number | null = null;
  let activeWindowMs = 0;
  let overlapMs = 0;
  let maxConcurrency = 0;
  for (const point of points) {
    if (previous !== null && point.time > previous) {
      if (active >= 1) activeWindowMs += point.time - previous;
      if (active >= 2) overlapMs += point.time - previous;
    }
    active += point.delta;
    maxConcurrency = Math.max(maxConcurrency, active);
    previous = point.time;
  }
  return { activeWindowMs, overlapMs, maxConcurrency };
}

function queueWaits(taskIds: readonly string[]): number[] {
  const waits: number[] = [];
  const taskIdSet = new Set(taskIds);
  const byTask = loadTaskTransitions(eventRoot);
  for (const [taskId, events] of byTask) {
    if (!taskIdSet.has(taskId)) continue;
    const reserve = events.find((event) => event.action === 'reserve' && event.createdAt);
    const claim = events.find((event) => event.action === 'claim' && event.createdAt);
    if (!reserve?.createdAt || !claim?.createdAt) continue;
    const wait = Date.parse(claim.createdAt) - Date.parse(reserve.createdAt);
    if (Number.isFinite(wait) && wait >= 0) waits.push(wait);
  }
  return waits.sort((a, b) => a - b);
}

function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const index = Math.ceil(values.length * p) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))];
}

function compare(serial: WaveSummary, parallel: WaveSummary): WaveComparison {
  return {
    makespanRatio: serial.makespanMs > 0 ? parallel.makespanMs / serial.makespanMs : null,
    throughputRatio: serial.throughputTasksPerHour > 0 ? parallel.throughputTasksPerHour / serial.throughputTasksPerHour : null,
    activeTimeThroughputRatio: serial.throughputTasksPerActiveHour > 0 ? parallel.throughputTasksPerActiveHour / serial.throughputTasksPerActiveHour : null,
    activeWorkDensityRatio: serial.averageConcurrency > 0 ? parallel.averageConcurrency / serial.averageConcurrency : null,
    repairClosureDelta: parallel.repairClosureCount - serial.repairClosureCount
  };
}

function summarizeFrameworkLocks(lockRoot: string): FrameworkLockSnapshot {
  if (!existsSync(lockRoot)) {
    return emptyFrameworkLockSnapshot(lockRoot, 'Framework temp claim history is not observable because the runtime lock directory is missing.');
  }
  const now = Date.now();
  const records: FrameworkLockRecord[] = [];
  for (const entry of readdirSync(lockRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^ATM-FRAMEWORK-TEMP-.*\.lock\.json$/.test(entry.name)) continue;
    records.push(JSON.parse(readFileSync(join(lockRoot, entry.name), 'utf8')) as FrameworkLockRecord);
  }
  if (!records.length) {
    return emptyFrameworkLockSnapshot(lockRoot, 'No retained framework temp lock files are currently observable.');
  }
  const intervals = records.flatMap((record): ActivityInterval[] => {
    if (!record.lockedAt || !record.heartbeatAt) return [];
    const start = Date.parse(record.lockedAt);
    const end = Date.parse(record.heartbeatAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    return [{
      id: record.workItemId ?? record.actorId ?? record.lockedBy ?? 'unknown-framework-lock',
      actorId: record.actorId ?? record.lockedBy ?? 'unknown',
      startAt: record.lockedAt,
      endAt: record.heartbeatAt
    }];
  });
  const freshLockCount = records.filter((record) => {
    if (!record.heartbeatAt || typeof record.ttlSeconds !== 'number') return false;
    return now - Date.parse(record.heartbeatAt) <= record.ttlSeconds * 1000;
  }).length;
  const stats = intervalConcurrencyStats(intervals);
  const lockedAts = records.map((record) => record.lockedAt).filter((value): value is string => Boolean(value));
  const heartbeatAts = records.map((record) => record.heartbeatAt).filter((value): value is string => Boolean(value));
  return {
    lockRoot,
    lockCount: records.length,
    actorCount: new Set(records.map((record) => record.actorId ?? record.lockedBy ?? 'unknown')).size,
    freshLockCount,
    staleLockCount: records.length - freshLockCount,
    earliestLockedAt: minIso(lockedAts),
    latestHeartbeatAt: maxIso(heartbeatAts),
    maxSnapshotConcurrency: stats.maxConcurrency,
    caveat: 'This is a runtime snapshot over retained lock files, not an append-only framework claim history; it must not be merged into task-event throughput.'
  };
}

function emptyFrameworkLockSnapshot(lockRoot: string, caveat: string): FrameworkLockSnapshot {
  return {
    lockRoot,
    lockCount: 0,
    actorCount: 0,
    freshLockCount: 0,
    staleLockCount: 0,
    earliestLockedAt: null,
    latestHeartbeatAt: null,
    maxSnapshotConcurrency: 0,
    caveat
  };
}

function minIso(values: readonly string[]): string | null {
  if (!values.length) return null;
  return new Date(Math.min(...values.map(Date.parse))).toISOString();
}

function maxIso(values: readonly string[]): string | null {
  if (!values.length) return null;
  return new Date(Math.max(...values.map(Date.parse))).toISOString();
}

function renderMarkdown(result: CaptainParallelLedgerAnalysis): string {
  const serial = result.waves.find((wave: WaveSummary) => wave.label === 'serial-baseline-rft-0020-0025');
  const parallel = result.waves.find((wave: WaveSummary) => wave.label === 'parallel-wave-rft-0030-0082');
  const laneDogfood = result.waves.find((wave: WaveSummary) => wave.label === 'lane-dogfood-hard-overlap-0204-0001-0002-0003-0010');
  const interpretation = parallel && parallel.maxConcurrency >= 2
    ? 'The task-event ledger contains overlapping active claim windows, so it directly supports task-level captain parallelism for this wave.'
    : 'The task-event ledger does not show overlapping active claim windows for the main RFT wave. This supports the safety story, especially zero repair-closure, but it does not yet prove task-level makespan acceleration.';
  const rows = result.waves.map((wave: WaveSummary) => [
    wave.label,
    String(wave.taskCount),
    String(wave.actorCount),
    formatMs(wave.makespanMs),
    formatMs(wave.activeWindowMs),
    formatNumber(wave.throughputTasksPerHour),
    formatNumber(wave.throughputTasksPerActiveHour),
    formatPct(wave.overlapRatio),
    formatNumber(wave.averageConcurrency),
    String(wave.maxConcurrency),
    String(wave.repairClosureCount)
  ]);
  return [
    '# Captain Parallel Ledger Analysis',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    'This report mines `.atm/history/task-events` as a read-only ledger to measure task-level captain parallelism. It deliberately measures inter-task concurrency, not intra-task Team worker fan-out.',
    '',
    '| Wave | Tasks | Actors | Makespan | Active window | Tasks/hour | Tasks/active hour | Overlap ratio | Avg concurrency | Max concurrency | Repair closures |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map((row: readonly string[]) => `| ${row.join(' | ')} |`),
    '',
    '## Interpretation',
    '',
    interpretation,
    '',
    serial && parallel
      ? `Serial baseline repair closures: ${serial.repairClosureCount}; RFT parallel-era repair closures: ${parallel.repairClosureCount}.`
      : '',
    '',
    '## Comparison',
    '',
    `- Throughput ratio, parallel wave vs serial baseline: ${formatNullable(result.comparison.throughputRatio)}x`,
    `- Active-time throughput ratio: ${formatNullable(result.comparison.activeTimeThroughputRatio)}x`,
    `- Active work density ratio: ${formatNullable(result.comparison.activeWorkDensityRatio)}x`,
    `- Repair-closure delta: ${result.comparison.repairClosureDelta}`,
    '',
    '## Lane Session Evidence',
    '',
    `- Session event root: \`${result.laneEvidence.eventRoot}\``,
    `- Lane events: ${result.laneEvidence.eventCount}; lanes: ${result.laneEvidence.laneCount}; actors: ${result.laneEvidence.actorCount}; task-linked events: ${result.laneEvidence.taskCount}.`,
    `- Lane-session event overlap concurrency: max ${result.laneEvidence.maxConcurrency}, overlap ${formatMs(result.laneEvidence.overlapMs)}, active window ${formatMs(result.laneEvidence.activeWindowMs)}.`,
    `- Event actions: ${Object.entries(result.laneEvidence.actions).map(([action, count]) => `${action}=${count}`).join(', ') || 'none'}.`,
    laneDogfood
      ? `- Dogfood overlap sample \`TASK-CODEX-0204\` + \`TASK-LANE-0001/0002/0003/0010\`: max concurrency ${laneDogfood.maxConcurrency}, overlap ${formatMs(laneDogfood.overlapMs)}.`
      : '',
    '',
    '## Observability Gaps',
    '',
    `- Framework temp claims: ${result.runtimeFrameworkLockSnapshot.lockCount} retained runtime lock files observed; ${result.runtimeFrameworkLockSnapshot.freshLockCount} fresh, ${result.runtimeFrameworkLockSnapshot.staleLockCount} stale. ${result.runtimeFrameworkLockSnapshot.caveat}`,
    ...result.observabilityGaps.map((gap) => `- ${gap.lane}: ${gap.status}. ${gap.impact}`),
    '',
    '## Method',
    '',
    '- Active window: first `claim` transition to first `close` / `toStatus: done` transition per task.',
    '- Serial baseline: `TASK-RFT-0020` through `TASK-RFT-0025`.',
    '- Parallel wave: `TASK-RFT-0030` through `TASK-RFT-0082`.',
    '- Repair closure is counted separately and excluded from active window duration.',
    '- Active-time normalized throughput uses the union of active claim windows and removes idle gaps with no active claim.',
    '- Framework temp locks are reported as an observability snapshot only; they are not used as historical task-level overlap evidence.',
    ''
  ].join('\n');
}

function formatMs(ms: number): string {
  return `${formatNumber(ms / 3_600_000)}h`;
}

function formatPct(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function formatNullable(value: number | null): string {
  return value === null ? 'n/a' : formatNumber(value);
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}
