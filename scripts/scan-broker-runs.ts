import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface BrokerOperationRunRecordEnvelope {
  readonly runId?: string | null;
  readonly planId?: string | null;
  readonly records?: readonly {
    readonly request_identity?: readonly string[] | null;
    readonly actor_ids?: readonly string[] | null;
    readonly request_files?: readonly string[] | null;
    readonly applied_files?: readonly string[] | null;
    readonly adapter_choice?: string | null;
    readonly lane_decision?: string | null;
    readonly merge_verdict?: string | null;
    readonly evidence_path?: string | null;
    readonly task_ids?: readonly string[] | null;
    readonly commit_sha?: string | null;
    readonly transaction_ids?: readonly string[] | null;
  }[] | null;
}

interface BrokerRunSummary {
  runId: string;
  planId: string;
  requestCount: number;
  actorCount: number;
  scenarioTags: string;
  requestIdentities: string;
  actors: string;
  taskHints: string;
  files: string;
  tasks: string;
  commits: string;
  transactions: string;
  adapter: string;
  lane: string;
  verdict: string;
  evidence: string;
}

type ArgMap = Record<string, string | boolean | undefined>;

function getArgs(argv: string[]): ArgMap {
  const args: ArgMap = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[arg] = true;
      continue;
    }
    args[arg] = next;
    index += 1;
  }
  return args;
}

function parseRunDir(runDir: string | boolean | undefined): string {
  if (typeof runDir === 'string' && runDir.trim()) {
    return path.resolve(runDir);
  }
  return path.resolve(
    process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
    '3KLife',
    'docs',
    'ai_atomic_framework',
    'broker-collision-evidence',
    'runs'
  );
}

function parseLogFile(logFile: string | boolean | undefined): string {
  if (typeof logFile === 'string' && logFile.trim()) {
    return path.resolve(logFile);
  }
  const envLogFile = process.env.ATM_BROKER_RUN_LOG_FILE;
  if (envLogFile) {
    return path.resolve(envLogFile);
  }
  // Fallback to a UTF-8-friendly default path that is stable across shells.
  return path.resolve(
    process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
    '3KLife',
    'docs',
    'ai_atomic_framework',
    'CID-Conflict-Run-Log.md'
  );
}

function parseJsonOutputFile(jsonOutputFile: string | boolean | undefined): string | null {
  if (typeof jsonOutputFile === 'string' && jsonOutputFile.trim()) {
    return path.resolve(jsonOutputFile);
  }
  return null;
}

function getUniqueSet(values: readonly string[] | undefined | null): readonly string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseScenarioTag(requestId: string): string | null {
  const parts = requestId.split(':');
  if (parts.length >= 2 && parts[0] === 'bench') {
    return parts[1] ?? null;
  }
  return null;
}

function parseTaskIdHint(requestId: string): string | null {
  const parts = requestId.split(':');
  for (const part of parts) {
    if (part.startsWith('TASK-')) {
      return part;
    }
  }
  return null;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function readExistingSeenRunIds(logPath: string): Set<string> {
  const seen = new Set<string>();
  try {
    const text = readFileSync(logPath, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith('|')) {
        continue;
      }
      const columns = line.slice(1).split('|').map((column) => column.trim());
      const runId = columns[0];
      if (runId && runId !== 'runId' && runId !== '---') {
        seen.add(runId);
      }
    }
  } catch {
    // Log file may not exist yet; this is expected.
  }
  return seen;
}

