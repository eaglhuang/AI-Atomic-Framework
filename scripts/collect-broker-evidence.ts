import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface BrokerEnvelopeRecord {
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
}

interface BrokerEnvelope {
  readonly schemaId?: string | null;
  readonly runId?: string | null;
  readonly planId?: string | null;
  readonly records?: readonly BrokerEnvelopeRecord[] | null;
}

interface BrokerMutationEvidence {
  readonly requestId?: string | null;
  readonly actorId?: string | null;
  readonly adapterId?: string | null;
  readonly filePath?: string | null;
  readonly mergeDecision?: string | null;
  readonly verdict?: string | null;
  readonly transactionId?: string | null;
  readonly baseHash?: string | null;
  readonly resultHash?: string | null;
}

interface BrokerExperimentRun {
  readonly runId?: string | null;
  readonly plan?: { readonly planId?: string | null };
  readonly mutationEvidence?: readonly BrokerMutationEvidence[] | null;
  readonly runEvidencePath?: string | null;
}

interface TeamRun {
  readonly schemaId?: string | null;
  readonly teamRunId?: string | null;
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly planId?: string | null;
  readonly brokerLane?: unknown;
}

interface RegistryAdmission {
  readonly trigger?: string | null;
  readonly state?: string | null;
}

interface RegistryActiveIntent {
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly baseCommit?: string | null;
  readonly intentId?: string | null;
  readonly leaseEpoch?: number | null;
  readonly resourceKeys?: {
    readonly files?: readonly string[] | null;
  } | null;
  readonly admission?: RegistryAdmission | null;
}

interface BrokerRegistryDocument {
  readonly schemaId?: string | null;
  readonly activeIntents?: readonly RegistryActiveIntent[] | null;
}

function deriveAdmissionStateFromBrokerLane(brokerLane: unknown): string | null {
  const brokerLaneObject = brokerLane && typeof brokerLane === 'object'
    ? brokerLane as Record<string, unknown>
    : null;
  const admission = brokerLaneObject?.admission;
  return firstStringByKey(admission, new Set(['state', 'admissionState']));
}

interface BrokerRunSummary {
  runId: string;
  planId: string;
  scenario: string;
  tasks: string;
  actors: string;
  files: string;
  vendor: string;
  lane: string;
  verdict: string;
  commits: string;
  transactions: string;
  identities: string;
  evidence: string;
}

interface TaskArtifactSummary {
  taskId: string;
  closurePacket: string;
  teamRuns: string;
}

type ArgMap = Record<string, string | boolean | undefined>;

type StringSet = ReadonlySet<string>;

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

function parseDefaultRunDir(value: string | boolean | undefined): string {
  if (typeof value === 'string' && value.trim()) {
    const explicitDir = path.resolve(value);
    if (!existsSync(explicitDir)) {
      throw new Error(`run directory does not exist: ${explicitDir}`);
    }
    return explicitDir;
  }
  const repoFallback = path.join(process.cwd(), '.atm', 'history', 'evidence', 'broker-runs');
  const externalFallback = path.resolve(
    process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
    '3KLife',
    'docs',
    'ai_atomic_framework',
    'broker-collision-evidence',
    'runs'
  );
  if (existsSync(repoFallback)) {
    return repoFallback;
  }
  if (existsSync(externalFallback)) {
    return externalFallback;
  }
  throw new Error(`Unable to find run directory. Checked: ${repoFallback}, ${externalFallback}`);
}

function parseTeamRunDir(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const dir = path.resolve(value);
  if (!existsSync(dir)) {
    throw new Error(`team-run directory does not exist: ${dir}`);
  }
  return dir;
}

function parseOutputDir(value: string | boolean | undefined, runDir: string): string {
  if (typeof value === 'string' && value.trim()) {
    return path.resolve(value);
  }
  return path.join(path.dirname(runDir), 'broker-evidence-bundle');
}

