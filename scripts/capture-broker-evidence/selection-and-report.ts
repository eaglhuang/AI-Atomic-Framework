import type { BrokerRunSummary, TaskArtifactSummary } from './types.ts';
import { readRunSummaries, readTeamRunSummaries } from './summaries.ts';

export function parseTaskIdsFromRows(rows: readonly BrokerRunSummary[]): string[] {
  const taskSet = new Set<string>();
  for (const row of rows) {
    for (const task of row.tasks.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      if (task === 'n/a') {
        continue;
      }
      taskSet.add(task);
    }
  }
  return [...taskSet];
}

export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

export function buildReport(rows: BrokerRunSummary[], taskArtifacts: TaskArtifactSummary[]): string {
  const runRows = rows.map((row) => `| ${escapeMarkdownCell(row.runId)} | ${escapeMarkdownCell(row.planId)} | ${escapeMarkdownCell(row.scenario)} | ${escapeMarkdownCell(row.tasks)} | ${escapeMarkdownCell(row.actors)} | ${escapeMarkdownCell(row.vendor)} | ${escapeMarkdownCell(row.lane)} | ${escapeMarkdownCell(row.verdict)} | ${escapeMarkdownCell(row.files)} | ${escapeMarkdownCell(row.identities)} | ${escapeMarkdownCell(row.commits)} | ${escapeMarkdownCell(row.transactions)} | ${escapeMarkdownCell(row.evidence)} | ${row.requiredFields.length === 0 ? 'ok' : row.requiredFields.join(';')} |`);
  const taskRows = taskArtifacts.map((entry) => `| ${escapeMarkdownCell(entry.taskId)} | ${escapeMarkdownCell(entry.closurePacket)} | ${escapeMarkdownCell(entry.teamRuns)} |`);

  return [
    '# Broker Capture Evidence Bundle',
    '',
    `- Scan at: ${new Date().toISOString()}`,
    `- Total runs: ${rows.length}`,
    `- Total tasks: ${taskArtifacts.length}`,
    '',
    '## Run Index',
    '| runId | planId | scenario | tasks | actors | vendor | lane | verdict | files | identities | commits | transactions | evidence | missingFields |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...runRows,
    '',
    '## Task Artifact Index',
    '| taskId | closurePacket | teamRuns |',
    '| --- | --- | --- |',
    ...taskRows
  ].join('\n') + '\n';
}

export function parseFilters(runFilters: string[], taskFilters: string[]): (row: BrokerRunSummary) => boolean {
  const runSet = new Set(runFilters);
  const taskSet = new Set(taskFilters);

  return (row: BrokerRunSummary) => {
    if (runSet.size > 0 && !runSet.has(row.runId)) {
      return false;
    }
    if (taskSet.size > 0) {
      const taskList = row.tasks.split(',').map((entry) => entry.trim()).filter(Boolean);
      return taskList.some((task) => taskSet.has(task));
    }
    return true;
  };
}

export function readRunSummariesByDirs(runDirs: string[], teamRunDirs: readonly string[] = []): Map<string, BrokerRunSummary> {
  const all = new Map<string, BrokerRunSummary>();
  for (const runDir of runDirs) {
    for (const row of readRunSummaries(runDir)) {
      if (!all.has(row.runId)) {
        all.set(row.runId, row);
      }
    }
  }
  for (const row of readTeamRunSummaries(teamRunDirs)) {
    if (!all.has(row.runId)) {
      all.set(row.runId, row);
    }
  }
  return all;
}

export function applyFilters(rows: Iterable<BrokerRunSummary>, predicate: (row: BrokerRunSummary) => boolean): BrokerRunSummary[] {
  const selected: BrokerRunSummary[] = [];
  for (const row of rows) {
    if (predicate(row)) {
      selected.push(row);
    }
  }
  return selected.sort((left, right) => left.runId.localeCompare(right.runId));
}

export function printHelp(): void {
  const lines = [
    'capture-broker-evidence',
    '',
    'Usage:',
    '  node --strip-types scripts/capture-broker-evidence.ts [--run-dir <dir> ...] [--team-run-dir <dir> ...] [--command <cmd> ...] [--await-new N] [--timeout-ms N] [--poll-ms N] [--settle-ms N] [--output-dir <dir>] [--run-ids a,b] [--task-ids TASK-...] [--atm-root <path>] [--strict]',
    '',
    'Examples:',
    '  # wait for 1 new run in default locations and emit a filtered evidence bundle',
    '  node --strip-types scripts/capture-broker-evidence.ts --await-new 1',
    '  # run multiple commands in parallel and capture new runs produced in the default broker run directory',
    '  node --strip-types scripts/capture-broker-evidence.ts --command "node task-a-cmd" --command "node task-b-cmd" --await-new 2',
    '',
    'Default behavior:',
    '- run-dir: current repo .atm/history/evidence/broker-runs (if exists), and only then',
    '  legacy fallback %USERPROFILE%/3KLife/docs/ai_atomic_framework/broker-collision-evidence/runs (if exists)',
    '- output-dir: <first-run-dir>/broker-capture',
    '- json output: <output-dir>/broker-capture.json',
    '- md output: <output-dir>/broker-capture.md',
    '- team-run-dir: optional atm.teamRun.v1 runtime directory; brokerLane is summarized as run rows',
    '- strict: true',
    ''
  ];
  console.log(lines.join('\n'));
}