function summarizeRunEnvelope(filePath: string, envelope: BrokerOperationRunRecordEnvelope): BrokerRunSummary | null {
  if (typeof envelope.runId !== 'string' || !envelope.runId) {
    return null;
  }
  const runId = envelope.runId;
  const planId = typeof envelope.planId === 'string' ? envelope.planId : 'unknown';
  const records = Array.isArray(envelope.records) ? envelope.records : [];

  const requestIds = new Set<string>();
  const actorIds = new Set<string>();
  const files = new Set<string>();
  const taskIds = new Set<string>();
  const scenarioTags = new Set<string>();
  const taskHints = new Set<string>();
  const commits = new Set<string>();
  const transactions = new Set<string>();
  const adapters = new Set<string>();
  const lanes = new Set<string>();
  const verdicts = new Set<string>();
  for (const record of records) {
    for (const requestId of getUniqueSet(record.request_identity)) {
      requestIds.add(requestId);
      const scenarioTag = parseScenarioTag(requestId);
      if (scenarioTag) {
        scenarioTags.add(scenarioTag);
      }
      const taskHint = parseTaskIdHint(requestId);
      if (taskHint) {
        taskHints.add(taskHint);
      }
    }
    for (const actorId of getUniqueSet(record.actor_ids)) {
      actorIds.add(actorId);
    }
    for (const file of getUniqueSet(record.request_files)) {
      files.add(file);
    }
    for (const file of getUniqueSet(record.applied_files)) {
      files.add(file);
    }
    for (const taskId of getUniqueSet(record.task_ids)) {
      taskIds.add(taskId);
    }
    if (record.commit_sha) {
      commits.add(record.commit_sha);
    }
    for (const transactionId of getUniqueSet(record.transaction_ids)) {
      transactions.add(transactionId);
    }
    if (record.adapter_choice) {
      adapters.add(record.adapter_choice);
    }
    if (record.lane_decision) {
      lanes.add(record.lane_decision);
    }
    if (record.merge_verdict) {
      verdicts.add(record.merge_verdict);
    }
  }

  return {
    runId,
    planId,
    requestCount: requestIds.size || records.length,
    actorCount: actorIds.size || 1,
    scenarioTags: [...scenarioTags].join(',') || 'n/a',
    requestIdentities: [...requestIds].join(',') || 'n/a',
    actors: [...actorIds].join(',') || 'n/a',
    taskHints: [...taskHints].join(',') || 'n/a',
    files: [...files].join(',') || path.basename(filePath),
    tasks: [...taskIds].join(',') || 'n/a',
    commits: [...commits].join(',') || 'n/a',
    transactions: [...transactions].join(',') || 'n/a',
    adapter: adapters.size === 1 ? [...adapters][0] : [...adapters].join(',') || 'n/a',
    lane: lanes.size === 1 ? [...lanes][0] : [...lanes].join(',') || 'mixed',
    verdict: verdicts.size === 1 ? [...verdicts][0] : [...verdicts].join(',') || 'unknown',
    evidence: (envelope.records?.[0]?.evidence_path ?? filePath).replace(/\\/g, '/')
  };
}

function buildMarkdownSection(runs: readonly BrokerRunSummary[]) {
  if (runs.length === 0) {
    return '';
  }
  const rows = runs.map((run) => {
    return `| ${escapeMarkdownCell(run.runId)} | ${escapeMarkdownCell(run.planId)} | ${run.requestCount} | ${run.actorCount} | ${escapeMarkdownCell(run.scenarioTags)} | ${escapeMarkdownCell(run.requestIdentities)} | ${escapeMarkdownCell(run.actors)} | ${escapeMarkdownCell(run.taskHints)} | ${escapeMarkdownCell(run.files)} | ${escapeMarkdownCell(run.tasks)} | ${escapeMarkdownCell(run.commits)} | ${escapeMarkdownCell(run.transactions)} | ${escapeMarkdownCell(run.adapter)} | ${escapeMarkdownCell(run.lane)} | ${escapeMarkdownCell(run.verdict)} | ${escapeMarkdownCell(run.evidence)} |`;
  });
  return [
    '',
    '## Scan Result',
    `- Scan time: ${new Date().toISOString()}`,
    '| runId | planId | requestCount | actorCount | scenarioTags | requestIdentities | actors | taskHints | files | tasks | commits | transactions | adapter | lane | verdict | evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows
  ].join('\n') + '\n';
}

function buildEvidenceReport(runs: readonly BrokerRunSummary[]): string {
  if (runs.length === 0) {
    return '';
  }
  const rows = runs.map((run) => {
    const scenarios = run.scenarioTags === 'n/a' ? 'field/' : run.scenarioTags;
    return `| ${escapeMarkdownCell(run.runId)} | ${escapeMarkdownCell(scenarios)} | ${escapeMarkdownCell(run.taskHints || run.tasks)} | ${escapeMarkdownCell(run.actors)} | ${escapeMarkdownCell(run.files)} | ${escapeMarkdownCell(run.lane)} | ${escapeMarkdownCell(run.verdict)} |`;
  });
  return [
    '# Broker Evidence Report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    '',
    '| runId | scenario | task | actor | shared files | lane | verdict |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows
  ].join('\n') + '\n';
}