function printHelp(): void {
  const lines = [
    'collect-broker-evidence',
    '',
    'Usage:',
    '  node --strip-types scripts/collect-broker-evidence.ts [--run-dir <dir>] [--team-run-dir <dir>] [--output-dir <dir>] [--atm-root <path>] [--run-ids a,b] [--task-ids TASK-...]',
    '',
    'Default behavior:',
    '- run-dir: .atm/history/evidence/broker-runs if exists, otherwise',
    '  %USERPROFILE%\\3KLife\\docs\\ai_atomic_framework\\broker-collision-evidence\\runs',
    '- output-dir: <run-dir-parent>/broker-evidence-bundle',
    '- Output files: broker-evidence-bundle.json and broker-evidence-bundle.md in output-dir',
    '- team-run-dir: optional atm.teamRun.v1 runtime directory; brokerLane is summarized as run rows',
    ''
  ];
  console.log(lines.join('\n'));
}

function parseCsvOption(value: string | boolean | undefined): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  return value.split(',').map((value) => value.trim()).filter(Boolean);
}

function parseOutputFile(value: string | boolean | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return path.resolve(value);
  }
  return fallback;
}

function uniq(values: readonly string[] | undefined | null): StringSet {
  return new Set(Array.isArray(values) ? values.filter((entry): entry is string => !!entry).map((entry) => entry.trim()).filter(Boolean) : []);
}

function collectTags(requestId: string): { scenarios: string[]; tasks: string[] } {
  const parts = requestId.split(':');
  const result = { scenarios: new Set<string>(), tasks: new Set<string>() };
  if (parts.length >= 2 && parts[0] === 'bench') {
    result.scenarios.add(parts[1] ?? 'n/a');
  }
  for (const part of parts) {
    if (part.startsWith('TASK-')) {
      result.tasks.add(part);
    }
  }
  return {
    scenarios: [...result.scenarios],
    tasks: [...result.tasks]
  };
}

function toCsv(values: StringSet): string {
  return [...values].sort((left, right) => left.localeCompare(right)).join(',') || 'n/a';
}

function addStringValue(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    target.add(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      addStringValue(target, item);
    }
  }
}

function collectObjectStringsByKey(value: unknown, keys: ReadonlySet<string>, target: Set<string>): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectStringsByKey(item, keys, target);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key)) {
      addStringValue(target, entry);
    }
    collectObjectStringsByKey(entry, keys, target);
  }
}

function firstStringByKey(value: unknown, keys: ReadonlySet<string>): string | null {
  const values = new Set<string>();
  collectObjectStringsByKey(value, keys, values);
  return [...values][0] ?? null;
}

