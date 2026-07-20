export declare function evidencePathForTask(cwd: string, taskId: string): string;
export declare function taskPathForEvidence(cwd: string, taskId: string): string;
export declare function readTaskDocument(cwd: string, taskId: string): Record<string, unknown> | null;
export declare function readEvidenceBundle(cwd: string, taskId: string): {
    evidence: readonly Record<string, unknown>[];
};
export declare function buildAutoEvidenceRequiredCommand(taskId: string, actorId: string, command: string, gate: string, runnerKind: 'dev-source' | 'frozen-runner'): string;
