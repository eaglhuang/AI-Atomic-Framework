#!/usr/bin/env node
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

type Role = 'captain' | 'worker' | 'all';
type FrontMatter = Record<string, unknown>;
type YamlRecord = Record<string, string | string[]>;

interface AgentRef {
  id: string;
  model: string;
}

interface MailboxOptions {
  root: string;
  agents: AgentRef[];
  captainModel: string;
  workerModel: string;
  role: Role;
  agentId: string | null;
  completeActive: boolean;
  reportStatus: string;
  reportSummary: string | null;
  reportEvidence: string[];
  reportFile: string | null;
  staleMinutes: number;
  maxDispatch: number;
  captainNoReportLimit: number;
  captainNoDispatchMinutes: number;
  workerNoDispatchLimit: number;
  workerNoReportMinutes: number;
  clearStopLoss: boolean;
  reset: boolean;
  seedDemo: boolean;
  simulateWorkers: boolean;
  assertClean: boolean;
  json: boolean;
  help: boolean;
}

interface AgentLayout {
  root: string;
  inbox: string;
  active: string;
  done: string;
  reports: string;
  handoff: string;
  stopLoss: string;
}

interface CaptainLayout {
  root: string;
  inbox: string;
  outbox: string;
  reports: string;
  queue: string;
  archive: string;
  handoff: string;
  stopLoss: string;
}

interface MailboxLayout {
  root: string;
  state: string;
  ledger: string;
  lock: string;
  captain: CaptainLayout;
  agents: Map<string, AgentLayout>;
}

interface CaptainStopLossState {
  noReportCycles: number;
  noDispatchSince: string | null;
  paused: boolean;
  stoppedAt: string | null;
  lastTrigger: string | null;
  lastStopLossReportPath: string | null;
}

interface WorkerStopLossState {
  noDispatchCycles: number;
  activeSince: string | null;
  paused: boolean;
  stoppedAt: string | null;
  lastTrigger: string | null;
  lastStopLossReportPath: string | null;
}

interface StopLossState {
  captain: CaptainStopLossState;
  workers: Record<string, WorkerStopLossState>;
}

interface DispatchRecord {
  id?: string;
  sourceJobId?: string;
  title?: string;
  assignee?: string;
  assigneeModel?: string;
  captainModel?: string;
  status?: string;
  createdAt?: string;
  claimedAt?: string;
  completedAt?: string;
  reportedAt?: string;
  outboxPath?: string;
  agentInboxPath?: string;
  archivedQueuePath?: string;
  activePath?: string;
  donePath?: string;
  agentReportPath?: string;
  captainInboxReportPath?: string;
  reportPath?: string;
}

interface Ledger {
  schemaVersion: number;
  captain: { id: string; model: string };
  agents: AgentRef[];
  dispatches: Record<string, DispatchRecord>;
  stopLoss: StopLossState;
}

interface QueueJob {
  id: string;
  title: string;
  sourceKind: string;
  sourceFrontMatterRaw: string | null;
  assignee: string | null;
  objective: string;
  status: string;
  owner: string;
  priority: string;
  dependsOn: string[];
  relatedPlan: string | null;
  planningRepo: string;
  targetRepo: string;
  closureAuthority: string;
  scope: string[];
  deliverables: string[];
  validators: string[];
  evidenceRequired: string;
  rollbackStrategy: string;
  atomizationOwner: string;
  atomizationMapUpdates: string[];
  workModel: string | null;
  outOfScope: string[];
  sourceBody: string | null;
}

interface ParsedMarkdown {
  frontMatter: FrontMatter;
  heading: string | null;
  body: string;
  rawFrontMatter: string | null;
}

interface AgentBacklog {
  inbox: number;
  active: number;
  done: number;
  reports: number;
}

interface BacklogSnapshot {
  captain: {
    queue: number;
    inbox: number;
    outbox: number;
    reports: number;
  };
  agents: Record<string, AgentBacklog>;
}

interface WorkerReportOptions {
  status?: string;
  summary?: string | null;
  evidence?: string[];
  reportMarkdown?: string;
}

interface MailboxSummary {
  ok: boolean;
  root: string;
  cycleStartedAt: string;
  cycleFinishedAt?: string;
  captain: { id: string; model: string };
  agents: AgentRef[];
  role: Role;
  decisionPacket: {
    skillUsed: string;
    delegationMode: string;
    basis: string[];
    nextAction: string | null;
  };
  seededDemoJobs: string[];
  cycleInputBacklog: BacklogSnapshot | null;
  dispatched: Array<{ dispatchId: string; assignee: string; assigneeModel: string; title: string }>;
  claimed: Array<{ dispatchId: string; agentId: string; activePath: string }>;
  completed: Array<{ dispatchId: string; agentId: string; donePath: string; reportPath: string }>;
  reportsReceived: Array<{ phase: string; dispatchId: string | undefined; agentId: string; reportPath: string }>;
  idleAgents: string[];
  busyAgents: Array<{ agentId: string; active: string[] }>;
  staleUnclaimed: Array<{ agentId: string; dispatchId: string; ageMinutes: number; path: string }>;
  backlog: BacklogSnapshot | null;
  stopLoss: {
    shouldStop: boolean;
    paused: boolean;
    cleared: boolean;
    actor: string;
    automationId: string;
    trigger: string | null;
    reason: string | null;
    reportPath: string | null;
    thresholds: {
      captainNoReportLimit: number;
      captainNoDispatchMinutes: number;
      workerNoDispatchLimit: number;
      workerNoReportMinutes: number;
    };
    counters: Record<string, unknown>;
    activeDispatches: Array<{ dispatchId: string; path: string; since: string; ageMinutes: number | null }>;
  };
  handoffPath: string | null;
  readyForNextCycle: boolean;
  errors: string[];
}

const DEFAULT_ROOT = path.join('.atm-temp', 'captain-dispatch-mailbox');
const DEFAULT_CAPTAIN_MODEL = 'codex-5.4';
const DEFAULT_WORKER_MODEL = 'gpt-5.4-mini';
const DEFAULT_AGENTS = ['001', '002', '003'];
const LOCK_STALE_MS = 15 * 60 * 1000;
const DEFAULT_CAPTAIN_NO_REPORT_LIMIT = 5;
const DEFAULT_CAPTAIN_NO_DISPATCH_MINUTES = 10;
const DEFAULT_WORKER_NO_DISPATCH_LIMIT = 10;
const DEFAULT_WORKER_NO_REPORT_MINUTES = 15;

function fmString(fm: FrontMatter, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fm[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeYamlScalar(value);
    }
  }
  return undefined;
}

function resolveDispatchId(fm: FrontMatter, fallback: string): string {
  return fmString(fm, 'dispatch_id', 'dispatchId') || fallback;
}

function requireAgentLayout(layout: MailboxLayout, agentId: string): AgentLayout {
  const agentLayout = layout.agents.get(agentId);
  if (!agentLayout) {
    throw new Error(`Unknown agent layout: ${agentId}`);
  }
  return agentLayout;
}

function parseArgs(argv: string[]): MailboxOptions {
  const options: MailboxOptions = {
    root: DEFAULT_ROOT,
    agents: DEFAULT_AGENTS.map((id) => ({ id, model: DEFAULT_WORKER_MODEL })),
    captainModel: DEFAULT_CAPTAIN_MODEL,
    workerModel: DEFAULT_WORKER_MODEL,
    role: 'all' as Role,
    agentId: null,
    completeActive: false,
    reportStatus: 'done',
    reportSummary: null,
    reportEvidence: [],
    reportFile: null,
    staleMinutes: 5,
    maxDispatch: 10,
    captainNoReportLimit: DEFAULT_CAPTAIN_NO_REPORT_LIMIT,
    captainNoDispatchMinutes: DEFAULT_CAPTAIN_NO_DISPATCH_MINUTES,
    workerNoDispatchLimit: DEFAULT_WORKER_NO_DISPATCH_LIMIT,
    workerNoReportMinutes: DEFAULT_WORKER_NO_REPORT_MINUTES,
    clearStopLoss: false,
    reset: false,
    seedDemo: false,
    simulateWorkers: false,
    assertClean: false,
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.root = requireValue(argv, index += 1, '--root');
    } else if (arg === '--agents') {
      options.agents = parseAgents(requireValue(argv, index += 1, '--agents'), options.workerModel);
    } else if (arg === '--captain-model') {
      options.captainModel = requireValue(argv, index += 1, '--captain-model');
    } else if (arg === '--worker-model') {
      options.workerModel = requireValue(argv, index += 1, '--worker-model');
      options.agents = options.agents.map((agent) => ({ ...agent, model: options.workerModel }));
    } else if (arg === '--role') {
      options.role = requireValue(argv, index += 1, '--role') as Role;
    } else if (arg === '--agent-id') {
      options.agentId = requireValue(argv, index += 1, '--agent-id');
    } else if (arg === '--complete-active') {
      options.completeActive = true;
    } else if (arg === '--report-status') {
      options.reportStatus = requireValue(argv, index += 1, '--report-status');
    } else if (arg === '--report-summary') {
      options.reportSummary = requireValue(argv, index += 1, '--report-summary');
    } else if (arg === '--report-evidence') {
      options.reportEvidence.push(requireValue(argv, index += 1, '--report-evidence'));
    } else if (arg === '--report-file') {
      options.reportFile = requireValue(argv, index += 1, '--report-file');
    } else if (arg === '--stale-minutes') {
      options.staleMinutes = Number(requireValue(argv, index += 1, '--stale-minutes'));
    } else if (arg === '--max-dispatch') {
      options.maxDispatch = Number(requireValue(argv, index += 1, '--max-dispatch'));
    } else if (arg === '--captain-no-report-limit') {
      options.captainNoReportLimit = Number(requireValue(argv, index += 1, '--captain-no-report-limit'));
    } else if (arg === '--captain-no-dispatch-minutes') {
      options.captainNoDispatchMinutes = Number(requireValue(argv, index += 1, '--captain-no-dispatch-minutes'));
    } else if (arg === '--worker-no-dispatch-limit') {
      options.workerNoDispatchLimit = Number(requireValue(argv, index += 1, '--worker-no-dispatch-limit'));
    } else if (arg === '--worker-no-report-minutes') {
      options.workerNoReportMinutes = Number(requireValue(argv, index += 1, '--worker-no-report-minutes'));
    } else if (arg === '--clear-stop-loss') {
      options.clearStopLoss = true;
    } else if (arg === '--reset') {
      options.reset = true;
    } else if (arg === '--seed-demo') {
      options.seedDemo = true;
    } else if (arg === '--simulate-workers') {
      options.simulateWorkers = true;
    } else if (arg === '--assert-clean') {
      options.assertClean = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.staleMinutes) || options.staleMinutes < 0) {
    throw new Error('--stale-minutes must be a non-negative number');
  }
  if (!Number.isInteger(options.maxDispatch) || options.maxDispatch < 1) {
    throw new Error('--max-dispatch must be a positive integer');
  }
  if (!Number.isInteger(options.captainNoReportLimit) || options.captainNoReportLimit < 1) {
    throw new Error('--captain-no-report-limit must be a positive integer');
  }
  if (!Number.isFinite(options.captainNoDispatchMinutes) || options.captainNoDispatchMinutes < 0) {
    throw new Error('--captain-no-dispatch-minutes must be a non-negative number');
  }
  if (!Number.isInteger(options.workerNoDispatchLimit) || options.workerNoDispatchLimit < 1) {
    throw new Error('--worker-no-dispatch-limit must be a positive integer');
  }
  if (!Number.isFinite(options.workerNoReportMinutes) || options.workerNoReportMinutes < 0) {
    throw new Error('--worker-no-report-minutes must be a non-negative number');
  }
  if (options.agents.length === 0) {
    throw new Error('At least one agent is required');
  }
  if (!['captain', 'worker', 'all'].includes(options.role)) {
    throw new Error('--role must be one of: captain, worker, all');
  }
  if (options.agentId) {
    assertSafeId(options.agentId, 'agent id');
  }
  if (options.role === 'worker' && !options.agentId) {
    throw new Error('--role worker requires --agent-id');
  }

  return options;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseAgents(value: string, defaultModel: string): AgentRef[] {
  return value.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, model = defaultModel] = entry.split(':').map((part) => part.trim());
      assertSafeId(id, 'agent id');
      return { id, model };
    });
}

