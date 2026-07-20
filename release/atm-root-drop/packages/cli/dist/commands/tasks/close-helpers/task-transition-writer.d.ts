import { type TaskTransitionClosureMetadata } from '../../task-ledger.ts';
export { buildTaskTransitionCommand, createClosureTransitionMetadata } from '../task-transition-helpers.ts';
export declare function writeTaskDocumentWithTransition(input: {
    readonly cwd: string;
    readonly taskPath: string;
    readonly taskId: string;
    readonly taskDocument: Record<string, unknown>;
    readonly action: string;
    readonly actorId: string | null;
    readonly sessionId?: string | null;
    readonly previousStatus: string | null;
    readonly closureMetadata?: TaskTransitionClosureMetadata | null;
    readonly command?: string;
}): string;
