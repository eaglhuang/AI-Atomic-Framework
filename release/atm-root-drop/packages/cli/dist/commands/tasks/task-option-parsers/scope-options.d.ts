export declare function parseScopeAddOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    reason: string | null;
    actorId: string | null;
    claimFirst: boolean;
    emergencyApproval: string | null;
    addPaths: string[];
    /** 修改類型：doc-sync | help-snapshot-sync | test-alignment | generated-artifact | linked-surface */
    amendmentClass: string | null;
    /** 修改階段：pre-implementation | during-implementation | closeout */
    amendmentPhase: string | null;
};
/**
 * 解析 `tasks scope repair` 維護緊急通道的選項。
 * 與 `parseScopeAddOptions` 相似，但強制要求 `--emergency-approval` 和 `--reason`。
 */
export declare function parseScopeRepairOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    reason: string;
    actorId: string | null;
    emergencyApproval: string | null;
    addPaths: string[];
};
export declare function parseMetadataRepairDeliverablesOptions(argv: string[]): {
    cwd: string;
    taskId: string;
    reason: string;
    actorId: string | null;
    setPaths: string[];
};
