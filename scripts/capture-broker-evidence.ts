import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { type ChildProcess, spawn } from 'node:child_process';
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
  readonly filePath?: string | null;
  readonly adapterId?: string | null;
  readonly mergeDecision?: string | null;
  readonly verdict?: string | null;
  readonly transactionId?: string | null;
  readonly baseHash?: string | null;
  readonly resultHash?: string | null;
}

interface BrokerExperimentRun {
  readonly runId?: string | null;
  readonly plan?: {
    readonly planId?: string | null;
  };
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
  requiredFields: string[];
}

interface TaskArtifactSummary {
  taskId: string;
  closurePacket: string;
  teamRuns: string;
}

type ArgValue = string | true | string[];
type ArgMap = Record<string, ArgValue>;

type StringSet = ReadonlySet<string>;

type RunSource = {
  filePath: string;
};

interface CommandResult {
  command: string;
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface CapturePayload {
  schemaId: string;
  specVersion: string;
  generatedAt: string;
  sourceRunDirs: string[];
  sourceTeamRunDirs: string[];
  sourceAtmRoot: string;
  commandLog?: CommandResult[];
  capturedFor: {
    awaitRuns: number;
    timeoutMs: number;
    pollMs: number;
    settleMs: number;
    runFilters: string[];
    taskFilters: string[];
    teamRunDirs: string[];
  };
  runs: BrokerRunSummary[];
  taskArtifacts: TaskArtifactSummary[];
}

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

    const previous = args[arg];
    const value = next;
    if (Array.isArray(previous)) {
      previous.push(value);
    } else if (previous === undefined) {
      args[arg] = value;
    } else if (previous === true) {
      args[arg] = [value];
    } else {
      args[arg] = [previous, value];
    }
    index += 1;
  }
  return args;
}

function asStringList(value: ArgValue | undefined): string[] {
  if (value === undefined || value === true) {
    return [];
  }
  return Array.isArray(value)
    ? value.map((entry) => entry.trim()).filter(Boolean)
    : [value.trim()].filter(Boolean);
}