function summarizeEnvelopeRecord(run: BrokerEnvelope, runSource: string): BrokerRunSummary | null {
  if (typeof run.runId !== 'string' || !run.runId) {
    return null;
  }

  const records = Array.isArray(run.records) ? run.records : [];
  const identities = new Set<string>();
  const actors = new Set<string>();
  const files = new Set<string>();
  const tasks = new Set<string>();
  const adapters = new Set<string>();
  const lanes = new Set<string>();
  const verdicts = new Set<string>();
  const commits = new Set<string>();
  const tx = new Set<string>();

  const scenarios = new Set<string>();

  for (const record of records) {
    for (const requestIdentity of uniq(record.request_identity)) {
      identities.add(requestIdentity);
      const split = collectTags(requestIdentity);
      split.scenarios.forEach((value) => scenarios.add(value));
      split.tasks.forEach((value) => tasks.add(value));
    }

    for (const actorId of uniq(record.actor_ids)) {
      actors.add(actorId);
    }

    for (const file of uniq(record.request_files)) {
      files.add(file);
    }

    for (const file of uniq(record.applied_files)) {
      files.add(file);
    }

    for (const taskId of uniq(record.task_ids)) {
      tasks.add(taskId);
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
    if (record.commit_sha) {
      commits.add(record.commit_sha);
    }
    for (const transaction of uniq(record.transaction_ids)) {
      tx.add(transaction);
    }
  }

  const evidenceValue = (records[0]?.evidence_path?.trim() ?? runSource).replace(/\\/g, '/');

  return {
    runId: run.runId,
    planId: typeof run.planId === 'string' ? run.planId : 'unknown',
    scenario: [...scenarios].sort().join(',') || 'field',
    tasks: toCsv(tasks),
    actors: toCsv(actors),
    files: toCsv(new Set(files)),
    vendor: [...adapters].length === 1 ? [...adapters][0]! : toCsv(adapters),
    lane: [...lanes].length === 1 ? [...lanes][0]! : toCsv(lanes),
    verdict: [...verdicts].length === 1 ? [...verdicts][0]! : toCsv(verdicts),
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: evidenceValue
  };
}

function summarizeExperimentRun(run: BrokerExperimentRun): BrokerRunSummary | null {
  if (typeof run.runId !== 'string' || !run.runId) {
    return null;
  }

  const mutations = Array.isArray(run.mutationEvidence) ? run.mutationEvidence : [];
  const identities = new Set<string>();
  const actors = new Set<string>();
  const files = new Set<string>();
  const tasks = new Set<string>();
  const vendors = new Set<string>();
  const lanes = new Set<string>();
  const verdicts = new Set<string>();
  const commits = new Set<string>();
  const tx = new Set<string>();
  const scenarios = new Set<string>();

  for (const mutation of mutations) {
    if (mutation.requestId) {
      identities.add(mutation.requestId);
      const split = collectTags(mutation.requestId);
      split.scenarios.forEach((value) => scenarios.add(value));
      split.tasks.forEach((value) => tasks.add(value));
    }
    if (mutation.actorId) {
      actors.add(mutation.actorId);
    }
    if (mutation.filePath) {
      files.add(mutation.filePath);
    }
    if (mutation.adapterId) {
      vendors.add(mutation.adapterId);
    }
    if (mutation.mergeDecision) {
      lanes.add(mutation.mergeDecision);
    }
    if (mutation.verdict) {
      verdicts.add(mutation.verdict);
    }
    if (mutation.baseHash) {
      commits.add(mutation.baseHash);
    }
    if (mutation.resultHash) {
      commits.add(mutation.resultHash);
    }
    if (mutation.transactionId) {
      tx.add(mutation.transactionId);
    }
  }

  const evidenceValue = typeof run.runEvidencePath === 'string'
    ? run.runEvidencePath
    : `.atm/history/evidence/broker-runs/${run.runId}.json`;

  return {
    runId: run.runId,
    planId: run.plan?.planId ?? 'unknown',
    scenario: [...scenarios].sort().join(',') || 'field',
    tasks: toCsv(tasks),
    actors: toCsv(actors),
    files: toCsv(new Set(files)),
    vendor: [...vendors].length === 1 ? [...vendors][0]! : toCsv(vendors),
    lane: [...lanes].length === 1 ? [...lanes][0]! : toCsv(lanes),
    verdict: [...verdicts].length === 1 ? [...verdicts][0]! : toCsv(verdicts),
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: evidenceValue
  };
}

function isBrokerEnvelope(value: unknown): value is BrokerEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as BrokerEnvelope;
  return maybe.schemaId === 'atm.brokerOperationRunRecordEnvelope.v1'
    || typeof maybe.records !== 'undefined'
    || typeof maybe.runId === 'string';
}

function isBrokerExperimentRun(value: unknown): value is BrokerExperimentRun {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as BrokerExperimentRun;
  return typeof maybe.runEvidencePath === 'string'
    || (typeof maybe.runId === 'string' && Array.isArray(maybe.mutationEvidence));
}

function isTeamRun(value: unknown): value is TeamRun {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as TeamRun;
  return maybe.schemaId === 'atm.teamRun.v1' && typeof maybe.teamRunId === 'string';
}

function isBrokerRegistry(value: unknown): value is BrokerRegistryDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as BrokerRegistryDocument;
  return maybe.schemaId === 'atm.writeBrokerRegistry.v1' && Array.isArray(maybe.activeIntents);
}