function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value || '')) {
    throw new Error(`${label} must use only letters, numbers, "_" or "-": ${value}`);
  }
}

function printHelp() {
  console.log([
    'Usage: node scripts/captain-dispatch-mailbox.mjs [options]',
    '',
    'Runs one captain/agent mailbox polling cycle.',
    '',
    'Options:',
    `  --root <path>             Mailbox root. Default: ${DEFAULT_ROOT}`,
    '  --agents <list>           Comma list, optionally id:model. Default: 001,002,003',
    `  --captain-model <model>   Captain model metadata. Default: ${DEFAULT_CAPTAIN_MODEL}`,
    `  --worker-model <model>    Worker model metadata. Default: ${DEFAULT_WORKER_MODEL}`,
    '  --role <role>             captain, worker, or all. Default: all',
    '  --agent-id <id>           Worker id for --role worker',
    '  --complete-active         Worker mode: complete the active dispatch and send a report',
    '  --report-status <status>  Worker report status. Default: done',
    '  --report-summary <text>   Worker report body summary',
    '  --report-evidence <text>  Repeatable command-backed evidence line for done reports',
    '  --report-file <path>      Worker Markdown report file following the dispatch Report Contract',
    '  --stale-minutes <n>       Flag unclaimed inbox files older than n minutes. Default: 5',
    '  --max-dispatch <n>        Max queued jobs dispatched in one cycle. Default: 10',
    `  --captain-no-report-limit <n>     Stop captain automation after n cycles with no reports. Default: ${DEFAULT_CAPTAIN_NO_REPORT_LIMIT}`,
    `  --captain-no-dispatch-minutes <n> Stop captain automation after queued work waits n minutes with no dispatch. Default: ${DEFAULT_CAPTAIN_NO_DISPATCH_MINUTES}`,
    `  --worker-no-dispatch-limit <n>    Stop worker automation after n idle cycles with no dispatch. Default: ${DEFAULT_WORKER_NO_DISPATCH_LIMIT}`,
    `  --worker-no-report-minutes <n>    Stop worker automation after active work waits n minutes with no report. Default: ${DEFAULT_WORKER_NO_REPORT_MINUTES}`,
    '  --clear-stop-loss       Clear the current captain/worker stop-loss state and skip polling',
    '  --seed-demo               Add demo work items when the queue is empty',
    '  --simulate-workers        Make workers finish claimed demo work immediately',
    '  --assert-clean            Exit non-zero unless the cycle leaves no backlog',
    '  --reset                   Remove the mailbox root before running',
    '  --json                    Emit a machine-readable summary',
    '',
    'Queue files go in captain/work-queue as JSON or Markdown with simple front matter.',
    'Dispatch files are Markdown and are delivered to agents/<agent-id>/inbox.',
    'Reports are Markdown files delivered to captain/inbox and archived to captain/reports.'
  ].join('\n'));
}

function resolveLayout(root: string, agents: AgentRef[]): MailboxLayout {
  const captain = {
    root: path.join(root, 'captain'),
    inbox: path.join(root, 'captain', 'inbox'),
    outbox: path.join(root, 'captain', 'outbox'),
    reports: path.join(root, 'captain', 'reports'),
    queue: path.join(root, 'captain', 'work-queue'),
    archive: path.join(root, 'captain', 'archive'),
    handoff: path.join(root, 'captain', 'handoff'),
    stopLoss: path.join(root, 'captain', 'stop-loss')
  };
  const agentLayouts = new Map(agents.map((agent) => [
    agent.id,
    {
      root: path.join(root, 'agents', agent.id),
      inbox: path.join(root, 'agents', agent.id, 'inbox'),
      active: path.join(root, 'agents', agent.id, 'active'),
      done: path.join(root, 'agents', agent.id, 'done'),
      reports: path.join(root, 'agents', agent.id, 'reports'),
      handoff: path.join(root, 'agents', agent.id, 'handoff'),
      stopLoss: path.join(root, 'agents', agent.id, 'stop-loss')
    }
  ]));

  return {
    root,
    state: path.join(root, 'state'),
    ledger: path.join(root, 'state', 'ledger.json'),
    lock: path.join(root, '.cycle.lock'),
    captain,
    agents: agentLayouts
  };
}

function ensureLayout(layout: MailboxLayout): void {
  const dirs = [
    layout.root,
    layout.state,
    layout.captain.root,
    layout.captain.inbox,
    layout.captain.outbox,
    layout.captain.reports,
    layout.captain.queue,
    layout.captain.archive,
    layout.captain.handoff,
    layout.captain.stopLoss
  ];
  for (const agentLayout of layout.agents.values()) {
    dirs.push(
      agentLayout.root,
      agentLayout.inbox,
      agentLayout.active,
      agentLayout.done,
      agentLayout.reports,
      agentLayout.handoff,
      agentLayout.stopLoss
    );
  }
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

function acquireLock(layout: MailboxLayout): () => void {
  mkdirSync(layout.root, { recursive: true });

  if (existsSync(layout.lock)) {
    const ageMs = Date.now() - statSync(layout.lock).mtimeMs;
    if (ageMs > LOCK_STALE_MS) {
      unlinkSync(layout.lock);
    }
  }

  let fd;
  try {
    fd = openSync(layout.lock, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2));
    closeSync(fd);
  } catch (error) {
    if (fd !== undefined) {
      closeSync(fd);
    }
    throw new Error(`Mailbox cycle already has an active lock: ${layout.lock}`);
  }

  return () => {
    if (existsSync(layout.lock)) {
      unlinkSync(layout.lock);
    }
  };
}

function readLedger(layout: MailboxLayout, options: MailboxOptions): Ledger {
  if (!existsSync(layout.ledger)) {
    return createLedger(options);
  }
  const parsed = JSON.parse(readFileSync(layout.ledger, 'utf8'));
  return {
    schemaVersion: 1,
    captain: { id: 'captain', model: options.captainModel, ...(parsed.captain || {}) },
    agents: options.agents,
    dispatches: parsed.dispatches || {},
    stopLoss: normalizeStopLoss(parsed.stopLoss, options)
  };
}

function createLedger(options: MailboxOptions): Ledger {
  return {
    schemaVersion: 1,
    captain: { id: 'captain', model: options.captainModel },
    agents: options.agents,
    dispatches: {},
    stopLoss: createStopLossState(options)
  };
}

function createStopLossState(options: MailboxOptions): StopLossState {
  const workers: Record<string, WorkerStopLossState> = {};
  for (const agent of options.agents) {
    workers[agent.id] = createWorkerStopLossState();
  }
  return {
    captain: {
      noReportCycles: 0,
      noDispatchSince: null,
      paused: false,
      stoppedAt: null,
      lastTrigger: null,
      lastStopLossReportPath: null
    },
    workers
  };
}

function createWorkerStopLossState(): WorkerStopLossState {
  return {
    noDispatchCycles: 0,
    activeSince: null,
    paused: false,
    stoppedAt: null,
    lastTrigger: null,
    lastStopLossReportPath: null
  };
}

function normalizeStopLoss(rawStopLoss: Partial<StopLossState> | undefined, options: MailboxOptions): StopLossState {
  const defaults = createStopLossState(options);
  const captainRaw = (rawStopLoss?.captain ?? {}) as Partial<CaptainStopLossState>;
  const captainNoReportCycles = Number(captainRaw.noReportCycles);
  const workers: Record<string, WorkerStopLossState> = {};

  for (const agent of options.agents) {
    const workerRaw = (rawStopLoss?.workers?.[agent.id] ?? {}) as Partial<WorkerStopLossState>;
    const workerNoDispatchCycles = Number(workerRaw.noDispatchCycles);
    workers[agent.id] = {
      ...defaults.workers[agent.id],
      ...workerRaw,
      noDispatchCycles: Number.isInteger(workerNoDispatchCycles) && workerNoDispatchCycles >= 0
        ? workerNoDispatchCycles
        : 0
    };
  }

  return {
    ...defaults,
    ...rawStopLoss,
    captain: {
      ...defaults.captain,
      ...captainRaw,
      noReportCycles: Number.isInteger(captainNoReportCycles) && captainNoReportCycles >= 0
        ? captainNoReportCycles
        : 0
    },
    workers
  };
}

