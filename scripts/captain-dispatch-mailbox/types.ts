export type Role = 'captain' | 'worker' | 'all';
export type FrontMatter = Record<string, unknown>;
export type YamlRecord = Record<string, string | string[]>;

export interface AgentRef {
  id: string;
  model: string;
}

export interface MailboxOptions {
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

export interface AgentLayout {
  root: string;
  inbox: string;
  active: string;
  done: string;
  reports: string;
  handoff: string;
  stopLoss: string;
}

export interface CaptainLayout {
  root: string;
  inbox: string;
  outbox: string;
  reports: string;
  queue: string;
  archive: string;
  handoff: string;
  stopLoss: string;
}

export interface MailboxLayout {
  root: string;
  state: string;
  ledger: string;
  lock: string;
  captain: CaptainLayout;
  agents: Map<string, AgentLayout>;
}

export interface CaptainStopLossState {
  noReportCycles: number;
  noDispatchSince: string | null;
  paused: boolean;
  stoppedAt: string | null;
  lastTrigger: string | null;
  lastStopLossReportPath: string | null;
}

export interface WorkerStopLossState {
  noDispatchCycles: number;
  activeSince: string | null;
  paused: boolean;
  stoppedAt: string | null;
  lastTrigger: string | null;
  lastStopLossReportPath: string | null;
}

export interface StopLossState {
  captain: CaptainStopLossState;
  workers: Record<string, WorkerStopLossState>;
}

export interface DispatchRecord {
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

export interface Ledger {
  schemaVersion: number;
  captain: { id: string; model: string };
  agents: AgentRef[];
  dispatches: Record<string, DispatchRecord>;
  stopLoss: StopLossState;
}

export interface QueueJob {
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

export interface ParsedMarkdown {
  frontMatter: FrontMatter;
  heading: string | null;
  body: string;
  rawFrontMatter: string | null;
}

export interface AgentBacklog {
  inbox: number;
  active: number;
  done: number;
  reports: number;
}

export interface BacklogSnapshot {
  captain: {
    queue: number;
    inbox: number;
    outbox: number;
    reports: number;
  };
  agents: Record<string, AgentBacklog>;
}

export interface WorkerReportOptions {
  status?: string;
  summary?: string | null;
  evidence?: string[];
  reportMarkdown?: string;
}

export interface MailboxSummary {
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