function summarizeTeamRun(run: TeamRun, runSource: string): BrokerRunSummary | null {
  if (typeof run.teamRunId !== 'string' || !run.teamRunId) {
    return null;
  }

  const brokerLane = run.brokerLane;
  const brokerLaneObject = brokerLane && typeof brokerLane === 'object'
    ? brokerLane as Record<string, unknown>
    : null;
  const rearbitration = brokerLaneObject?.rearbitration && typeof brokerLaneObject.rearbitration === 'object'
    ? brokerLaneObject.rearbitration as Record<string, unknown>
    : null;
  const writeIntent = brokerLaneObject?.writeIntent;
  const writeTransaction = brokerLaneObject?.writeTransaction;
  const decision = (rearbitration?.effectiveDecision && typeof rearbitration.effectiveDecision === 'object'
    ? rearbitration.effectiveDecision
    : brokerLaneObject?.decision) as Record<string, unknown> | undefined;
  const identities = new Set<string>();
  const actors = new Set<string>();
  const files = new Set<string>();
  const tasks = new Set<string>();
  const commits = new Set<string>();
  const tx = new Set<string>();
  const scenarios = new Set<string>();

  addStringValue(tasks, run.taskId);
  addStringValue(actors, run.actorId);
  addStringValue(identities, run.planId);

  collectObjectStringsByKey(writeIntent, new Set(['request_identity', 'requestIdentity', 'requestId', 'planId']), identities);
  collectObjectStringsByKey(writeIntent, new Set(['taskId', 'task_ids', 'taskIds']), tasks);
  collectObjectStringsByKey(writeIntent, new Set(['actorId', 'actor_ids', 'actorIds']), actors);
  collectObjectStringsByKey(writeIntent, new Set([
    'file',
    'filePath',
    'files',
    'request_files',
    'requestFiles',
    'applied_files',
    'appliedFiles',
    'readSet',
    'writeSet',
    'scopePaths',
    'sharedFiles',
    'targetFiles'
  ]), files);
  collectObjectStringsByKey(writeIntent, new Set(['baseCommit', 'baseHead', 'baseHash', 'commit', 'commit_sha']), commits);
  collectObjectStringsByKey(decision, new Set(['intentId', 'transactionId', 'transaction_ids', 'transactionIds', 'writeTransactionId']), tx);
  collectObjectStringsByKey(writeTransaction, new Set(['intentId', 'transactionId', 'transaction_ids', 'transactionIds', 'writeTransactionId']), tx);

  for (const identity of identities) {
    const split = collectTags(identity);
    split.scenarios.forEach((value) => scenarios.add(value));
    split.tasks.forEach((value) => tasks.add(value));
  }

  const admissionState = deriveAdmissionStateFromBrokerLane(brokerLane);
  const rawLane = firstStringByKey(rearbitration ?? decision ?? brokerLane, new Set(['effectiveChosenLane', 'chosenLane', 'lane', 'lane_decision'])) ?? 'team-broker-lane';
  const rawVerdict = firstStringByKey(decision ?? brokerLane, new Set(['verdict', 'merge_verdict'])) ?? 'recorded';
  const lane = admissionState && admissionState !== 'not-required'
    ? `${rawLane}:${admissionState}`
    : rawLane;
  const verdict = admissionState && admissionState !== 'not-required'
    ? `${rawVerdict}:${admissionState}`
    : rawVerdict;

  return {
    runId: run.teamRunId,
    planId: run.taskId ?? run.planId ?? 'unknown',
    scenario: [...scenarios].sort().join(',') || 'field',
    tasks: toCsv(tasks),
    actors: toCsv(actors),
    files: toCsv(new Set(files)),
    vendor: 'team-broker-lane',
    lane,
    verdict,
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: runSource.replace(/\\/g, '/')
  };
}

