export interface BrokerEnvelopeRecord {
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

export interface BrokerEnvelope {
  readonly schemaId?: string | null;
  readonly runId?: string | null;
  readonly planId?: string | null;
  readonly records?: readonly BrokerEnvelopeRecord[] | null;
}

export interface BrokerMutationEvidence {
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

export interface BrokerExperimentRun {
  readonly runId?: string | null;
  readonly plan?: {
    readonly planId?: string | null;
  };
  readonly mutationEvidence?: readonly BrokerMutationEvidence[] | null;
  readonly runEvidencePath?: string | null;
}

export interface TeamRun {
  readonly schemaId?: string | null;
  readonly teamRunId?: string | null;
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly planId?: string | null;
  readonly brokerLane?: unknown;
}

export interface BrokerRunSummary {
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

export interface TaskArtifactSummary {
  taskId: string;
  closurePacket: string;
  teamRuns: string;
}

export type ArgValue = string | true | string[];
export type ArgMap = Record<string, ArgValue>;

export type StringSet = ReadonlySet<string>;

export type RunSource = {
  filePath: string;
};

export interface CommandResult {
  command: string;
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CapturePayload {
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

