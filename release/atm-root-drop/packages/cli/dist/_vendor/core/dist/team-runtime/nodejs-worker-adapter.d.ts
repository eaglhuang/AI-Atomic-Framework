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
export declare const NODEJS_REFERENCE_WORKER_ADAPTER_ID = "atm.node.reference-worker";
export declare const BROKER_ONLY_FALLBACK_ADAPTER_ID = "atm.node.broker-only-fallback";
export declare const EDITOR_SUBAGENT_BRIDGE_ADAPTER_ID = "atm.editor.subagent-bridge";
export declare function resolveNodejsTeamWorkerAdapter(input: {
    readonly runtimeMode?: unknown;
    readonly runtimeLanguage?: unknown;
    readonly runtimeAdapterId?: unknown;
    readonly providerId?: unknown;
    readonly sdkId?: unknown;
    readonly modelId?: unknown;
}): TeamWorkerAdapterContract;