function loadRunSummaries(runDir: string): BrokerRunSummary[] {
  const rows: BrokerRunSummary[] = [];
  const entries = readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of entries) {
    const fullPath = path.join(runDir, fileName);
    try {
      const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as unknown;
      let row: BrokerRunSummary | null = null;
      if (isBrokerEnvelope(raw)) {
        row = summarizeEnvelopeRecord(raw as BrokerEnvelope, fileName);
      } else if (isBrokerExperimentRun(raw)) {
        row = summarizeExperimentRun(raw as BrokerExperimentRun);
      }
      if (row) {
        rows.push(row);
      }
    } catch {
      // ignore invalid or malformed run files
    }
  }

  return rows;
}

function loadTeamRunSummaries(teamRunDir: string | null): BrokerRunSummary[] {
  if (!teamRunDir || !existsSync(teamRunDir)) {
    return [];
  }
  const rows: BrokerRunSummary[] = [];
  const entries = listActiveTeamRunFiles(teamRunDir);

  for (const fullPath of entries) {
    try {
      const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as unknown;
      if (!isTeamRun(raw)) {
        continue;
      }
      const row = summarizeTeamRun(raw, fullPath);
      if (row) {
        rows.push(row);
      }
    } catch {
      // ignore invalid or malformed team run files
    }
  }

  return rows;
}

function summarizeRegistryIntent(intent: RegistryActiveIntent, registryPath: string): BrokerRunSummary | null {
  const taskId = typeof intent.taskId === 'string' ? intent.taskId.trim() : '';
  const actorId = typeof intent.actorId === 'string' ? intent.actorId.trim() : '';
  const admissionState = typeof intent.admission?.state === 'string' ? intent.admission.state.trim() : '';
  if (!taskId || !admissionState || admissionState === 'not-required') {
    return null;
  }
  const files = Array.isArray(intent.resourceKeys?.files)
    ? intent.resourceKeys?.files.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const commit = typeof intent.baseCommit === 'string' ? intent.baseCommit.trim() : '';
  const identity = typeof intent.intentId === 'string' ? intent.intentId.trim() : '';
  return {
    runId: `registry-${taskId}`,
    planId: taskId,
    scenario: 'field',
    tasks: taskId,
    actors: actorId || 'unknown',
    files: toCsv(new Set(files)),
    vendor: 'broker-registry',
    lane: `direct-brokered:${admissionState}`,
    verdict: `recorded:${admissionState}`,
    commits: commit || 'n/a',
    transactions: identity || 'n/a',
    identities: identity || taskId,
    evidence: registryPath.replace(/\\/g, '/')
  };
}

function loadRegistryAdmissionSummaries(atmRoot: string): BrokerRunSummary[] {
  const registryPath = path.join(atmRoot, '.atm', 'runtime', 'write-broker.registry.json');
  if (!existsSync(registryPath)) {
    return [];
  }
  try {
    const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as unknown;
    if (!isBrokerRegistry(raw)) {
      return [];
    }
    return (raw.activeIntents ?? [])
      .map((intent) => summarizeRegistryIntent(intent, registryPath))
      .filter((row): row is BrokerRunSummary => Boolean(row));
  } catch {
    return [];
  }
}

function listActiveTeamRunFiles(teamRunDir: string): string[] {
  if (!existsSync(teamRunDir)) {
    return [];
  }
  return readdirSync(teamRunDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(teamRunDir, entry.name))
    .sort();
}