function writeLedger(layout: MailboxLayout, ledger: Ledger): void {
  mkdirSync(path.dirname(layout.ledger), { recursive: true });
  writeFileSync(layout.ledger, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function seedDemoQueue(layout: MailboxLayout): string[] {
  const existing = listFiles(layout.captain.queue);
  if (existing.length > 0) {
    return [];
  }

  const demoJobs = [
    {
      id: 'DEMO-JOB-001',
      title: 'Verify mailbox directory contract',
      assignee: '001',
      objective: 'Confirm the captain and worker mailbox folders are readable, writable, and ready for the next polling cycle.',
      scope: ['Mailbox root only', 'No repository source edits'],
      validators: ['Report final status and any missing folders']
    },
    {
      id: 'DEMO-JOB-002',
      title: 'Verify report return contract',
      assignee: '002',
      objective: 'Confirm an agent can receive a dispatch card and return a Markdown report to the captain inbox.',
      scope: ['Mailbox root only', 'No repository source edits'],
      validators: ['Report dispatch id, agent id, and completion status']
    }
  ];

  for (const job of demoJobs) {
    const filePath = path.join(layout.captain.queue, `${job.id}.json`);
    writeFileSync(filePath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  }

  return demoJobs.map((job) => job.id);
}

function receiveCaptainReports(layout: MailboxLayout, ledger: Ledger, summary: MailboxSummary, phase: string): void {
  for (const reportPath of listFiles(layout.captain.inbox, ['.md'])) {
    const report = parseMarkdownFile(reportPath);
    const dispatchId = resolveDispatchId(report.frontMatter, path.basename(reportPath, '.md'));
    const agentId = fmString(report.frontMatter, 'agent', 'assignee') || 'unknown';
    const taskId = normalizeOptionalString(fmString(report.frontMatter, 'task_id', 'source_job_id')) || dispatchId;
    const fromAgent = normalizeOptionalString(fmString(report.frontMatter, 'from_agent', 'agent')) || agentId;
    const toAgent = normalizeOptionalString(fmString(report.frontMatter, 'to_agent', 'reply_to')) || 'captain';
    const completedAt = normalizeOptionalString(fmString(report.frontMatter, 'completed_at'))
      || new Date(statSync(reportPath).mtimeMs).toISOString();
    const archivePath = uniquePath(path.join(
      layout.captain.reports,
      buildReportFileName(taskId, fromAgent, toAgent, completedAt)
    ));

    renameSync(reportPath, archivePath);
    if (dispatchId && ledger.dispatches[dispatchId]) {
      ledger.dispatches[dispatchId] = {
        ...ledger.dispatches[dispatchId],
        status: 'done',
        completedAt: new Date().toISOString(),
        reportPath: toPortablePath(archivePath)
      };
    }

    summary.reportsReceived.push({
      phase,
      dispatchId,
      agentId,
      reportPath: toPortablePath(archivePath)
    });
  }
}

function dispatchQueuedWork(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  const queueFiles = listFiles(layout.captain.queue, ['.json', '.md']).slice(0, options.maxDispatch);
  for (const queuePath of queueFiles) {
    const job = loadQueueJob(queuePath);
    const agent = resolveAssignee(job, options.agents, layout);
    if (!agent) {
      summary.errors.push(`No available assignee for ${queuePath}`);
      continue;
    }

    const now = new Date().toISOString();
    const dispatchId = createDispatchId(job, agent, now);
    const dispatchFileName = buildDispatchFileName(job.id, 'captain', agent.id, now);
    const outboxPath = path.join(layout.captain.outbox, dispatchFileName);
    const agentInboxPath = path.join(requireAgentLayout(layout, agent.id).inbox, dispatchFileName);
    const markdown = renderDispatchMarkdown({
      dispatchId,
      job,
      agent,
      captainModel: options.captainModel,
      createdAt: now
    });

    writeFileSync(outboxPath, markdown, 'utf8');
    copyFileSync(outboxPath, uniquePath(agentInboxPath));

    const archivedQueuePath = uniquePath(path.join(
      layout.captain.archive,
      buildArchiveFileName(job.id, 'captain', agent.id, now, path.extname(queuePath) || '.md')
    ));
    renameSync(queuePath, archivedQueuePath);

    ledger.dispatches[dispatchId] = {
      id: dispatchId,
      sourceJobId: job.id,
      title: job.title,
      assignee: agent.id,
      assigneeModel: agent.model,
      captainModel: options.captainModel,
      status: 'sent',
      createdAt: now,
      outboxPath: toPortablePath(outboxPath),
      agentInboxPath: toPortablePath(agentInboxPath),
      archivedQueuePath: toPortablePath(archivedQueuePath)
    };

    summary.dispatched.push({
      dispatchId,
      assignee: agent.id,
      assigneeModel: agent.model,
      title: job.title
    });
  }
}

function pollWorkers(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  for (const agent of options.agents) {
    const agentLayout = requireAgentLayout(layout, agent.id);
    const activeFiles = listFiles(agentLayout.active, ['.md']);
    if (activeFiles.length > 0) {
      summary.busyAgents.push({ agentId: agent.id, active: activeFiles.map(toPortablePath) });
      continue;
    }

    const inboxFiles = listFiles(agentLayout.inbox, ['.md']);
    if (inboxFiles.length === 0) {
      summary.idleAgents.push(agent.id);
      continue;
    }

    const inboxPath = inboxFiles[0];
    const dispatch = parseMarkdownFile(inboxPath);
    const dispatchId = resolveDispatchId(dispatch.frontMatter, path.basename(inboxPath, '.md'));
    const activePath = uniquePath(path.join(agentLayout.active, path.basename(inboxPath)));
    renameSync(inboxPath, activePath);

    if (ledger.dispatches[dispatchId]) {
      ledger.dispatches[dispatchId] = {
        ...ledger.dispatches[dispatchId],
        status: 'claimed',
        claimedAt: new Date().toISOString(),
        activePath: toPortablePath(activePath)
      };
    }

    summary.claimed.push({ dispatchId, agentId: agent.id, activePath: toPortablePath(activePath) });

    if (options.simulateWorkers) {
      completeSimulatedWorker(layout, ledger, agent, agentLayout, activePath, dispatch, dispatchId, summary);
    }
  }
}

function pollOneWorker(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  const agent = options.agents.find((entry) => entry.id === options.agentId);
  if (!agent) {
    throw new Error(`Unknown worker agent: ${options.agentId}`);
  }

  const agentLayout = requireAgentLayout(layout, agent.id);
  const activeFiles = listFiles(agentLayout.active, ['.md']);
  if (options.completeActive) {
    if (activeFiles.length === 0) {
      summary.errors.push(`No active dispatch to complete for worker ${agent.id}`);
      return;
    }
    const activePath = activeFiles[0];
    const dispatch = parseMarkdownFile(activePath);
    const dispatchId = resolveDispatchId(dispatch.frontMatter, path.basename(activePath, '.md'));
    let explicitReport: { status: string; markdown: string } | { error: string } | null = null;
    if (options.reportFile) {
      explicitReport = loadWorkerReportFile(options.reportFile, {
        dispatchId,
        taskId: normalizeOptionalString(fmString(dispatch.frontMatter, 'task_id', 'source_job_id')) || dispatchId,
        fromAgent: agent.id,
        toAgent: normalizeOptionalString(fmString(dispatch.frontMatter, 'reply_to')) || 'captain',
        agentModel: agent.model,
        defaultStatus: options.reportStatus
      });
      if ('error' in explicitReport) {
        summary.errors.push(explicitReport.error);
        return;
      }
    } else if (isThinDoneReport(options.reportStatus, options.reportSummary)) {
      summary.errors.push(`Worker ${agent.id} done report is too thin; follow the active dispatch Report Contract instead of returning ok/done only.`);
      return;
    }
    completeSimulatedWorker(layout, ledger, agent, agentLayout, activePath, dispatch, dispatchId, summary, {
      status: explicitReport?.status || options.reportStatus,
      summary: explicitReport ? null : (options.reportSummary || `Worker ${agent.id} completed the active dispatch.`),
      evidence: explicitReport ? [] : options.reportEvidence,
      reportMarkdown: explicitReport?.markdown
    });
    return;
  }

  if (activeFiles.length > 0) {
    summary.busyAgents.push({ agentId: agent.id, active: activeFiles.map(toPortablePath) });
    return;
  }

  const inboxFiles = listFiles(agentLayout.inbox, ['.md']);
  if (inboxFiles.length === 0) {
    summary.idleAgents.push(agent.id);
    return;
  }

  const inboxPath = inboxFiles[0];
  const dispatch = parseMarkdownFile(inboxPath);
  const dispatchId = resolveDispatchId(dispatch.frontMatter, path.basename(inboxPath, '.md'));
  const activePath = uniquePath(path.join(agentLayout.active, path.basename(inboxPath)));
  renameSync(inboxPath, activePath);

  if (ledger.dispatches[dispatchId]) {
    ledger.dispatches[dispatchId] = {
      ...ledger.dispatches[dispatchId],
      status: 'claimed',
      claimedAt: new Date().toISOString(),
      activePath: toPortablePath(activePath)
    };
  }

  summary.claimed.push({ dispatchId, agentId: agent.id, activePath: toPortablePath(activePath) });

  if (options.simulateWorkers) {
    completeSimulatedWorker(layout, ledger, agent, agentLayout, activePath, dispatch, dispatchId, summary);
  }
}

function completeSimulatedWorker(layout: MailboxLayout, ledger: Ledger, agent: AgentRef, agentLayout: AgentLayout, activePath: string, dispatch: ParsedMarkdown, dispatchId: string, summary: MailboxSummary, reportOptions: WorkerReportOptions = {}): void {
  const now = new Date().toISOString();
  const status = reportOptions.status || 'done';
  const evidence = reportOptions.evidence || [
    'Dispatch card was claimed from the agent inbox.',
    'Active card was moved to the agent done folder.',
    'This report was copied to the captain inbox.'
  ];
  const taskId = normalizeOptionalString(fmString(dispatch.frontMatter, 'task_id', 'source_job_id')) || dispatchId;
  const fromAgent = normalizeOptionalString(fmString(dispatch.frontMatter, 'to_agent')) || agent.id;
  const toAgent = normalizeOptionalString(fmString(dispatch.frontMatter, 'reply_to', 'from_agent')) || 'captain';
  const reportFileName = buildReportFileName(taskId, fromAgent, toAgent, now);
  const localReportPath = uniquePath(path.join(agentLayout.reports, reportFileName));
  const captainInboxReportPath = uniquePath(path.join(layout.captain.inbox, reportFileName));
  const title = fmString(dispatch.frontMatter, 'title') || dispatch.heading || dispatchId;
  const bodySummary = reportOptions.summary || `Completed simulated work for "${title}".`;
  const defaultReportBody = ensureReportBody([
    bodySummary,
    ...(evidence.length > 0
      ? [
          '',
          '## Evidence',
          ...evidence.map((entry) => `- ${entry}`)
        ]
      : [])
  ].join('\n'), {
    fromAgent,
    toAgent,
    taskId,
    dispatchId
  });
  const reportMarkdown = reportOptions.reportMarkdown || [
    '---',
    `type: ${quoteYamlValue('captain-dispatch-report')}`,
    `dispatch_id: ${quoteYamlValue(dispatchId)}`,
    `task_id: ${quoteYamlValue(taskId)}`,
    `agent: ${quoteYamlValue(agent.id)}`,
    `agent_model: ${quoteYamlValue(agent.model)}`,
    `from_agent: ${quoteYamlValue(fromAgent)}`,
    `to_agent: ${quoteYamlValue(toAgent)}`,
    `status: ${quoteYamlValue(status)}`,
    `completed_at: ${quoteYamlValue(now)}`,
    '---',
    '',
    defaultReportBody,
    ''
  ].join('\n');

  writeFileSync(localReportPath, reportMarkdown, 'utf8');
  copyFileSync(localReportPath, captainInboxReportPath);

  const donePath = uniquePath(path.join(agentLayout.done, path.basename(activePath)));
  renameSync(activePath, donePath);

  if (ledger.dispatches[dispatchId]) {
    ledger.dispatches[dispatchId] = {
      ...ledger.dispatches[dispatchId],
      status: 'reported',
      reportedAt: now,
      donePath: toPortablePath(donePath),
      agentReportPath: toPortablePath(localReportPath),
      captainInboxReportPath: toPortablePath(captainInboxReportPath)
    };
  }

  summary.completed.push({
    dispatchId,
    agentId: agent.id,
    donePath: toPortablePath(donePath),
    reportPath: toPortablePath(captainInboxReportPath)
  });
}

function isThinDoneReport(status: string, summary: string | null): boolean {
  if (String(status).toLowerCase() !== 'done') {
    return false;
  }
  const normalized = String(summary || '').trim().toLowerCase();
  return normalized.length < 20 || ['ok', 'okay', 'done', 'completed', 'pass'].includes(normalized);
}

function scanUnclaimed(layout: MailboxLayout, options: MailboxOptions): MailboxSummary['staleUnclaimed'] {
  const staleMs = options.staleMinutes * 60 * 1000;
  const now = Date.now();
  const stale: MailboxSummary['staleUnclaimed'] = [];
  for (const agent of options.agents) {
    const agentLayout = requireAgentLayout(layout, agent.id);
    for (const filePath of listFiles(agentLayout.inbox, ['.md'])) {
      const ageMs = now - statSync(filePath).mtimeMs;
      if (ageMs >= staleMs) {
        const parsed = parseMarkdownFile(filePath);
        stale.push({
          agentId: agent.id,
          dispatchId: resolveDispatchId(parsed.frontMatter, path.basename(filePath, '.md')),
          ageMinutes: Number((ageMs / 60000).toFixed(2)),
          path: toPortablePath(filePath)
        });
      }
    }
  }
  return stale;
}

function computeBacklog(layout: MailboxLayout, options: MailboxOptions): BacklogSnapshot {
  const agents: Record<string, AgentBacklog> = {};
  for (const agent of options.agents) {
    const agentLayout = requireAgentLayout(layout, agent.id);
    agents[agent.id] = {
      inbox: listFiles(agentLayout.inbox, ['.md']).length,
      active: listFiles(agentLayout.active, ['.md']).length,
      done: listFiles(agentLayout.done, ['.md']).length,
      reports: listFiles(agentLayout.reports, ['.md']).length
    };
  }

  return {
    captain: {
      queue: listFiles(layout.captain.queue, ['.json', '.md']).length,
      inbox: listFiles(layout.captain.inbox, ['.md']).length,
      outbox: listFiles(layout.captain.outbox, ['.md']).length,
      reports: listFiles(layout.captain.reports, ['.md']).length
    },
    agents
  };
}

function isActorStopLossPaused(ledger: Ledger, options: MailboxOptions): boolean {
  if (options.role === 'worker') {
    return options.agentId ? Boolean(ledger.stopLoss?.workers?.[options.agentId]?.paused) : false;
  }
  return Boolean(ledger.stopLoss?.captain?.paused);
}

function clearActorStopLoss(ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  if (options.role === 'worker') {
    if (options.agentId) {
      ledger.stopLoss.workers[options.agentId] = createWorkerStopLossState();
    }
  } else {
    ledger.stopLoss.captain = createStopLossState(options).captain;
  }
  summary.stopLoss.cleared = true;
  summary.stopLoss.paused = false;
  summary.stopLoss.shouldStop = false;
  summary.stopLoss.trigger = null;
  summary.stopLoss.reason = `Stop-loss state cleared for ${summary.stopLoss.actor}.`;
  summary.stopLoss.reportPath = null;
  summary.stopLoss.counters = {};
}

function markAlreadyPausedStopLoss(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  const state = options.role === 'worker'
    ? (options.agentId ? ledger.stopLoss.workers[options.agentId] : createWorkerStopLossState())
    : ledger.stopLoss.captain;
  summary.stopLoss.shouldStop = true;
  summary.stopLoss.paused = true;
  summary.stopLoss.trigger = state.lastTrigger || 'already-paused';
  summary.stopLoss.reason = `${summary.stopLoss.actor} is already paused by stop-loss; no mailbox work was processed.`;
  summary.stopLoss.reportPath = state.lastStopLossReportPath;
  summary.stopLoss.counters = buildStopLossCounters(layout, ledger, options, state);
  summary.stopLoss.activeDispatches = options.role === 'worker' && options.agentId
    ? getWorkerActiveDispatches(layout, ledger, options.agentId)
    : [];
}

function evaluateStopLoss(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  if (options.role === 'worker') {
    evaluateWorkerStopLoss(layout, ledger, options, summary);
    return;
  }

  evaluateCaptainStopLoss(layout, ledger, options, summary);
}

function evaluateCaptainStopLoss(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  const state = ledger.stopLoss.captain;
  const hadQueuedWorkAtStart = (summary.cycleInputBacklog?.captain?.queue || 0) > 0 || summary.seededDemoJobs.length > 0;
  const hadActiveWorkAtStart = Object.values(summary.cycleInputBacklog?.agents || {}).some((agentBacklog) => (agentBacklog?.active || 0) > 0);
  const shouldTrackNoReports = hadQueuedWorkAtStart || hadActiveWorkAtStart;

  if (!shouldTrackNoReports || summary.reportsReceived.length > 0) {
    state.noReportCycles = 0;
  } else {
    state.noReportCycles += 1;
  }

  const hadDispatch = summary.dispatched.length > 0;
  if (hadDispatch) {
    state.noDispatchSince = null;
  } else if (hadQueuedWorkAtStart && !state.noDispatchSince) {
    state.noDispatchSince = summary.cycleStartedAt;
  } else if (!hadQueuedWorkAtStart) {
    state.noDispatchSince = null;
  }

  summary.stopLoss.counters = buildStopLossCounters(layout, ledger, options, state);
  if (state.noReportCycles >= options.captainNoReportLimit) {
    recordStopLossTrigger(
      layout,
      ledger,
      options,
      summary,
      state,
      'captain-no-reports',
      `Captain received no report cards for ${state.noReportCycles} consecutive cycle(s).`
    );
    return;
  }

  const noDispatchMinutes = elapsedMinutesSince(state.noDispatchSince);
  if (noDispatchMinutes !== null && noDispatchMinutes >= options.captainNoDispatchMinutes) {
    recordStopLossTrigger(
      layout,
      ledger,
      options,
      summary,
      state,
      'captain-no-dispatch-timeout',
      `Captain had queued dispatch work for ${noDispatchMinutes} minute(s) without sending a dispatch card.`
    );
  }
}

function evaluateWorkerStopLoss(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  if (!options.agentId) {
    return;
  }
  const state = ledger.stopLoss.workers[options.agentId];
  const activeDispatches = getWorkerActiveDispatches(layout, ledger, options.agentId);
  const completedThisWorker = summary.completed.some((entry) => entry.agentId === options.agentId);
  const claimedThisWorker = summary.claimed.some((entry) => entry.agentId === options.agentId);
  const idleThisWorker = summary.idleAgents.includes(options.agentId);

  summary.stopLoss.activeDispatches = activeDispatches;

  if (completedThisWorker) {
    state.noDispatchCycles = 0;
    state.activeSince = null;
  } else if (claimedThisWorker || activeDispatches.length > 0) {
    state.noDispatchCycles = 0;
    state.activeSince = state.activeSince || activeDispatches[0]?.since || summary.cycleStartedAt;
  } else if (idleThisWorker) {
    state.noDispatchCycles += 1;
    state.activeSince = null;
  }

  summary.stopLoss.counters = buildStopLossCounters(layout, ledger, options, state);
  if (state.noDispatchCycles >= options.workerNoDispatchLimit) {
    recordStopLossTrigger(
      layout,
      ledger,
      options,
      summary,
      state,
      'worker-no-dispatches',
      `Worker ${options.agentId} received no dispatch cards for ${state.noDispatchCycles} consecutive cycle(s).`
    );
    return;
  }

  const activeMinutes = elapsedMinutesSince(state.activeSince);
  if (activeDispatches.length > 0 && !completedThisWorker && activeMinutes !== null && activeMinutes >= options.workerNoReportMinutes) {
    recordStopLossTrigger(
      layout,
      ledger,
      options,
      summary,
      state,
      'worker-no-report-timeout',
      `Worker ${options.agentId} has had active work for ${activeMinutes} minute(s) without reporting back to captain.`
    );
  }
}

function recordStopLossTrigger(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary, state: CaptainStopLossState | WorkerStopLossState, trigger: string, reason: string): void {
  if (summary.stopLoss.shouldStop) {
    return;
  }

  const now = new Date().toISOString();
  state.paused = true;
  state.stoppedAt = now;
  state.lastTrigger = trigger;
  summary.stopLoss.shouldStop = true;
  summary.stopLoss.paused = true;
  summary.stopLoss.trigger = trigger;
  summary.stopLoss.reason = reason;
  summary.stopLoss.counters = buildStopLossCounters(layout, ledger, options, state);
  const reportPath = writeStopLossReport(layout, options, summary, now);
  state.lastStopLossReportPath = reportPath;
  summary.stopLoss.reportPath = reportPath;
}

function writeStopLossReport(layout: MailboxLayout, options: MailboxOptions, summary: MailboxSummary, generatedAt: string): string {
  const reportDir = options.role === 'worker' && options.agentId
    ? requireAgentLayout(layout, options.agentId).stopLoss
    : layout.captain.stopLoss;
  const fileName = `${generatedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}--${sanitizeFileName(summary.stopLoss.actor)}--${sanitizeFileName(summary.stopLoss.trigger)}.stop-loss.md`;
  const reportPath = uniquePath(path.join(reportDir, fileName));
  const portableReportPath = toPortablePath(reportPath);
  const stopLossForReport = { ...summary.stopLoss, reportPath: portableReportPath };
  const markdown = [
    '---',
    'type: mailbox-stop-loss-report',
    `actor: ${summary.stopLoss.actor}`,
    `automation_id: ${summary.stopLoss.automationId}`,
    `trigger: ${summary.stopLoss.trigger}`,
    `generated_at: ${generatedAt}`,
    '---',
    '',
    '# Mailbox Stop-Loss Report',
    '',
    `Generated: ${generatedAt}`,
    `Actor: ${summary.stopLoss.actor}`,
    `Automation: ${summary.stopLoss.automationId}`,
    `Trigger: ${summary.stopLoss.trigger}`,
    '',
    '## Reason',
    summary.stopLoss.reason,
    '',
    '## Current Events',
    `- Dispatched: ${summary.dispatched.length}`,
    `- Claimed: ${summary.claimed.length}`,
    `- Completed: ${summary.completed.length}`,
    `- Reports received: ${summary.reportsReceived.length}`,
    `- Stale unclaimed: ${summary.staleUnclaimed.length}`,
    `- Errors: ${summary.errors.length}`,
    '',
    '## Current State',
    '```json',
    JSON.stringify({
      stopLoss: stopLossForReport,
      backlog: summary.backlog,
      cycleInputBacklog: summary.cycleInputBacklog,
      activeDispatches: summary.stopLoss.activeDispatches,
      errors: summary.errors
    }, null, 2),
    '```',
    '',
    '## Required Action',
    `Pause automation ${summary.stopLoss.automationId} and keep this report as the handoff reason before resuming.`,
    ''
  ].join('\n');

  writeFileSync(reportPath, markdown, 'utf8');
  return portableReportPath;
}

function buildStopLossCounters(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, state: CaptainStopLossState | WorkerStopLossState): Record<string, unknown> {
  if (options.role === 'worker' && options.agentId) {
    const workerState = state as WorkerStopLossState;
    const activeDispatches = getWorkerActiveDispatches(layout, ledger, options.agentId);
    return {
      noDispatchCycles: workerState.noDispatchCycles,
      noDispatchLimit: options.workerNoDispatchLimit,
      activeSince: workerState.activeSince,
      activeMinutes: elapsedMinutesSince(workerState.activeSince),
      noReportMinutesLimit: options.workerNoReportMinutes,
      activeDispatchCount: activeDispatches.length
    };
  }

  const captainState = state as CaptainStopLossState;
  return {
    noReportCycles: captainState.noReportCycles,
    noReportLimit: options.captainNoReportLimit,
    noDispatchSince: captainState.noDispatchSince,
    noDispatchMinutes: elapsedMinutesSince(captainState.noDispatchSince),
    noDispatchMinutesLimit: options.captainNoDispatchMinutes
  };
}

function getWorkerActiveDispatches(layout: MailboxLayout, ledger: Ledger, agentId: string): MailboxSummary['stopLoss']['activeDispatches'] {
  const agentLayout = layout.agents.get(agentId);
  if (!agentLayout) {
    return [];
  }

  return listFiles(agentLayout.active, ['.md']).map((filePath) => {
    const dispatch = parseMarkdownFile(filePath);
    const dispatchId = resolveDispatchId(dispatch.frontMatter, path.basename(filePath, '.md'));
    const ledgerDispatch = ledger.dispatches[dispatchId] || {};
    const since = ledgerDispatch.claimedAt || new Date(statSync(filePath).mtimeMs).toISOString();
    return {
      dispatchId,
      path: toPortablePath(filePath),
      since,
      ageMinutes: elapsedMinutesSince(since)
    };
  }).sort((left, right) => Date.parse(left.since) - Date.parse(right.since));
}

function elapsedMinutesSince(isoTimestamp: string | null): number | null {
  if (!isoTimestamp) {
    return null;
  }
  const timestampMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  return Number(Math.max(0, (Date.now() - timestampMs) / 60000).toFixed(2));
}

function writeCaptainHandoff(layout: MailboxLayout, ledger: Ledger, summary: MailboxSummary): string {
  const handoffPath = path.join(layout.captain.handoff, 'latest-handoff.md');
  const activeDispatches = Object.values(ledger.dispatches)
    .filter((dispatch) => !['done'].includes(dispatch.status || ''))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  const markdown = [
    '# Captain Mailbox Handoff',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Mailbox root: ${summary.root}`,
    `Captain model: ${summary.captain.model}`,
    '',
    '## Dispatch Compliance',
    '- Skill used: atm-dispatch',
    '- Delegation mode: captain control thread with opted-in worker thread handoff',
    '- Internal sidecar remains the default for review, preflight, grep, checklist, planning-only checks, and post-report verification.',
    '- External write remains forbidden unless the dispatch card grants explicit write authority and scope.',
    '',
    '## Last Cycle',
    `- Dispatched: ${summary.dispatched.length}`,
    `- Claimed: ${summary.claimed.length}`,
    `- Completed: ${summary.completed.length}`,
    `- Reports received: ${summary.reportsReceived.length}`,
    `- Stale unclaimed: ${summary.staleUnclaimed.length}`,
    `- Ready for next cycle: ${summary.readyForNextCycle}`,
    `- Stop-loss paused: ${summary.stopLoss.paused}`,
    `- Stop-loss trigger: ${summary.stopLoss.trigger || 'None'}`,
    `- Stop-loss report: ${summary.stopLoss.reportPath || 'None'}`,
    '',
    '## Active Dispatches',
    ...(activeDispatches.length === 0
      ? ['- None']
      : activeDispatches.map((dispatch) => `- ${dispatch.id}: ${dispatch.status} -> ${dispatch.assignee}`)),
    '',
    '## Backlog Snapshot',
    '```json',
    JSON.stringify(summary.backlog, null, 2),
    '```',
    '',
    '## Stop-Loss Snapshot',
    '```json',
    JSON.stringify(summary.stopLoss, null, 2),
    '```',
    '',
    '## Next Captain Instructions',
    '1. Read this handoff first.',
    '2. Continue with `node scripts/captain-dispatch-mailbox.mjs --role captain --json` using the same mailbox root and agents.',
    '3. Keep decision output in Captain Decision Packet format.',
    ''
  ].join('\n');

  writeFileSync(handoffPath, markdown, 'utf8');
  return toPortablePath(handoffPath);
}

function writeWorkerHandoff(layout: MailboxLayout, options: MailboxOptions, summary: MailboxSummary): string | null {
  if (!options.agentId) {
    return null;
  }
  const agentLayout = requireAgentLayout(layout, options.agentId);

  const handoffPath = path.join(agentLayout.handoff, 'latest-handoff.md');
  const markdown = [
    `# Worker ${options.agentId} Handoff`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Mailbox root: ${summary.root}`,
    `Worker model: ${options.agents.find((agent) => agent.id === options.agentId)?.model || options.workerModel}`,
    '',
    '## Last Cycle',
    `- Claimed: ${summary.claimed.length}`,
    `- Completed: ${summary.completed.length}`,
    `- Active: ${summary.backlog?.agents?.[options.agentId]?.active ?? 0}`,
    `- Inbox: ${summary.backlog?.agents?.[options.agentId]?.inbox ?? 0}`,
    `- Stop-loss paused: ${summary.stopLoss.paused}`,
    `- Stop-loss trigger: ${summary.stopLoss.trigger || 'None'}`,
    `- Stop-loss report: ${summary.stopLoss.reportPath || 'None'}`,
    '',
    '## Active Files',
    ...listFiles(agentLayout.active, ['.md']).map((filePath) => `- ${toPortablePath(filePath)}`),
    '',
    '## Stop-Loss Snapshot',
    '```json',
    JSON.stringify(summary.stopLoss, null, 2),
    '```',
    '',
    '## Next Worker Instructions',
    '1. Read any active dispatch before claiming a new one.',
    '2. If active work is complete, follow the active dispatch Report Contract before running worker mode with `--complete-active`.',
    '3. Do not report done with ok/done only; use status=blocked or needs-captain-review if the assigned work was not actually completed.',
    '4. If no active work exists, run worker mode to claim the next inbox dispatch.',
    ''
  ].join('\n');

  writeFileSync(handoffPath, markdown, 'utf8');
  return toPortablePath(handoffPath);
}

function loadQueueJob(queuePath: string): QueueJob {
  if (path.extname(queuePath).toLowerCase() === '.json') {
    const parsed = JSON.parse(readFileSync(queuePath, 'utf8'));
    return normalizeJob({
      ...parsed,
      sourceKind: 'json',
      sourceFrontMatterRaw: null
    }, queuePath);
  }

  const parsed = parseMarkdownFile(queuePath);
  return normalizeJob({
    ...parsed.frontMatter,
    title: normalizeOptionalString(parsed.frontMatter.title) || parsed.heading || path.basename(queuePath, path.extname(queuePath)),
    objective: normalizeOptionalString(parsed.frontMatter.objective) || parsed.body.trim(),
    sourceBody: parsed.body.trim(),
    sourceKind: 'markdown',
    sourceFrontMatterRaw: parsed.rawFrontMatter
  }, queuePath);
}

function normalizeJob(raw: Record<string, unknown>, queuePath: string): QueueJob {
  const id = normalizeOptionalString(raw.task_id || raw.taskId || raw.id || raw.job_id)
    || path.basename(queuePath, path.extname(queuePath));
  const title = normalizeOptionalString(raw.title) || id;
  const scope = normalizeStringList(raw.scopePaths ?? raw.scope_paths ?? raw.allowedFiles ?? raw.allowed_files ?? raw.scope, ['Mailbox-only dispatch cycle']);
  const validators = normalizeStringList(raw.validators, ['Return a Markdown report to captain/inbox']);
  const deliverables = normalizeStringList(raw.deliverables, scope);
  const outOfScope = normalizeStringList(raw.outOfScope ?? raw.out_of_scope, []);
  const dependsOn = normalizeStringList(raw.depends_on ?? raw.dependsOn, []);
  return {
    id,
    title,
    sourceKind: normalizeOptionalString(raw.sourceKind) || 'json',
    sourceFrontMatterRaw: normalizeOptionalString(raw.sourceFrontMatterRaw),
    assignee: raw.assignee ? String(raw.assignee) : null,
    objective: String(raw.objective || raw.goal || title),
    status: String(raw.status || 'assigned'),
    owner: String(raw.owner || raw.assignee || 'atm-release'),
    priority: String(raw.priority || 'P1'),
    dependsOn,
    relatedPlan: raw.related_plan || raw.relatedPlan ? String(raw.related_plan || raw.relatedPlan) : null,
    planningRepo: String(raw.planning_repo || raw.planningRepo || 'AI-Atomic-Framework'),
    targetRepo: String(raw.target_repo || raw.targetRepo || 'AI-Atomic-Framework'),
    closureAuthority: String(raw.closure_authority || raw.closureAuthority || 'target_repo'),
    scope,
    deliverables,
    validators,
    evidenceRequired: String(raw.evidence_required || raw.evidenceRequired || (raw.evidence as Record<string, unknown> | undefined)?.required || 'command-backed'),
    rollbackStrategy: String(raw.rollback_strategy || raw.rollbackStrategy || (raw.rollback as Record<string, unknown> | undefined)?.strategy || 'revert-commit'),
    atomizationOwner: raw.atomization_owner || raw.atomizationOwner || (raw.atomizationImpact as Record<string, unknown> | undefined)?.ownerAtomOrMap
      ? String(raw.atomization_owner || raw.atomizationOwner || (raw.atomizationImpact as Record<string, unknown> | undefined)?.ownerAtomOrMap)
      : 'mailbox-dispatch-runtime',
    atomizationMapUpdates: normalizeStringList(raw.mapUpdates ?? raw.map_updates ?? (raw.atomizationImpact as Record<string, unknown> | undefined)?.mapUpdates, []),
    workModel: raw.work_model || raw.workModel ? String(raw.work_model || raw.workModel) : null,
    outOfScope,
    sourceBody: raw.sourceBody ? String(raw.sourceBody).trim() : null
  };
}

function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry).trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }
  if (typeof value === 'string') {
    const normalized = value.split(/\r?\n|,/)
      .map((entry) => entry.replace(/^-\s*/, '').trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }
  return fallback;
}

function resolveAssignee(job: QueueJob, agents: AgentRef[], layout: MailboxLayout): AgentRef | null {
  if (job.assignee) {
    return agents.find((agent) => agent.id === job.assignee) || null;
  }

  return [...agents].sort((left, right) => {
    const leftLayout = requireAgentLayout(layout, left.id);
    const rightLayout = requireAgentLayout(layout, right.id);
    const leftLoad = listFiles(leftLayout.inbox, ['.md']).length + listFiles(leftLayout.active, ['.md']).length;
    const rightLoad = listFiles(rightLayout.inbox, ['.md']).length + listFiles(rightLayout.active, ['.md']).length;
    return leftLoad - rightLoad || left.id.localeCompare(right.id);
  })[0];
}

function createDispatchId(job: QueueJob, agent: AgentRef, isoTimestamp: string): string {
  const stamp = formatTimestampTag(isoTimestamp);
  return `${sanitizeFileName(job.id)}--captain-to-${sanitizeFileName(agent.id)}--${stamp}`;
}

function renderDispatchMarkdown({ dispatchId, job, agent, captainModel, createdAt }: { dispatchId: string; job: QueueJob; agent: AgentRef; captainModel: string; createdAt: string }): string {
  if (job.sourceKind === 'markdown' && job.sourceFrontMatterRaw) {
    const body = ensureDispatchBody(job.sourceBody, {
      taskId: job.id,
      dispatchId,
      fromAgent: 'captain',
      toAgent: agent.id,
      workModel: job.workModel || agent.model
    });
    const preservedFrontMatter = sanitizeFrontMatterBlock(job.sourceFrontMatterRaw, new Set([
      'type',
      'dispatch_id',
      'source_job_id',
      'assignee',
      'assignee_model',
      'captain_model',
      'work_model',
      'from_agent',
      'to_agent',
      'reply_to',
      'mailbox_created_at'
    ]));
    return finalizeDispatchMarkdown([
      '---',
      ...(preservedFrontMatter ? [preservedFrontMatter] : []),
      `type: ${quoteYamlValue('captain-dispatch')}`,
      `dispatch_id: ${quoteYamlValue(dispatchId)}`,
      `source_job_id: ${quoteYamlValue(job.id)}`,
      `assignee: ${quoteYamlValue(agent.id)}`,
      `assignee_model: ${quoteYamlValue(agent.model)}`,
      `captain_model: ${quoteYamlValue(captainModel)}`,
      `work_model: ${quoteYamlValue(job.workModel || agent.model)}`,
      `from_agent: ${quoteYamlValue('captain')}`,
      `to_agent: ${quoteYamlValue(agent.id)}`,
      `reply_to: ${quoteYamlValue('captain')}`,
      `mailbox_created_at: ${quoteYamlValue(createdAt)}`,
      '---',
      '',
      body,
      ''
    ].join('\n'), { fromAgent: 'captain', toAgent: agent.id, taskId: job.id, dispatchId });
  }

  const originalBody = job.sourceBody && job.sourceBody !== job.objective ? job.sourceBody : null;
  return finalizeDispatchMarkdown([
    '---',
    'type: captain-dispatch',
    `dispatch_id: ${quoteYamlValue(dispatchId)}`,
    `source_job_id: ${quoteYamlValue(job.id)}`,
    `task_id: ${quoteYamlValue(job.id)}`,
    `assignee: ${quoteYamlValue(agent.id)}`,
    `assignee_model: ${quoteYamlValue(agent.model)}`,
    `work_model: ${quoteYamlValue(job.workModel || agent.model)}`,
    `captain_model: ${quoteYamlValue(captainModel)}`,
    `from_agent: ${quoteYamlValue('captain')}`,
    `to_agent: ${quoteYamlValue(agent.id)}`,
    `reply_to: ${quoteYamlValue('captain')}`,
    `status: ${quoteYamlValue(job.status)}`,
    `owner: ${quoteYamlValue(job.owner)}`,
    `priority: ${quoteYamlValue(job.priority)}`,
    'depends_on:',
    ...renderYamlList(job.dependsOn),
    ...(job.relatedPlan ? [`related_plan: ${quoteYamlValue(job.relatedPlan)}`] : []),
    `planning_repo: ${quoteYamlValue(job.planningRepo)}`,
    `target_repo: ${quoteYamlValue(job.targetRepo)}`,
    `closure_authority: ${quoteYamlValue(job.closureAuthority)}`,
    'scopePaths:',
    ...renderYamlList(job.scope),
    'deliverables:',
    ...renderYamlList(job.deliverables),
    'validators:',
    ...renderYamlList(job.validators),
    'evidence:',
    `  required: ${quoteYamlValue(job.evidenceRequired)}`,
    'rollback:',
    `  strategy: ${quoteYamlValue(job.rollbackStrategy)}`,
    'atomizationImpact:',
    `  ownerAtomOrMap: ${quoteYamlValue(job.atomizationOwner)}`,
    '  mapUpdates:',
    ...renderYamlList(job.atomizationMapUpdates, '    '),
    `created_at: ${quoteYamlValue(createdAt)}`,
    `reply_to_mailbox: ${quoteYamlValue('captain/inbox')}`,
    `title: ${quoteYamlValue(job.title)}`,
    '---',
    '',
    `派工方代號：captain；接收方代號：${agent.id}；任務：${job.id}`,
    '',
    `# ${job.title}`,
    '',
    '## Dispatch Compliance',
    '- Skill used: atm-dispatch',
    '- Delegation mode: external handoff worker thread, explicitly opted in by the user for this mailbox system.',
    '- External write is forbidden unless this card explicitly grants write authority and scope.',
    '- This is an ATM standard task-card dispatch. Do not replace it with a free-form checklist.',
    '',
    '## Model Policy',
    `- Intake / mailbox polling model: ${agent.model}`,
    `- Work execution model: ${job.workModel || agent.model}`,
    '- If work_model is higher than the intake model, the intake worker should hand off execution to a worker execution thread with that model instead of doing substantial work in the polling thread.',
    '- Keep token use low: read this dispatch card, the worker handoff, and only the scoped files needed for the assigned work.',
    '',
    '## Objective',
    job.objective,
    '',
    '## Context Map',
    '### Primary',
    ...renderMarkdownList(job.scope),
    '',
    '### Secondary',
    ...renderMarkdownList(job.outOfScope.length > 0 ? job.outOfScope : ['No extra files or repos are allowed unless the captain amends this dispatch.']),
    '',
    '### Test Coverage',
    ...renderMarkdownList(job.validators),
    '',
    '### Patterns to Follow',
    '- Follow existing repository patterns and the active ATM task-card contract.',
    '- If scope is unclear, report blocked instead of guessing.',
    '',
    '## Scope Paths',
    ...renderMarkdownList(job.scope),
    '',
    '## Deliverables',
    ...renderMarkdownList(job.deliverables),
    '',
    '## Out Of Scope / Forbidden',
    ...renderMarkdownList(job.outOfScope.length > 0
      ? job.outOfScope
      : [
          'Do not edit files outside scopePaths/deliverables.',
          'Do not hand-edit .atm/runtime/** or .atm/history/**.',
          'Do not report done without real deliverables and validation evidence.'
        ]),
    '',
    '## Validators',
    ...renderMarkdownList(job.validators),
    '',
    '## Completion Gate',
    '- A report that only says ok, done, completed, or mailbox lifecycle completed is invalid.',
    '- If the requested work was not actually performed, return status=blocked or needs-captain-review instead of status=done.',
    '- Before status=done, run the validators or explain exactly why a validator could not be run.',
    '- Include command-backed evidence when the task asks for command-backed evidence.',
    '',
    '## Report Contract',
    `Return a Markdown report to captain/inbox with dispatch_id=${dispatchId}, from_agent=${agent.id}, to_agent=captain, and status matching the result.`,
    '',
    'The report body must follow any more specific report format written in this dispatch card. If no stricter format is present, include: work performed, commands run, files/artifacts touched, validator results, blockers/residual risk, and next recommendation.',
    ...(originalBody
      ? [
          '',
          '## Original Captain Task Card Body',
          '',
          originalBody
        ]
      : []),
    ''
  ].join('\n'), { fromAgent: 'captain', toAgent: agent.id, taskId: job.id, dispatchId });
}

function renderYamlList(items: string[] | null | undefined, indent = '  '): string[] {
  if (!items || items.length === 0) {
    return [`${indent}- none`];
  }
  return items.map((item) => `${indent}- ${quoteYamlValue(item)}`);
}

function renderMarkdownList(items: string[] | null | undefined): string[] {
  if (!items || items.length === 0) {
    return ['- None'];
  }
  return items.map((item) => `- ${item}`);
}

function quoteYamlValue(value: unknown): string {
  return `"${escapeFrontMatterValue(value)}"`;
}

function formatTimestampTag(isoTimestamp: string): string {
  const parsedMs = Date.parse(isoTimestamp || '');
  const safeIso = Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : new Date().toISOString();
  const compact = safeIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return compact.replace('T', '-');
}

function buildDispatchFileName(taskId: string, fromAgent: string, toAgent: string, isoTimestamp: string): string {
  return `${sanitizeFileName(taskId)}--${sanitizeFileName(fromAgent)}-to-${sanitizeFileName(toAgent)}--${formatTimestampTag(isoTimestamp)}.dispatch.md`;
}

function buildArchiveFileName(taskId: string, fromAgent: string, toAgent: string, isoTimestamp: string, extension = '.md'): string {
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  return `${sanitizeFileName(taskId)}--${sanitizeFileName(fromAgent)}-to-${sanitizeFileName(toAgent)}--${formatTimestampTag(isoTimestamp)}.queue${normalizedExtension}`;
}

function buildReportFileName(taskId: string, fromAgent: string, toAgent: string, isoTimestamp: string): string {
  return `${sanitizeFileName(taskId)}--${sanitizeFileName(fromAgent)}-to-${sanitizeFileName(toAgent)}--${formatTimestampTag(isoTimestamp)}.report.md`;
}

function finalizeDispatchMarkdown(markdown: string, options: { fromAgent: string; toAgent: string; taskId: string; dispatchId: string }): string {
  const lines = String(markdown || '').split('\n');
  let inFrontMatter = false;
  let frontMatterBoundaries = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      frontMatterBoundaries += 1;
      inFrontMatter = frontMatterBoundaries === 1;
      continue;
    }
    if (frontMatterBoundaries < 2) {
      continue;
    }
    if (lines[index].trim().length === 0) {
      continue;
    }
    lines[index] = `Dispatch: ${options.fromAgent} -> ${options.toAgent} | Task: ${options.taskId} | Dispatch: ${options.dispatchId}`;
    break;
  }

  return lines.join('\n');
}

