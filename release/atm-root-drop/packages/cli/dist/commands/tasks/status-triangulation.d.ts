/**
 * TASK-RFT-0010 — tasks.status.triangulation atom.
 *
 * Strategy Map for `tasks status` / `tasks reconcile` truth triangulation.
 *
 * Compares three lifecycle sources of truth:
 *   - live ledger (task store JSON)
 *   - planning frontmatter (planning .task.md)
 *   - last transition event (event ledger JSONL)
 *
 * Owns the parity-override strategy for "planning mirror is stale but the
 * live claim still defines a unique lane" (which prevents pushing the
 * operator back through `tasks import` for an advisory drift), and emits a
 * recommendation pointing the operator at the right recovery route.
 *
 * Logic is moved verbatim from the previous inline implementation in
 * `packages/cli/src/commands/tasks.ts`. Public JSON shape of
 * `TaskStatusTriangulation` is preserved.
 */
import { type TaskResidueClassification, type TaskResidueDivergence, type TaskResidueLedgerSnapshot, type TaskResiduePlanningSnapshot, type TaskResidueTransitionSnapshot, type TaskScopeAmendmentSnapshot, type TaskStatusTriangulation } from './residue-diagnostics.ts';
export declare function resolvePlanningCardPath(cwd: string, taskDocument: Record<string, unknown>): string | null;
export declare function readLastTransitionEventRecord(cwd: string, taskId: string, transitionId: string | null): Record<string, unknown> | null;
/**
 * 讀取指定任務的所有 scope-amendment 事件，依時間順序排列。
 * 供 `buildTaskStatusTriangulation` 與 closeback 輸出使用，讓 reviewer 能區分
 * 正常 linked-surface 成長與可疑 scope drift。
 */
export declare function readScopeAmendmentEvents(cwd: string, taskId: string): TaskScopeAmendmentSnapshot[];
export declare function normalizeParityLifecycleValue(value: string | null): string | null;
export declare function isOpenPlanningParityStatus(status: string | null): boolean;
export declare function hasOnlyStatusDivergence(divergence: readonly TaskResidueDivergence[]): boolean;
export interface PlanningMirrorParityOverrideInput {
    taskId: string;
    liveLedger: TaskResidueLedgerSnapshot;
    planningFrontmatter: TaskResiduePlanningSnapshot;
    lastTransitionEvent: TaskResidueTransitionSnapshot | null;
    divergence: readonly TaskResidueDivergence[];
}
export interface PlanningMirrorParityOverride {
    residueClassification: TaskResidueClassification;
    recommendation: string | null;
}
export declare function buildPlanningMirrorParityOverride(input: PlanningMirrorParityOverrideInput): PlanningMirrorParityOverride | null;
/**
 * Triangulate live ledger / planning frontmatter / last transition event into a
 * single `TaskStatusTriangulation` envelope. The shape of the returned object
 * is part of the public `tasks status` JSON contract and must remain stable.
 */
export declare function buildTaskStatusTriangulation(cwd: string, taskId: string, taskDocument: Record<string, unknown>): TaskStatusTriangulation;