function collectTaskArtifacts(atmRoot: string, taskIds: string[], teamRunDir: string | null): TaskArtifactSummary[] {
  const closureSet = new Set<string>();
  const normalizedTaskIds = taskIds
    .filter((taskId) => taskId.startsWith('TASK-'))
    .sort((left, right) => left.localeCompare(right));

  if (normalizedTaskIds.length === 0) {
    return [];
  }

  const evidenceDir = path.join(atmRoot, '.atm', 'history', 'evidence');
  if (existsSync(evidenceDir)) {
    for (const fileName of readdirSync(evidenceDir)) {
      if (!fileName.endsWith('.closure-packet.json')) {
        continue;
      }
      const task = fileName.replace(/\.closure-packet\.json$/, '');
      if (task.startsWith('TASK-')) {
        closureSet.add(task);
      }
    }
  }

  const resolvedTeamRunDir = teamRunDir ?? path.join(atmRoot, '.atm', 'runtime', 'team-runs');
  const teamRunsByTask: Record<string, string[]> = {};
  if (existsSync(resolvedTeamRunDir)) {
    for (const fullPath of listActiveTeamRunFiles(resolvedTeamRunDir)) {
      try {
        const run = JSON.parse(readFileSync(fullPath, 'utf8')) as { taskId?: unknown };
        const taskId = typeof run.taskId === 'string' ? run.taskId : null;
        if (!taskId || !taskId.startsWith('TASK-')) {
          continue;
        }
        teamRunsByTask[taskId] ??= [];
        teamRunsByTask[taskId].push(fullPath.replace(/\\/g, '/'));
      } catch {
        // ignore malformed team run file
      }
    }
  }

  return normalizedTaskIds.map((taskId) => {
    return {
      taskId,
      closurePacket: closureSet.has(taskId) ? `.atm/history/evidence/${taskId}.closure-packet.json` : 'n/a',
      teamRuns: (teamRunsByTask[taskId] ?? ['n/a']).join(';')
    };
  });
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function buildReport(rows: BrokerRunSummary[], taskArtifacts: TaskArtifactSummary[]): string {
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

function parseTaskIdsFromRows(rows: readonly BrokerRunSummary[]): string[] {
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

function main() {
  const args = getArgs(process.argv.slice(2));
  if (args['--help'] || args['-h']) {
    printHelp();
    return;
  }
  const runDir = parseDefaultRunDir(args['--run-dir'] || args['--run-evidence-dir']);
  const teamRunDir = parseTeamRunDir(args['--team-run-dir']);
  const outputDir = parseOutputDir(args['--output-dir'], runDir);
  const jsonOutput = parseOutputFile(args['--json-output'], path.join(outputDir, 'broker-evidence-bundle.json'));
  const reportOutput = parseOutputFile(args['--report-output'], path.join(outputDir, 'broker-evidence-bundle.md'));
  const runFilter = new Set(parseCsvOption(args['--run-ids']));
  const taskFilter = new Set(parseCsvOption(args['--task-ids']));
  const atmRoot = path.resolve(typeof args['--atm-root'] === 'string' ? args['--atm-root'] : process.cwd());

  const rows = [
    ...loadRunSummaries(runDir),
    ...loadTeamRunSummaries(teamRunDir),
    ...loadRegistryAdmissionSummaries(atmRoot)
  ]
    .filter((row) => {
      if (runFilter.size > 0 && !runFilter.has(row.runId)) {
        return false;
      }
      if (taskFilter.size > 0) {
        const taskList = row.tasks.split(',').map((entry) => entry.trim()).filter(Boolean);
        return taskList.some((task) => taskFilter.has(task));
      }
      return true;
    })
    .sort((left, right) => left.runId.localeCompare(right.runId));

  const dedupedRows = new Map<string, BrokerRunSummary>();
  for (const row of rows) {
    if (!dedupedRows.has(row.runId)) {
      dedupedRows.set(row.runId, row);
    }
  }
  const uniqRows = [...dedupedRows.values()];

  const taskIds = parseTaskIdsFromRows(uniqRows);
  const taskArtifacts = collectTaskArtifacts(atmRoot, taskIds, teamRunDir);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(jsonOutput, `${JSON.stringify({
    schemaId: 'atm.brokerEvidenceBundle.v1',
    specVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    sourceRunDir: runDir.replace(/\\/g, '/'),
    sourceTeamRunDir: teamRunDir ? teamRunDir.replace(/\\/g, '/') : null,
    sourceAtmRoot: atmRoot.replace(/\\/g, '/'),
    runs: uniqRows,
    taskArtifacts
  }, null, 2)}\n`, 'utf8');
  writeFileSync(reportOutput, buildReport(uniqRows, taskArtifacts), 'utf8');

  console.log(`[collect-broker-evidence] runs=${uniqRows.length}, tasks=${taskArtifacts.length}, json=${jsonOutput}, report=${reportOutput}`);
}

main();