function parseMarkdownFile(filePath: string): ParsedMarkdown {
  const text = readFileSync(filePath, 'utf8');
  const frontMatter = {};
  let rawFrontMatter = null;
  let body = text;

  const extracted = extractFrontMatter(text);
  if (extracted) {
    rawFrontMatter = extracted.raw;
    body = text.slice(extracted.endIndex).trimStart();
    Object.assign(frontMatter, extracted.data);
  }

  const heading = body.split(/\r?\n/).find((line) => line.startsWith('# '))?.replace(/^#\s+/, '').trim() || null;
  return { frontMatter, heading, body, rawFrontMatter };
}

function extractFrontMatter(text: string): { data: FrontMatter; raw: string; endIndex: number } | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!match) {
    return null;
  }

  const raw = match[1];
  const data: FrontMatter = {};
  let currentKey = null;
  let currentObjectKey = null;
  let currentObjectListKey = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
      const colonIndex = line.indexOf(':');
      const key = line.slice(0, colonIndex).trim();
      const value = normalizeYamlScalar(line.slice(colonIndex + 1).trim());
      currentKey = key;
      currentObjectKey = value.length === 0 ? key : null;
      currentObjectListKey = null;
      data[key] = value;
      continue;
    }

    const objectFieldMatch = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (currentObjectKey && objectFieldMatch) {
      const objectValue = data[currentObjectKey];
      const objectRecord: YamlRecord = objectValue && typeof objectValue === 'object' && !Array.isArray(objectValue)
        ? objectValue as YamlRecord
        : {};
      const key = objectFieldMatch[1];
      const value = normalizeYamlScalar(objectFieldMatch[2].trim());
      objectRecord[key] = value;
      data[currentObjectKey] = objectRecord;
      currentObjectListKey = value.length === 0 ? key : null;
      continue;
    }

    if (currentObjectKey && currentObjectListKey && /^ {4}-\s+/.test(line)) {
      const objectRecord = data[currentObjectKey] as YamlRecord;
      const value = normalizeYamlScalar(line.replace(/^ {4}-\s+/, '').trim());
      const existing = objectRecord[currentObjectListKey];
      objectRecord[currentObjectListKey] = Array.isArray(existing)
        ? [...existing, value]
        : typeof existing === 'string' && existing.length > 0
          ? [existing, value]
          : [value];
      data[currentObjectKey] = objectRecord;
      continue;
    }

    if (currentKey && /^\s*-\s+/.test(line)) {
      const value = normalizeYamlScalar(line.replace(/^\s*-\s+/, '').trim());
      const existing = data[currentKey];
      if (Array.isArray(existing)) {
        data[currentKey] = [...existing, value];
      } else if (typeof existing === 'string' && existing.length === 0) {
        data[currentKey] = [value];
      } else if (typeof existing === 'string') {
        data[currentKey] = [existing, value];
      } else {
        data[currentKey] = [value];
      }
    }
  }

  return {
    data,
    raw,
    endIndex: match.index + match[0].length
  };
}

