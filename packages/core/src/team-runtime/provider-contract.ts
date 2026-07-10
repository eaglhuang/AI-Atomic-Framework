export const TEAM_PROVIDER_IDS = [
  'openai',
  'azure-openai',
  'claude-code',
  'gemini',
  'microsoft-foundry'
] as const;

export type TeamProviderId = typeof TEAM_PROVIDER_IDS[number];

export type TeamProviderSessionLifecycle = {
  readonly createSession: true;
  readonly closeSession: true;
  readonly cancelSession: true;
  readonly retryStep: true;
};

export type TeamProviderMetadata = {
  readonly providerId: TeamProviderId;
  readonly displayName: string;
  readonly supportedRuntimeModes: readonly ('real-agent' | 'editor-subagent' | 'broker-only')[];
  readonly supportedArtifacts: readonly string[];
  readonly vendorNeutral: true;
};

export type TeamProviderSessionRequest = {
  readonly taskId: string;
  readonly role: string;
  readonly runtimeMode: 'real-agent' | 'editor-subagent' | 'broker-only';
  readonly providerId: TeamProviderId;
  readonly sdkId: string;
  readonly modelId: string;
  readonly input?: string;
  readonly instructions?: string;
};

export type TeamProviderStepResult = {
  readonly ok: boolean;
  readonly providerId: TeamProviderId;
  readonly role: string;
  readonly artifacts: readonly string[];
  readonly retryable: boolean;
  readonly summary: string;
};

export type TeamProviderExecutionInput = {
  readonly request: TeamProviderSessionRequest;
  readonly sessionId: string;
  readonly input: string;
  readonly instructions?: string;
  readonly scopedPaths: readonly string[];
};

export type TeamProviderExecutionResult = {
  readonly ok: boolean;
  readonly statusCode?: number;
  readonly outputText: string;
  readonly outputArtifacts?: readonly string[];
  readonly retryable: boolean;
  readonly summary: string;
  readonly executionMode: 'vendor-api' | 'editor-cli';
};

export type TeamProviderHttpExecutor = (input: {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly timeoutMs?: number;
}) => Promise<TeamProviderExecutionResult>;

export type TeamProviderCommandExecutor = (input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly stdin: string;
}) => Promise<TeamProviderExecutionResult>;

export interface TeamProviderContract {
  readonly schemaId: 'atm.teamProviderContract.v1';
  readonly metadata: TeamProviderMetadata;
  readonly sessionLifecycle: TeamProviderSessionLifecycle;
  openSession(request: TeamProviderSessionRequest): { sessionId: string; providerId: TeamProviderId };
  closeSession(sessionId: string): { closed: true; sessionId: string };
  cancelSession(sessionId: string, reason: string): { cancelled: true; sessionId: string; reason: string };
}

export function createTeamProviderMetadata(providerId: TeamProviderId): TeamProviderMetadata {
  return {
    providerId,
    displayName: providerId,
    supportedRuntimeModes: ['real-agent', 'editor-subagent', 'broker-only'],
    supportedArtifacts: ['agent-report', 'validator-report', 'evidence-summary'],
    vendorNeutral: true
  };
}

export function createTeamProviderContract(providerId: TeamProviderId): TeamProviderContract {
  return {
    schemaId: 'atm.teamProviderContract.v1',
    metadata: createTeamProviderMetadata(providerId),
    sessionLifecycle: {
      createSession: true,
      closeSession: true,
      cancelSession: true,
      retryStep: true
    },
    openSession(request) {
      return {
        sessionId: `${request.taskId}:${request.role}:${providerId}`,
        providerId
      };
    },
    closeSession(sessionId) {
      return {
        closed: true,
        sessionId
      };
    },
    cancelSession(sessionId, reason) {
      return {
        cancelled: true,
        sessionId,
        reason
      };
    }
  };
}

export function supportsVendorNeutralProviders(metadata: TeamProviderMetadata[]): boolean {
  const seen = new Set(metadata.map((entry) => entry.providerId));
  return TEAM_PROVIDER_IDS.every((providerId) => seen.has(providerId));
}
