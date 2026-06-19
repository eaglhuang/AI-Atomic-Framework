export type TeamWorkerRuntimeMode = 'real-agent' | 'editor-subagent' | 'broker-only';

export type TeamWorkerExecutionSurface = 'agent-runtime' | 'editor-subagent' | 'broker-governance';

export type TeamWorkerSpawnStrategy = 'spawn-worker' | 'editor-managed' | 'disabled';

export interface TeamWorkerAdapterContract {
  readonly schemaId: 'atm.teamWorkerAdapterContract.v1';
  readonly adapterId: string;
  readonly runtimeMode: TeamWorkerRuntimeMode;
  readonly runtimeLanguage: string;
  readonly executionSurface: TeamWorkerExecutionSurface;
  readonly providerId: string;
  readonly sdkId: string;
  readonly modelId: string;
  readonly spawnStrategy: TeamWorkerSpawnStrategy;
  readonly agentsSpawned: boolean;
  readonly brokerFallback: {
    readonly enabled: boolean;
    readonly reason: string | null;
    readonly preservesGovernance: readonly string[];
  };
  readonly authorityBoundary: {
    readonly gitWrite: false;
    readonly taskLifecycle: false;
    readonly selfClose: false;
    readonly evidenceWriteOwner: 'coordinator';
  };
  readonly vendorNeutral: true;
  readonly artifactContractPreserved: true;
  readonly retryContractPreserved: true;
}

export const NODEJS_REFERENCE_WORKER_ADAPTER_ID = 'atm.node.reference-worker';
export const BROKER_ONLY_FALLBACK_ADAPTER_ID = 'atm.node.broker-only-fallback';
export const EDITOR_SUBAGENT_BRIDGE_ADAPTER_ID = 'atm.editor.subagent-bridge';

export function resolveNodejsTeamWorkerAdapter(input: {
  readonly runtimeMode?: unknown;
  readonly runtimeLanguage?: unknown;
  readonly runtimeAdapterId?: unknown;
  readonly providerId?: unknown;
  readonly sdkId?: unknown;
  readonly modelId?: unknown;
}): TeamWorkerAdapterContract {
  const runtimeMode = normalizeTeamWorkerRuntimeMode(input.runtimeMode);
  const runtimeLanguage = normalizeOptionalString(input.runtimeLanguage) ?? 'node';
  const providerId = normalizeOptionalString(input.providerId) ?? 'local';
  const sdkId = normalizeOptionalString(input.sdkId) ?? (runtimeMode === 'real-agent' ? 'nodejs' : 'none');
  const modelId = normalizeOptionalString(input.modelId) ?? (runtimeMode === 'real-agent' ? 'provider-selected' : 'none');
  const adapterId = normalizeOptionalString(input.runtimeAdapterId) ?? defaultAdapterIdForMode(runtimeMode);
  const executionSurface = executionSurfaceForMode(runtimeMode);
  const agentsSpawned = runtimeMode !== 'broker-only';
  return {
    schemaId: 'atm.teamWorkerAdapterContract.v1',
    adapterId,
    runtimeMode,
    runtimeLanguage,
    executionSurface,
    providerId,
    sdkId,
    modelId,
    spawnStrategy: runtimeMode === 'real-agent'
      ? 'spawn-worker'
      : runtimeMode === 'editor-subagent'
        ? 'editor-managed'
        : 'disabled',
    agentsSpawned,
    brokerFallback: {
      enabled: runtimeMode === 'broker-only',
      reason: runtimeMode === 'broker-only'
        ? 'agent spawning disabled; broker governance remains authoritative'
        : null,
      preservesGovernance: [
        'broker',
        'permission-leases',
        'validators',
        'police',
        'evidence',
        'artifact-contract',
        'retry-contract'
      ]
    },
    authorityBoundary: {
      gitWrite: false,
      taskLifecycle: false,
      selfClose: false,
      evidenceWriteOwner: 'coordinator'
    },
    vendorNeutral: true,
    artifactContractPreserved: true,
    retryContractPreserved: true
  };
}

function normalizeTeamWorkerRuntimeMode(value: unknown): TeamWorkerRuntimeMode {
  const normalized = String(value ?? 'broker-only').trim();
  if (normalized === 'real-agent' || normalized === 'editor-subagent' || normalized === 'broker-only') {
    return normalized;
  }
  return 'broker-only';
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function defaultAdapterIdForMode(runtimeMode: TeamWorkerRuntimeMode): string {
  if (runtimeMode === 'real-agent') return NODEJS_REFERENCE_WORKER_ADAPTER_ID;
  if (runtimeMode === 'editor-subagent') return EDITOR_SUBAGENT_BRIDGE_ADAPTER_ID;
  return BROKER_ONLY_FALLBACK_ADAPTER_ID;
}

function executionSurfaceForMode(runtimeMode: TeamWorkerRuntimeMode): TeamWorkerExecutionSurface {
  if (runtimeMode === 'real-agent') return 'agent-runtime';
  if (runtimeMode === 'editor-subagent') return 'editor-subagent';
  return 'broker-governance';
}