function normalizeYamlScalar(value: unknown): string {
  return String(value || '').trim().replace(/^['"`]|['"`]$/g, '');
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? normalizeYamlScalar(value) : null;
}

function sanitizeFrontMatterBlock(rawFrontMatter: string | null | undefined, keysToRemove: Set<string>): string {
  const keptLines = [];
  let skipCurrentTopLevel = false;

  for (const line of String(rawFrontMatter || '').split(/\r?\n/)) {
    const topLevelMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
    if (topLevelMatch) {
      skipCurrentTopLevel = keysToRemove.has(topLevelMatch[1]);
      if (!skipCurrentTopLevel) {
        keptLines.push(line);
      }
      continue;
    }

    if (!skipCurrentTopLevel) {
      keptLines.push(line);
    }
  }

  return keptLines.join('\n').trim();
}

function ensureDispatchBody(body: string | null | undefined, options: { fromAgent: string; toAgent: string; taskId: string; dispatchId: string; workModel: string }): string {
  const sections = [];
  const trimmed = String(body || '').trim();

  sections.push(`Dispatch: ${options.fromAgent} -> ${options.toAgent} | Task: ${options.taskId} | Dispatch: ${options.dispatchId}`);
  if (trimmed) {
    sections.push('');
    sections.push(trimmed);
  }

  if (!/^#{1,6}\s*Mailbox Routing\b/im.test(trimmed)) {
    sections.push('');
    sections.push('## Mailbox Routing');
    sections.push(`- From agent: ${options.fromAgent}`);
    sections.push(`- To agent: ${options.toAgent}`);
    sections.push(`- Reply to: ${options.fromAgent}`);
    sections.push(`- Dispatch ID: ${options.dispatchId}`);
    sections.push(`- Work model: ${options.workModel}`);
  }

  if (!/^#{1,6}\s*(Report Contract|Report Format)\b/im.test(trimmed)) {
    sections.push('');
    sections.push('## Report Contract');
    sections.push('- Write the report as Markdown and return it to `captain/inbox`.');
    sections.push(`- The report must say who is reporting: ${options.toAgent}.`);
    sections.push(`- The report must say who receives the report: ${options.fromAgent}.`);
    sections.push(`- The report must name the task: ${options.taskId}.`);
    sections.push(`- The report must include dispatch_id: ${options.dispatchId}.`);
    sections.push('');
    sections.push('## Report Format');
    sections.push(`Report: ${options.toAgent} -> ${options.fromAgent} | Task: ${options.taskId} | Dispatch: ${options.dispatchId}`);
    sections.push('');
    sections.push('1. Outcome: PASS / CONCERN / BLOCK');
    sections.push('2. Claim status or execution status');
    sections.push('3. Files changed / artifacts touched');
    sections.push('4. Work summary');
    sections.push('5. Validator results: PASS / FAIL');
    sections.push('6. Blockers / residual risk');
    sections.push('7. Next recommendation');
  }

  return sections.join('\n').trim();
}

function ensureReportBody(body: string | null | undefined, options: { fromAgent: string; toAgent: string; taskId: string; dispatchId: string }): string {
  const sections = [];
  const trimmed = String(body || '').trim();

  sections.push(`Report: ${options.fromAgent} -> ${options.toAgent} | Task: ${options.taskId} | Dispatch: ${options.dispatchId}`);
  if (trimmed) {
    sections.push('');
    sections.push(trimmed);
  }

  if (!/^#{1,6}\s*Report Summary\b/im.test(trimmed)) {
    sections.push('');
    sections.push('## Report Summary');
    sections.push('- Outcome: PASS / CONCERN / BLOCK');
    sections.push('- Work performed');
    sections.push('- Files changed / artifacts touched');
    sections.push('- Validator results');
    sections.push('- Blockers / residual risk');
    sections.push('- Next recommendation');
  }

  return sections.join('\n').trim();
}

function isThinReportBody(body: string | null | undefined): boolean {
  const normalized = String(body || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.length < 40) {
    return true;
  }
  const compact = normalized.replace(/\s+/g, ' ');
  return ['ok', 'okay', 'done', 'completed', 'pass', 'looks good'].includes(compact);
}

function loadWorkerReportFile(reportFilePath: string, options: { dispatchId: string; taskId: string; fromAgent: string; toAgent: string; agentModel: string; defaultStatus: string }): { status: string; markdown: string } | { error: string } {
  const resolvedPath = path.resolve(reportFilePath);
  if (!existsSync(resolvedPath)) {
    return { error: `Worker report file does not exist: ${resolvedPath}` };
  }

  const parsed = parseMarkdownFile(resolvedPath);
  const reportStatus = normalizeOptionalString(fmString(parsed.frontMatter, 'status')) || options.defaultStatus;
  const fromAgent = normalizeOptionalString(fmString(parsed.frontMatter, 'from_agent', 'agent')) || options.fromAgent;
  const toAgent = normalizeOptionalString(fmString(parsed.frontMatter, 'to_agent', 'reply_to')) || options.toAgent;
  const taskId = normalizeOptionalString(fmString(parsed.frontMatter, 'task_id', 'source_job_id')) || options.taskId;
  const dispatchId = normalizeOptionalString(fmString(parsed.frontMatter, 'dispatch_id')) || options.dispatchId;
  const reportBody = ensureReportBody(parsed.body, { fromAgent, toAgent, taskId, dispatchId });

  if (String(reportStatus).toLowerCase() === 'done' && isThinReportBody(reportBody)) {
    return { error: `Worker report file is too thin for status=done: ${resolvedPath}` };
  }

  const markdown = [
    '---',
    `type: ${quoteYamlValue('captain-dispatch-report')}`,
    `dispatch_id: ${quoteYamlValue(dispatchId)}`,
    `task_id: ${quoteYamlValue(taskId)}`,
    `agent: ${quoteYamlValue(fromAgent)}`,
    `from_agent: ${quoteYamlValue(fromAgent)}`,
    `to_agent: ${quoteYamlValue(toAgent)}`,
    `status: ${quoteYamlValue(reportStatus)}`,
    `completed_at: ${quoteYamlValue(new Date().toISOString())}`,
    '---',
    '',
    reportBody,
    ''
  ].join('\n');

  return {
    status: reportStatus,
    markdown
  };
}
function listFiles(dir: string, extensions: string[] | null = null): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((filePath) => {
      if (statSync(filePath).isDirectory()) {
        return false;
      }
      if (!extensions) {
        return true;
      }
      return extensions.includes(path.extname(filePath).toLowerCase());
    })
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs || left.localeCompare(right));
}

