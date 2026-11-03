/** Admit only the exact, actor-bound transition emitted by batch skip/resume. */
export declare function isAuthorizedBatchRecoveryEvent(cwd: string, currentTaskId: string | null, filePath: string): boolean;
