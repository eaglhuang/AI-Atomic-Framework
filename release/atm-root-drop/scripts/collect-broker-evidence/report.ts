import type { BrokerRunSummary, TaskArtifactSummary } from './types.ts';

export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

export function buildReport(rows: BrokerRunSummary[], taskArtifacts: TaskArtifactSummary[]): string {
  const runRows = rows.map((row) => `| ${escapeMarkdownCell(row.runId)} | ${escapeMarkdownCell(row.planId)} | ${escapeMarkdownCell(row.scenario)} | ${escapeMarkdownCell(row.tasks)} | ${escapeMarkdownCell(row.actors)} | ${escapeMarkdownCell(row.vendor)} | ${escapeMarkdownCell(row.lane)} | ${escapeMarkdownCell(row.verdict)} | ${escapeMarkdownCell(row.files)} | ${escapeMarkdownCell(row.identities)} | ${escapeMarkdownCell(row.commits)} | ${escapeMarkdownCell(row.transactions)} | ${escapeMarkdownCell(row.evidence)} |`);
  const taskRows = taskArtifacts.map((entry) => `| ${escapeMarkdownCell(entry.taskId)} | ${escapeMarkdownCell(entry.closurePacket)} | ${escapeMarkdownCell(entry.teamRuns)} |`);

  return [
    '# Broker Evidence Bundle',
    '',
    `- Scan at: ${new Date().toISOString()}`,
    `- Total runs: ${rows.length}`,
    `- Total tasks: ${taskArtifacts.length}`,
    '',
    '## Run Index',
    '| runId | planId | scenario | tasks | actors | vendor | lane | verdict | files | identities | commits | transactions | evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...runRows,
    '',
    '## Task Artifact Index',
    '| taskId | closurePacket | teamRuns |',
    '| --- | --- | --- |',
    ...taskRows
  ].join('\n') + '\n';
}

