import type { SharedSurfaceQueue } from './shared-surface-queue.ts';
export type BrokerQueueNotification = {
    readonly schemaId: 'atm.brokerQueueNotification.v1';
    readonly eventType: 'broker.shared-surface.release-requested' | 'broker.shared-surface.queued';
    readonly transactionId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly surfacePath: string;
    readonly queuePosition: number;
    readonly queueHeadTaskId: string;
    readonly createdAt: string;
    readonly action: string;
};
export declare function writeBrokerQueueNotifications(input: {
    readonly cwd: string;
    readonly queues: readonly SharedSurfaceQueue[];
    readonly waiterTaskId: string;
    readonly transactionId: string;
}): readonly BrokerQueueNotification[];