function asStringCsvList(value: ArgValue | undefined): string[] {
  const values = asStringList(value);
  return values
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asInt(value: ArgValue | undefined, fallback: number): number {
  if (value === undefined || value === true) {
    return fallback;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid integer: ${raw}`);
  }
  return Math.floor(parsed);
}

function asBoolean(value: ArgValue | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? true : value.length > 0 && String(value[0]).toLowerCase() !== 'false';
  }
  if (value === true) {
    return true;
  }
  return String(value).toLowerCase() !== 'false';
}

function parseDefaultRunDirs(value: ArgValue | undefined): string[] {
  const explicit = [] as string[];
  const values = asStringList(value);
  const missing: string[] = [];

  for (const entry of values) {
    for (const part of entry.split(',')) {
      const resolved = path.resolve(part.trim());
      if (!resolved) {
        continue;
      }
      if (existsSync(resolved)) {
        explicit.push(resolved);
      } else {
        missing.push(part.trim());
      }
    }
  }

  if (explicit.length > 0) {
    if (missing.length > 0) {
      throw new Error(`Specified run directory not found: ${missing.join(', ')}`);
    }
    const dedupe = new Set(explicit);
    return [...dedupe];
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
  const runDirs: string[] = [];

  if (existsSync(repoFallback)) {
    runDirs.push(repoFallback);
  }
  if (existsSync(externalFallback)) {
    runDirs.push(externalFallback);
  }
  if (runDirs.length === 0) {
    throw new Error(`Unable to find run directory. Checked: ${repoFallback}, ${externalFallback}`);
  }
  return runDirs;
}

function parseTeamRunDirs(value: ArgValue | undefined): string[] {
  const values = asStringList(value);
  if (values.length === 0) {
    return [];
  }
  const dirs: string[] = [];
  const missing: string[] = [];
  for (const entry of values) {
    for (const part of entry.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const resolved = path.resolve(trimmed);
      if (existsSync(resolved)) {
        dirs.push(resolved);
      } else {
        missing.push(trimmed);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`Specified team-run directory not found: ${missing.join(', ')}`);
  }
  return [...new Set(dirs)];
}

function parseOutputDir(value: ArgValue | undefined, outputHint: string): string {
  if (typeof value === 'string' && value.trim()) {
    return path.resolve(value);
  }
  return path.resolve(process.cwd(), outputHint);
}

function parseOutputFile(value: ArgValue | undefined, fallback: string): string {
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

function collectTagsFromExperiment(requestId: string): { scenarios: string[]; tasks: string[] } {
  return {
    scenarios: [parseScenarioTag(requestId) ?? 'n/a'].filter((value) => value !== 'n/a' && value !== ''),
    tasks: [parseTaskIdHint(requestId)].filter((value) => Boolean(value)) as string[]
  };
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

  const missingFields = new Set<string>();

  for (const record of records) {
    const requestIdentities = uniq(record.request_identity);
    if (requestIdentities.size > 0) {
      for (const requestIdentity of requestIdentities) {
        identities.add(requestIdentity);
        const split = collectTags(requestIdentity);
        split.scenarios.forEach((value) => scenarios.add(value));
        split.tasks.forEach((value) => tasks.add(value));
      }
    } else {
      missingFields.add('request_identity');
    }

    const actorIds = uniq(record.actor_ids);
    if (actorIds.size > 0) {
      for (const actorId of actorIds) {
        actors.add(actorId);
      }
    } else {
      missingFields.add('actor_ids');
    }

    const requestFiles = uniq(record.request_files);
    for (const file of requestFiles) {
      files.add(file);
    }

    const appliedFiles = uniq(record.applied_files);
    for (const file of appliedFiles) {
      files.add(file);
    }

    if (requestFiles.size === 0 && appliedFiles.size === 0) {
      missingFields.add('request_files');
    }

    const taskIds = uniq(record.task_ids);
    for (const taskId of taskIds) {
      tasks.add(taskId);
    }

    const adapterChoice = (record.adapter_choice ?? '').trim();
    if (adapterChoice) {
      adapters.add(adapterChoice);
    } else {
      missingFields.add('adapter_choice');
    }

    const laneDecision = (record.lane_decision ?? '').trim();
    if (laneDecision) {
      lanes.add(laneDecision);
    } else {
      missingFields.add('lane_decision');
    }

    const mergeVerdict = (record.merge_verdict ?? '').trim();
    if (mergeVerdict) {
      verdicts.add(mergeVerdict);
    } else {
      missingFields.add('merge_verdict');
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
    files: toCsv(files),
    vendor: [...adapters].length === 1 ? [...adapters][0]! : toCsv(adapters),
    lane: [...lanes].length === 1 ? [...lanes][0]! : toCsv(lanes),
    verdict: [...verdicts].length === 1 ? [...verdicts][0]! : toCsv(verdicts),
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: evidenceValue,
    requiredFields: [...missingFields]
  };
}

function summarizeExperimentRun(run: BrokerExperimentRun, runSource: string): BrokerRunSummary | null {
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
  const missingFields = new Set<string>();

  for (const mutation of mutations) {
    if (mutation.requestId) {
      identities.add(mutation.requestId);
      const split = collectTagsFromExperiment(mutation.requestId);
      split.scenarios.forEach((value) => scenarios.add(value));
      split.tasks.forEach((value) => tasks.add(value));
    } else {
      missingFields.add('request_identity');
    }

    if (mutation.actorId) {
      actors.add(mutation.actorId);
    } else {
      missingFields.add('actor_ids');
    }

    if (mutation.filePath) {
      files.add(mutation.filePath);
    }

    if (mutation.filePath === undefined) {
      missingFields.add('request_files');
    }

    if (mutation.adapterId) {
      vendors.add(mutation.adapterId);
    } else {
      missingFields.add('adapter_choice');
    }

    if (mutation.mergeDecision) {
      lanes.add(mutation.mergeDecision);
    } else {
      missingFields.add('lane_decision');
    }

    if (mutation.verdict) {
      verdicts.add(mutation.verdict);
    } else {
      missingFields.add('merge_verdict');
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

  const evidenceValue = typeof run.runEvidencePath === 'string' ? run.runEvidencePath : runSource;

  return {
    runId: run.runId,
    planId: run.plan?.planId ?? 'unknown',
    scenario: [...scenarios].sort().join(',') || 'field',
    tasks: toCsv(tasks),
    actors: toCsv(actors),
    files: toCsv(files),
    vendor: [...vendors].length === 1 ? [...vendors][0]! : toCsv(vendors),
    lane: [...lanes].length === 1 ? [...lanes][0]! : toCsv(lanes),
    verdict: [...verdicts].length === 1 ? [...verdicts][0]! : toCsv(verdicts),
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: evidenceValue,
    requiredFields: [...missingFields]
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

function parseRunFile(filePath: string, runSource: RunSource): BrokerRunSummary | null {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (isBrokerEnvelope(raw)) {
    return summarizeEnvelopeRecord(raw, runSource.filePath);
  }
  if (isBrokerExperimentRun(raw)) {
    return summarizeExperimentRun(raw, runSource.filePath);
  }
  return null;
}

function isTeamRun(value: unknown): value is TeamRun {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as TeamRun;
  return maybe.schemaId === 'atm.teamRun.v1' && typeof maybe.teamRunId === 'string';
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
    files: toCsv(files),
    vendor: 'team-broker-lane',
    lane,
    verdict,
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: runSource.replace(/\\/g, '/'),
    requiredFields: []
  };
}

function readRunSummaries(runDir: string): BrokerRunSummary[] {
  if (!existsSync(runDir)) {
    return [];
  }
  const runEntries = readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(runDir, entry.name))
    .sort();

  const rows: BrokerRunSummary[] = [];
  const seen = new Set<string>();

  for (const filePath of runEntries) {
    try {
      const summary = parseRunFile(filePath, { filePath });
      if (!summary || seen.has(summary.runId)) {
        continue;
      }
      seen.add(summary.runId);
      rows.push(summary);
    } catch {
      // skip invalid run file
    }
  }

  return rows;
}

function readTeamRunSummaries(teamRunDirs: readonly string[]): BrokerRunSummary[] {
  const rows: BrokerRunSummary[] = [];
  const seen = new Set<string>();
  for (const teamRunDir of teamRunDirs) {
    if (!existsSync(teamRunDir)) {
      continue;
    }
    const entries = listActiveTeamRunFiles(teamRunDir);
    for (const filePath of entries) {
      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
        if (!isTeamRun(raw)) {
          continue;
        }
        const summary = summarizeTeamRun(raw, filePath);
        if (!summary || seen.has(summary.runId)) {
          continue;
        }
        seen.add(summary.runId);
        rows.push(summary);
      } catch {
        // skip invalid team run file
      }
    }
  }
  return rows;
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

function collectTaskArtifacts(atmRoot: string, taskIds: string[], teamRunDirs: readonly string[]): TaskArtifactSummary[] {
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

  const teamRunsByTask: Record<string, string[]> = {};
  const candidateTeamRunDirs = teamRunDirs.length > 0 ? teamRunDirs : [path.join(atmRoot, '.atm', 'runtime', 'team-runs')];
  for (const teamRunDir of candidateTeamRunDirs) {
    if (!existsSync(teamRunDir)) {
      continue;
    }
    for (const filePath of listActiveTeamRunFiles(teamRunDir)) {
      try {
        const run = JSON.parse(readFileSync(filePath, 'utf8')) as { taskId?: unknown };
        const taskId = typeof run.taskId === 'string' ? run.taskId : null;
        if (!taskId || !taskId.startsWith('TASK-')) {
          continue;
        }
        teamRunsByTask[taskId] ??= [];
        teamRunsByTask[taskId].push(filePath.replace(/\\/g, '/'));
      } catch {
        // ignore malformed team run file
      }
    }
  }

  return normalizedTaskIds.map((taskId) => ({
    taskId,
    closurePacket: closureSet.has(taskId) ? `.atm/history/evidence/${taskId}.closure-packet.json` : 'n/a',
    teamRuns: (teamRunsByTask[taskId] ?? ['n/a']).join(';')
  }));
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

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function buildReport(rows: BrokerRunSummary[], taskArtifacts: TaskArtifactSummary[]): string {
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

function parseFilters(runFilters: string[], taskFilters: string[]): (row: BrokerRunSummary) => boolean {
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

function readRunSummariesByDirs(runDirs: string[], teamRunDirs: readonly string[] = []): Map<string, BrokerRunSummary> {
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

function applyFilters(rows: Iterable<BrokerRunSummary>, predicate: (row: BrokerRunSummary) => boolean): BrokerRunSummary[] {
  const selected: BrokerRunSummary[] = [];
  for (const row of rows) {
    if (predicate(row)) {
      selected.push(row);
    }
  }
  return selected.sort((left, right) => left.runId.localeCompare(right.runId));
}

function printHelp(): void {
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
    '- run-dir: .atm/history/evidence/broker-runs (if exists) and',
    '  %USERPROFILE%/3KLife/docs/ai_atomic_framework/broker-collision-evidence/runs (if exists)',
    '- output-dir: <first-run-dir>/broker-capture',
    '- json output: <output-dir>/broker-capture.json',
    '- md output: <output-dir>/broker-capture.md',
    '- team-run-dir: optional atm.teamRun.v1 runtime directory; brokerLane is summarized as run rows',
    '- strict: true',
    ''
  ];
  console.log(lines.join('\n'));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function startCommand(command: string): ChildProcess & { command: string } {
  const startedAt = Date.now();
  const processInstance = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcess & { command: string };
  processInstance.command = command;
  (processInstance as ChildProcess & { startedAtMs?: number }).startedAtMs = startedAt;
  return processInstance;
}

function promisifyCommand(processInstance: ChildProcess & { command: string }): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    if (processInstance.stdout) {
      processInstance.stdout.setEncoding('utf8');
      processInstance.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (processInstance.stderr) {
      processInstance.stderr.setEncoding('utf8');
      processInstance.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    processInstance.once('error', (error) => {
      const startedAtMs = (processInstance as ChildProcess & { startedAtMs?: number }).startedAtMs;
      const durationMs = typeof startedAtMs === 'number' ? Date.now() - startedAtMs : 0;
      resolve({
        command: processInstance.command,
        exitCode: 1,
        signal: 'error',
        stdout,
        stderr: `${String(error.message)}${stderr ? `\n${stderr}` : ''}`,
        durationMs
      });
    });

    processInstance.once('close', (code, signal) => {
      const startedAtMs = (processInstance as ChildProcess & { startedAtMs?: number }).startedAtMs;
      const durationMs = typeof startedAtMs === 'number' ? Date.now() - startedAtMs : 0;
      resolve({
        command: processInstance.command,
        exitCode: typeof code === 'number' ? code : 0,
        signal: signal ?? null,
        stdout,
        stderr,
        durationMs
      });
    });
  });
}

async function runCommands(commandList: string[]): Promise<CommandResult[]> {
  if (commandList.length === 0) {
    return [];
  }
  const processes = commandList.map((command) => startCommand(command));
  const results = await Promise.all(processes.map((processInstance) => promisifyCommand(processInstance)));
  return results;
}

function buildCommandDigest(results: CommandResult[]): string {
  if (results.length === 0) {
    return 'none';
  }
  return results
    .map((result) => `${result.command} => ${result.exitCode}`)
    .join('; ');
}

async function main() {
  const args = getArgs(process.argv.slice(2));
  if (args['--help'] || args['-h']) {
    printHelp();
    return;
  }

  const runDirs = parseDefaultRunDirs(args['--run-dir']);
  const teamRunDirs = parseTeamRunDirs(args['--team-run-dir']);
  const outputDir = parseOutputDir(args['--output-dir'], path.join(runDirs[0] ?? process.cwd(), 'broker-capture'));
  const jsonOutput = parseOutputFile(args['--json-output'], path.join(outputDir, 'broker-capture.json'));
  const reportOutput = parseOutputFile(args['--report-output'], path.join(outputDir, 'broker-capture.md'));
  const runFilter = asStringCsvList(args['--run-ids']);
  const taskFilter = asStringCsvList(args['--task-ids']);
  const commandList = asStringList(args['--command']);
  const awaitNew = asInt(args['--await-new'], 0);
  const timeoutMs = asInt(args['--timeout-ms'], 600000);
  const pollMs = asInt(args['--poll-ms'], 2000);
  const settleMs = asInt(args['--settle-ms'], 1500);
  const strict = asBoolean(args['--strict'], true);
  const failOnCommand = asBoolean(args['--fail-on-command-failure'], true);
  const atmRoot = path.resolve(typeof args['--atm-root'] === 'string' && args['--atm-root'].trim() ? args['--atm-root'] : process.cwd());

  const filter = parseFilters(runFilter, taskFilter);
  const captureOnlyNew = commandList.length > 0 || awaitNew > 0;

  const baselineRuns = readRunSummariesByDirs(runDirs, teamRunDirs);
  const baseline = new Set(baselineRuns.keys());
  const commandLog: CommandResult[] = [];
  const commandStartAt = Date.now();

  const commandPromise = runCommands(commandList).then((results) => {
    commandLog.push(...results);
    if (failOnCommand) {
      const failed = results.find((result) => result.exitCode !== 0);
      if (failed) {
        console.error(`[capture-broker-evidence] command failed: ${failed.command}`);
        console.error(failed.stderr || failed.stdout);
        process.exit(failed.exitCode || 1);
      }
    }
  });

  const captureStart = Date.now();
  let candidates = new Map<string, BrokerRunSummary>();
  let iteration = 0;

  while (Date.now() - captureStart < timeoutMs && (awaitNew === 0 || candidates.size < awaitNew)) {
    iteration += 1;
    const allRuns = readRunSummariesByDirs(runDirs, teamRunDirs);
    const rows = applyFilters(Array.from(allRuns.values()), filter);
    const newRows = rows.filter((row) => !baseline.has(row.runId));
    candidates = new Map(newRows.map((row) => [row.runId, row]));

    if (awaitNew > 0 && candidates.size < awaitNew) {
      await sleep(pollMs);
    }

    if (iteration === 1 && awaitNew === 0) {
      break;
    }
  }

  if (settleMs > 0) {
    await sleep(settleMs);
  }

  await commandPromise;

  const finalRuns = readRunSummariesByDirs(runDirs, teamRunDirs);
  const filteredRuns = applyFilters(Array.from(finalRuns.values()), filter);
  const selected = filteredRuns.filter((row) => (captureOnlyNew ? !baseline.has(row.runId) : true));

  if (awaitNew > 0 && selected.length < awaitNew) {
    console.error(`[capture-broker-evidence] timeout waiting for new runs, found ${selected.length}/${awaitNew} in ${timeoutMs}ms`);
    process.exit(1);
  }

  const dedupedRows = new Map<string, BrokerRunSummary>();
  for (const row of selected) {
    if (!dedupedRows.has(row.runId)) {
      dedupedRows.set(row.runId, row);
    }
  }
  const finalRows = [...dedupedRows.values()].sort((left, right) => left.runId.localeCompare(right.runId));

  const missing = finalRows.filter((row) => row.requiredFields.length > 0);
  if (strict && missing.length > 0) {
    for (const row of missing) {
      console.error(`[capture-broker-evidence] runId=${row.runId} missing required fields: ${row.requiredFields.join(',')}`);
    }
    process.exit(1);
  }

  const taskIds = parseTaskIdsFromRows(finalRows);
  const taskArtifacts = collectTaskArtifacts(atmRoot, taskIds, teamRunDirs);

  mkdirSync(outputDir, { recursive: true });

  const payload: CapturePayload = {
    schemaId: 'atm.brokerCaptureBundle.v1',
    specVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    sourceRunDirs: runDirs.map((runDir) => runDir.replace(/\\/g, '/')),
    sourceTeamRunDirs: teamRunDirs.map((teamRunDir) => teamRunDir.replace(/\\/g, '/')),
    sourceAtmRoot: atmRoot.replace(/\\/g, '/'),
    commandLog,
    capturedFor: {
      awaitRuns: awaitNew,
      timeoutMs,
      pollMs,
      settleMs,
      runFilters: runFilter,
      taskFilters: taskFilter,
      teamRunDirs: teamRunDirs.map((teamRunDir) => teamRunDir.replace(/\\/g, '/'))
    },
    runs: finalRows,
    taskArtifacts
  };

  writeFileSync(jsonOutput, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  writeFileSync(reportOutput, buildReport(finalRows, taskArtifacts), 'utf8');

  const statusMessage = [
    `[capture-broker-evidence] runs=${finalRows.length}`,
    `commands=${commandLog.length} (${buildCommandDigest(commandLog)})`,
    `durationMs=${Date.now() - commandStartAt}`,
    `json=${jsonOutput}`,
    `report=${reportOutput}`
  ];
  console.log(statusMessage.join(' '));

  if (strict && captureOnlyNew && finalRows.length === 0) {
    console.error('[capture-broker-evidence] no new runs were captured');
    process.exit(1);
  }
}

void main();
