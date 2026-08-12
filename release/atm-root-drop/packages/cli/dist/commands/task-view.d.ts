import { type TaskCloseCompletionChecklist } from './taskflow/close-orchestration.ts';
export declare const TASK_VIEW_DASHBOARD_SCHEMA_ID = "atm.taskViewDashboard.v1";
export interface TaskViewEvidenceBlocker {
    readonly validator: string;
    readonly category: string;
    readonly summary: string;
    readonly requiredCommand: string | null;
}
export interface TaskViewDashboard {
    readonly schemaId: typeof TASK_VIEW_DASHBOARD_SCHEMA_ID;
    readonly taskId: string;
    readonly generatedAt: string;
    readonly readOnly: true;
    readonly operatorSummary: string;
    readonly statusSummary: string;
    readonly liveStatus: string | null;
    readonly planningStatus: string | null;
    readonly claimState: string | null;
    readonly residueBucket: string;
    readonly lastEvent: {
        readonly action: string | null;
        readonly actorId: string | null;
        readonly createdAt: string | null;
    };
    readonly evidenceBlockers: readonly TaskViewEvidenceBlocker[];
    readonly closeCompletionChecklist: TaskCloseCompletionChecklist;
    readonly partialClose: boolean;
    readonly nextSafeCommand: string;
}
export declare function buildTaskViewDashboard(input: {
    cwd: string;
    taskId: string;
    actorId: string | null;
}): TaskViewDashboard;
export declare function runTaskView(argv: string[]): import("./shared.ts").CommandResult;
