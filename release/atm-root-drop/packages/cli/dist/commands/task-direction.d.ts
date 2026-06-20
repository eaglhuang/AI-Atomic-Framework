export interface TaskDirectionTask {
    readonly workItemId: string;
    readonly title: string;
    readonly taskPath: string;
    readonly sourcePlanPath: string | null;
    readonly nearbyPlanPaths: readonly string[];
    readonly scopePaths: readonly string[];
    readonly targetRepo: string | null;
    readonly allowPlanningMirror: boolean;
    readonly outOfScope?: readonly string[];
}
export interface TaskScopePartition {
    readonly planningContext: {
        readonly readOnlyPaths: readonly string[];
    };
    readonly targetWork: {
        readonly allowedFiles: readonly string[];
        readonly planningMirrorPaths: readonly string[];
        readonly allowPlanningMirror: boolean;
    };
}
export interface TaskQueueRecord {
    readonly schemaId: 'atm.taskQueue.v1';
    readonly specVersion: '0.1.0';
    readonly queueId: string;
    readonly batchId: string | null;
    readonly scopeKey: string | null;
    readonly sourcePrompt: string;
    readonly sourcePromptHash: string;
    readonly sourcePlanPath: string | null;
    readonly targetRepo: string | null;
    readonly taskIds: readonly string[];
    readonly tasks: readonly TaskDirectionTask[];
    readonly currentIndex: number;
    readonly status: 'active' | 'completed' | 'abandoned';
    readonly createdByActor: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly abandonedByActor?: string;
    readonly abandonedAt?: string;
    readonly abandonReason?: string;
}
export interface TaskDirectionLock {
    readonly schemaId: 'atm.taskDirectionLock.v1';
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly batchId: string | null;
    readonly scopeKey: string | null;
    readonly queueId: string | null;
    readonly queueIndex: number | null;
    readonly allowedFiles: readonly string[];
    readonly planningReadOnlyPaths: readonly string[];
    readonly planningMirrorPaths: readonly string[];
    readonly allowPlanningMirror: boolean;
    readonly promptHash: string | null;
    readonly actorId: string;
    readonly createdAt: string;
    readonly status: 'active';
}
export declare function createOrRefreshTaskQueue(input: {
    readonly cwd: string;
    readonly sourcePrompt: string;
    readonly tasks: readonly TaskDirectionTask[];
    readonly actorId?: string | null;
    readonly batchId?: string | null;
    readonly scopeKey?: string | null;
    readonly taskIds?: readonly string[] | null;
}): TaskQueueRecord;
export declare function findActiveTaskQueue(cwd: string, sourcePrompt?: string | null, selector?: {
    readonly queueId?: string | null;
    readonly batchId?: string | null;
    readonly scopeKey?: string | null;
    readonly taskId?: string | null;
}): TaskQueueRecord | null;
export declare function abandonTaskQueue(input: {
    readonly cwd: string;
    readonly queueId: string;
    readonly actorId: string;
    readonly reason?: string | null;
}): TaskQueueRecord;
export declare function advanceTaskQueueAfterClose(cwd: string, taskId: string, selector?: {
    readonly batchId?: string | null;
    readonly queueId?: string | null;
}): TaskQueueRecord | null;
export declare function advanceTaskQueueHead(cwd: string, taskId: string, selector?: {
    readonly batchId?: string | null;
    readonly queueId?: string | null;
}): TaskQueueRecord | null;
export declare function restoreTaskQueueHead(cwd: string, taskId: string, selector?: {
    readonly batchId?: string | null;
    readonly queueId?: string | null;
}): TaskQueueRecord | null;
export declare function buildTaskQueueStatus(cwd: string): {
    activeQueue: TaskQueueRecord | null;
    queueHeadTaskId: string | null;
};
export declare function writeTaskDirectionLock(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly queue: TaskQueueRecord | null;
    readonly batchId?: string | null;
    readonly scopeKey?: string | null;
    readonly allowedFiles: readonly string[];
    readonly planningReadOnlyPaths?: readonly string[];
    readonly planningMirrorPaths?: readonly string[];
    readonly allowPlanningMirror?: boolean;
    readonly prompt?: string | null;
}): TaskDirectionLock;
export declare function getCanonicalAllowedFilesForTask(cwd: string, taskId: string): readonly string[] | null;
export interface TaskDirectionAllowedFilesDiagnosis {
    readonly taskId: string;
    readonly hasGovernanceLock: boolean;
    readonly canonicalAllowedFiles: readonly string[] | null;
    readonly governanceLockFiles: readonly string[] | null;
    readonly claimFiles: readonly string[] | null;
    readonly mismatches: readonly TaskDirectionAllowedFilesMismatch[];
}
export interface TaskDirectionAllowedFilesMismatch {
    readonly source: 'governance-lock-files' | 'claim-files';
    readonly missingFromSource: readonly string[];
    readonly extraInSource: readonly string[];
}
export declare function diagnoseTaskDirectionLockAllowedFiles(cwd: string, taskId: string): TaskDirectionAllowedFilesDiagnosis;
export declare function readActiveTaskDirectionLocks(cwd: string): readonly TaskDirectionLock[];
export declare function assertTaskCloseAllowedByDirection(cwd: string, taskId: string, actorId: string, options?: {
    readonly allowHistoricalCloseback?: boolean;
}): void;
export declare function buildAllowedFilesForTask(task: TaskDirectionTask): readonly string[];
/**
 * TASK-AAO-0058：回傳任務自身治理路徑（task self-allow）的 canonical 三條路徑。
 * 這些路徑會在 writeTaskDirectionLock 建立鎖時自動併入 allowedFiles，
 * 讓 agent 在 evidence 收集、checkpoint 或 close 時不會被 ScopeLock 阻擋。
 *
 * 覆蓋範圍：
 *   - .atm/history/tasks/<task-id>.json
 *   - .atm/history/evidence/<task-id>.* （含 closure-packet.json）
 *   - .atm/history/task-events/<task-id>/**
 *
 * 不含整個 .atm/history/**，以保持精確邊界。
 */
export declare function buildTaskSelfAllowPaths(taskId: string): readonly string[];
export declare function partitionTaskScope(task: TaskDirectionTask, options?: {
    readonly cwd?: string;
}): TaskScopePartition;
export declare function sanitizeTaskDirectionAllowedFiles(values: readonly string[]): readonly string[];
export declare function isTaskDirectionPathCandidate(value: string): boolean;
export declare function isPlanningMirrorPath(filePath: string, planningMirrorPaths: readonly string[]): boolean;
export declare function toProjectPath(cwd: string, absolutePath: string): string;
