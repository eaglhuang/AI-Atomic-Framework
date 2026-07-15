// @ts-nocheck
export interface BrokerCommandContext {
  readonly registryPath: string;
  readonly sharedQueuePath: string;
  readonly sharedFreezePath: string;
  readonly runnerSyncQueuePath: string;
  readonly projectionStewardPath: string;
}

export type SharedSurfaceFreezeRecord = {
  readonly schemaId: 'atm.brokerSharedSurfaceFreeze.v1';
  readonly surfacePath: string;
  readonly waitingTaskId: string;
  readonly waitingActorId: string;
  readonly signal: any;
  readonly ack?: any;
  readonly resolution?: any;
  readonly status: 'pending' | 'acknowledged' | 'released';
  readonly requiredNextAction: 'publish-patch-proposal-or-release';
  readonly createdAt: string;
  readonly updatedAt: string;
};
