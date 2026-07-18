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
  readonly adapterId?: string | null;
  readonly filePath?: string | null;
  readonly mergeDecision?: string | null;
  readonly verdict?: string | null;
  readonly transactionId?: string | null;
  readonly baseHash?: string | null;
  readonly resultHash?: string | null;
}

export interface BrokerExperimentRun {
  readonly runId?: string | null;
  readonly plan?: { readonly planId?: string | null };
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

export interface RegistryAdmission {
  readonly trigger?: string | null;
  readonly state?: string | null;
}

export interface RegistryActiveIntent {
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

export interface BrokerRegistryDocument {
  readonly schemaId?: string | null;
  readonly activeIntents?: readonly RegistryActiveIntent[] | null;
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
}

export interface GitBoundaryEvidenceEnvelope {
  readonly schemaId?: string | null;
  readonly actorId?: string | null;
  readonly remoteVirtualActorId?: string | null;
  readonly taskId?: string | null;
  readonly branch?: string | null;
  readonly remoteRef?: string | null;
  readonly baseCommit?: string | null;
  readonly localHead?: string | null;
  readonly remoteHead?: string | null;
  readonly targetFiles?: readonly string[] | null;
  readonly lane?: string | null;
  readonly verdict?: string | null;
  readonly outcome?: string | null;
  readonly recommendation?: string | null;
  readonly artifactPaths?: readonly string[] | null;
}

export interface TaskArtifactSummary {
  taskId: string;
  closurePacket: string;
  teamRuns: string;
}


export type ArgMap = Record<string, string | boolean | undefined>;

export type StringSet = ReadonlySet<string>;

