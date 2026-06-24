type TeamRunCleanupRecord = {
    teamRunId: string;
    taskId: string;
    path: string;
    reason: 'terminal-task';
    terminalTaskStatus: string;
};
export declare function cleanupStaleTeamRunsForTerminalTasks(input: {
    cwd: string;
    taskId?: string;
    terminalTaskStatus?: string | null;
}): TeamRunCleanupRecord[];
export {};