function uniquePath(targetPath: string): string {
  if (!existsSync(targetPath)) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);
  for (let index = 2; ; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

function sanitizeFileName(value: unknown): string {
  return String(value || 'item')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function escapeFrontMatterValue(value: unknown): string {
  return String(value).replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function buildDecisionBasis(summary: MailboxSummary, options: MailboxOptions): string[] {
  const basis: string[] = [];
  if (summary.stopLoss.shouldStop) {
    basis.push(`Stop-loss triggered for ${summary.stopLoss.actor}: ${summary.stopLoss.reason}`);
  } else if (summary.stopLoss.cleared && summary.stopLoss.reason) {
    basis.push(summary.stopLoss.reason);
  } else if (summary.stopLoss.paused) {
    basis.push(`${summary.stopLoss.actor} is paused by stop-loss; no mailbox work was processed.`);
  }

  if (options.role === 'captain' || options.role === 'all') {
    if (summary.seededDemoJobs.length > 0) {
      basis.push(`Seeded ${summary.seededDemoJobs.length} demo job(s) because --seed-demo was requested and the queue was empty.`);
    }
    if (summary.dispatched.length > 0) {
      basis.push(`Dispatched ${summary.dispatched.length} queued job(s) according to assignee metadata or lowest visible mailbox load.`);
    }
    if (summary.reportsReceived.length > 0) {
      basis.push(`Archived ${summary.reportsReceived.length} returned report(s) from captain/inbox.`);
    }
    if (summary.dispatched.length === 0 && summary.reportsReceived.length === 0) {
      basis.push('No queued captain work or returned reports were present, so the captain cycle stayed idle.');
    }
    if (summary.staleUnclaimed.length > 0) {
      basis.push(`Detected ${summary.staleUnclaimed.length} stale unclaimed dispatch(es) for captain review.`);
    }
  }

  if (options.role === 'worker') {
    if (summary.completed.length > 0) {
      basis.push(`Worker ${options.agentId} completed active dispatch and sent a report to captain/inbox.`);
    } else if (summary.claimed.length > 0) {
      basis.push(`Worker ${options.agentId} claimed the next inbox dispatch because it had no active work.`);
    } else if (summary.busyAgents.length > 0) {
      basis.push(`Worker ${options.agentId} already has active work, so it did not claim another dispatch.`);
    } else if (options.agentId && summary.idleAgents.includes(options.agentId)) {
      basis.push(`Worker ${options.agentId} inbox was empty and it had no active work.`);
    }
  }

  if (summary.errors.length > 0) {
    basis.push(`Encountered ${summary.errors.length} error(s); review errors before continuing.`);
  }

  return basis;
}

function chooseNextAction(summary: MailboxSummary, options: MailboxOptions): string {
  if (summary.stopLoss.shouldStop || summary.stopLoss.paused) {
    return 'pause-automation-stop-loss';
  }
  if (summary.errors.length > 0) {
    return 'review-errors';
  }
  if (summary.staleUnclaimed.length > 0) {
    return 'captain-review-stale-dispatches';
  }
  if (options.role === 'worker' && summary.claimed.length > 0 && summary.completed.length === 0) {
    return 'worker-process-active-dispatch';
  }
  if (summary.readyForNextCycle) {
    return 'wait-for-next-cycle';
  }
  return 'continue-polling';
}

function emitSummary(summary: MailboxSummary, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Captain mailbox cycle: ${summary.ok ? 'ok' : 'needs attention'}`);
  console.log(`Root: ${summary.root}`);
  console.log(`Dispatched: ${summary.dispatched.length}`);
  console.log(`Claimed: ${summary.claimed.length}`);
  console.log(`Completed: ${summary.completed.length}`);
  console.log(`Reports received: ${summary.reportsReceived.length}`);
  console.log(`Stale unclaimed: ${summary.staleUnclaimed.length}`);
  console.log(`Stop-loss: ${summary.stopLoss.shouldStop ? `${summary.stopLoss.trigger} (${summary.stopLoss.reportPath})` : 'not triggered'}`);
  if (summary.errors.length > 0) {
    console.log('Errors:');
    for (const error of summary.errors) {
      console.log(`- ${error}`);
    }
  }
}

function createSummary(root: string, options: MailboxOptions): MailboxSummary {
  return {
    ok: true,
    root: toPortablePath(root),
    cycleStartedAt: new Date().toISOString(),
    captain: { id: 'captain', model: options.captainModel },
    agents: options.agents,
    role: options.role,
    decisionPacket: {
      skillUsed: 'atm-dispatch',
      delegationMode: options.role === 'worker' ? 'external handoff worker thread' : 'captain control thread',
      basis: [],
      nextAction: null
    },
    seededDemoJobs: [],
    cycleInputBacklog: null,
    dispatched: [],
    claimed: [],
    completed: [],
    reportsReceived: [],
    idleAgents: [],
    busyAgents: [],
    staleUnclaimed: [],
    backlog: null,
    stopLoss: {
      shouldStop: false,
      paused: false,
      cleared: false,
      actor: options.role === 'worker' ? `worker-${options.agentId}` : 'captain',
      automationId: options.role === 'worker' ? `mailbox-worker-${options.agentId}-polling` : 'captain-mailbox-polling',
      trigger: null,
      reason: null,
      reportPath: null,
      thresholds: {
        captainNoReportLimit: options.captainNoReportLimit,
        captainNoDispatchMinutes: options.captainNoDispatchMinutes,
        workerNoDispatchLimit: options.workerNoDispatchLimit,
        workerNoReportMinutes: options.workerNoReportMinutes
      },
      counters: {},
      activeDispatches: []
    },
    handoffPath: null,
    readyForNextCycle: false,
    errors: []
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const root = path.resolve(options.root);
  if (options.reset && existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }

  const layout = resolveLayout(root, options.agents);
  ensureLayout(layout);
  const releaseLock = acquireLock(layout);
  const summary = createSummary(root, options);

  try {
    const ledger = readLedger(layout, options);
    if (options.clearStopLoss) {
      clearActorStopLoss(ledger, options, summary);
    }
    summary.cycleInputBacklog = computeBacklog(layout, options);

    if (!options.clearStopLoss) {
      if (isActorStopLossPaused(ledger, options)) {
        markAlreadyPausedStopLoss(layout, ledger, options, summary);
      } else {
        if (options.seedDemo) {
          summary.seededDemoJobs = seedDemoQueue(layout);
        }
        summary.cycleInputBacklog = computeBacklog(layout, options);

        if (options.role === 'captain') {
          receiveCaptainReports(layout, ledger, summary, 'cycle-start');
          dispatchQueuedWork(layout, ledger, options, summary);
          receiveCaptainReports(layout, ledger, summary, 'cycle-end');
        } else if (options.role === 'worker') {
          pollOneWorker(layout, ledger, options, summary);
        } else {
          receiveCaptainReports(layout, ledger, summary, 'cycle-start');
          dispatchQueuedWork(layout, ledger, options, summary);
          pollWorkers(layout, ledger, options, summary);
          receiveCaptainReports(layout, ledger, summary, 'cycle-end');
        }
      }
    }

    summary.staleUnclaimed = scanUnclaimed(layout, options);
    summary.backlog = computeBacklog(layout, options);
    if (!summary.stopLoss.paused && !options.clearStopLoss) {
      evaluateStopLoss(layout, ledger, options, summary);
    }
    summary.readyForNextCycle = !summary.stopLoss.shouldStop
      && summary.backlog.captain.queue === 0
      && summary.backlog.captain.inbox === 0
      && Object.values(summary.backlog.agents).every((agent) => agent.inbox === 0 && agent.active === 0)
      && summary.staleUnclaimed.length === 0;
    summary.decisionPacket.basis = buildDecisionBasis(summary, options);
    summary.decisionPacket.nextAction = chooseNextAction(summary, options);
    if (options.role === 'captain' || options.role === 'all') {
      summary.handoffPath = writeCaptainHandoff(layout, ledger, summary);
    } else if (options.role === 'worker') {
      summary.handoffPath = writeWorkerHandoff(layout, options, summary);
    }
    summary.ok = summary.errors.length === 0 && (!options.assertClean || summary.readyForNextCycle || summary.stopLoss.shouldStop);
    summary.cycleFinishedAt = new Date().toISOString();

    writeLedger(layout, ledger);
  } finally {
    releaseLock();
  }

  emitSummary(summary, options.json);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[captain-dispatch-mailbox] ${error.message}`);
  process.exitCode = 1;
});
