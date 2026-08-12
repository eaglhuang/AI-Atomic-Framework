import { type CommandResult } from '../shared.ts';
export declare const TASK_READ_PROJECTION_SCHEMA_ID = "atm.taskReadProjection.v1";
export declare const REGISTERED_PROJECTION_FIELDS: readonly string[];
export interface TaskReadProjectionOptions {
    readonly cwd: string;
    readonly selector: {
        readonly kind: 'tasks';
        readonly taskIds: readonly string[];
    } | {
        readonly kind: 'series';
        readonly series: string;
    } | {
        readonly kind: 'all';
    };
    readonly fields: readonly string[];
}
/** True when the argv asks for the read projection rather than the findings audit. */
export declare function hasTaskReadProjectionRequest(argv: readonly string[]): boolean;
export declare function parseTaskReadProjectionOptions(argv: readonly string[]): TaskReadProjectionOptions;
export declare function buildTaskReadProjection(options: TaskReadProjectionOptions): {
    readonly schemaId: typeof TASK_READ_PROJECTION_SCHEMA_ID;
    readonly generatedAt: string;
    readonly readOnly: true;
    readonly selector: TaskReadProjectionOptions['selector'];
    readonly fields: readonly string[];
    readonly rowCount: number;
    readonly rows: readonly Record<string, unknown>[];
};
export declare function runTasksReadProjection(argv: readonly string[]): CommandResult;
