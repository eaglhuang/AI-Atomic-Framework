export interface DaemonFeatureFlags {
    daemonEnabled: boolean;
    enabledAt?: string;
    enabledBy?: string;
}
export interface DaemonPidRecord {
    pid: number;
    startedAt: string;
    repositoryRoot: string;
    watchPaths: string[];
}
export declare function getDaemonDir(repositoryRoot: string): string;
export declare function getDaemonPidPath(repositoryRoot: string): string;
export declare function getDaemonNotificationsPath(repositoryRoot: string): string;
export declare function isDaemonEnabled(repositoryRoot: string): boolean;
export declare function enableDaemon(repositoryRoot: string, enabledBy?: string): void;
export declare function disableDaemon(repositoryRoot: string): void;
export declare function readDaemonPid(repositoryRoot: string): DaemonPidRecord | null;
export declare function writeDaemonPid(repositoryRoot: string, record: DaemonPidRecord): void;
export declare function clearDaemonPid(repositoryRoot: string): void;
export declare function isProcessRunning(pid: number): boolean;
export declare function appendDaemonNotification(repositoryRoot: string, notification: Record<string, unknown>): void;
export declare function readDaemonNotifications(repositoryRoot: string, tail?: number): Array<Record<string, unknown>>;