function writeEvidenceReport(reportOutput: string, runs: readonly BrokerRunSummary[]): void {
  mkdirSync(path.dirname(reportOutput), { recursive: true });
  writeFileSync(reportOutput, `${buildEvidenceReport(runs)}\n`, 'utf8');
}

function writeJsonIndex(jsonOutputFile: string, runDir: string, runs: readonly BrokerRunSummary[]): void {
  const payload = {
    schemaId: 'atm.brokerRunScanIndex.v1',
    specVersion: '0.1.0',
    scannedAt: new Date().toISOString(),
    runDir: runDir.replace(/\\/g, '/'),
    runs
  };
  mkdirSync(path.dirname(jsonOutputFile), { recursive: true });
  writeFileSync(jsonOutputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function loadEntries(runDir: string): BrokerRunSummary[] {
  const dirEntries = readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  const entries: BrokerRunSummary[] = [];
  for (const fileName of dirEntries) {
    const filePath = path.join(runDir, fileName);
    try {
      const raw = readFileSync(filePath, 'utf8');
      const envelope = JSON.parse(raw) as BrokerOperationRunRecordEnvelope;
      const summary = summarizeRunEnvelope(filePath, envelope);
      if (summary) {
        entries.push(summary);
      }
    } catch (error) {
      console.error(`[scan-broker-runs] skip invalid run file: ${filePath}`, error);
    }
  }
  return entries;
}

function main() {
  const args = getArgs(process.argv.slice(2));
  const runDir = parseRunDir(args['--run-dir'] || args['--run-evidence-dir']);
  const logFile = parseLogFile(args['--log-file']);
  const jsonOutputFile = parseJsonOutputFile(args['--json-output']);
  const reportOutput = parseJsonOutputFile(args['--report-output']);
  const compactLog = Boolean(args['--compact']);

  mkdirSync(runDir, { recursive: true });

  const entries = loadEntries(runDir);

  const dedupedByRun = new Map<string, BrokerRunSummary>();
  for (const entry of entries) {
    if (!dedupedByRun.has(entry.runId)) {
      dedupedByRun.set(entry.runId, entry);
    }
  }
  const sortedEntries = [...dedupedByRun.values()].sort((left, right) => left.runId.localeCompare(right.runId));

  if (jsonOutputFile) {
    writeJsonIndex(jsonOutputFile, runDir, sortedEntries);
  }

  if (compactLog) {
    if (reportOutput) {
      writeEvidenceReport(reportOutput, sortedEntries);
    }
    const existing = sortedEntries;
    const table = existing.length === 0 ? '' : buildMarkdownSection(existing);
    const content = '# CID Conflict Run Log\n' + table;
    mkdirSync(path.dirname(logFile), { recursive: true });
    writeFileSync(logFile, `${content}\n`, 'utf8');
    const jsonNote = jsonOutputFile ? ` and wrote index -> ${jsonOutputFile}` : '';
    console.log(`[scan-broker-runs] compacted ${existing.length} unique records -> ${logFile}${jsonNote}`);
    return;
  }

  const seenRunIds = readExistingSeenRunIds(logFile);
  const newRuns = sortedEntries.filter((entry) => !seenRunIds.has(entry.runId));

  if (newRuns.length === 0) {
    if (reportOutput) {
      writeEvidenceReport(reportOutput, sortedEntries);
    }
    const jsonNote = jsonOutputFile ? `; wrote index -> ${jsonOutputFile}` : '';
    const reportNote = reportOutput ? ` and wrote report -> ${reportOutput}` : '';
    console.log(`[scan-broker-runs] no new run records -> ${logFile}${jsonNote}${reportNote}`);
    return;
  }

  const section = buildMarkdownSection(newRuns);
  let content = '';
  try {
    content = readFileSync(logFile, 'utf8');
  } catch {
    // file does not exist yet
  }
  const heading = content.startsWith('# CID Conflict Run Log')
    ? content
    : '# CID Conflict Run Log\n';

  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, `${heading.trimEnd()}\n${section}\n`, 'utf8');
  if (reportOutput) {
    writeEvidenceReport(reportOutput, sortedEntries);
  }
  const jsonNote = jsonOutputFile ? ` and wrote index -> ${jsonOutputFile}` : '';
  const reportNote = reportOutput ? ` and wrote report -> ${reportOutput}` : '';
  console.log(`[scan-broker-runs] appended ${newRuns.length} new run records -> ${logFile}${jsonNote}${reportNote}`);
}

main();
