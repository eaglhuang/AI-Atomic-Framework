import type { ClaimDirtyWipAdmission } from './foreign-dirty-wip-admission.ts';
import type { ImportedTaskSummary } from './route-predicates.ts';
import type { TaskIntent } from './intent-normalizers.ts';
export interface PlanScopedRoutingPreflight {
    readonly schemaId: 'atm.planScopedRoutingPreflight.v1';
    readonly taskId: string;
    readonly generatedAt: string;
    readonly plan: {
        readonly sourcePlanPath: string | null;
        readonly resolvedPath: string | null;
        readonly digest: string | null;
        readonly state: 'resolved' | 'missing' | 'unknown';
    };
    readonly routing: {
        readonly selectedTaskIds: readonly string[];
        readonly doneOrAbandonedSkipped: boolean;
        readonly recoveryCommand: string;
    };
    readonly identity: {
        readonly actorId: string;
        readonly laneSessionId: string | null;
        readonly readOnlyLanePresence: boolean;
    };
    readonly wip: {
        readonly classes: readonly PlanScopedWipClass[];
        readonly intersectingFiles: readonly string[];
        readonly recoveryCommand: string | null;
    };
    readonly telemetry: {
        readonly checkId: 'next.route-resolution';
        readonly result: 'pass' | 'block' | 'warn';
        readonly eventWritten: boolean;
        readonly warning: string | null;
    };
}
export type PlanScopedWipClass = 'clean' | 'own-lane' | 'foreign-active' | 'unowned' | 'stale-generated-receipt' | 'unrelated-dirty' | 'observability-missing';
export declare function buildPlanScopedRoutingPreflight(input: {
    readonly cwd: string;
    readonly task: ImportedTaskSummary;
    readonly selectedTasks: readonly ImportedTaskSummary[];
    readonly taskIntent: TaskIntent | null;
    readonly actorId: string;
    readonly laneSessionId: string | null;
    readonly dirtyWipAdmission: ClaimDirtyWipAdmission;
    readonly command: string;
}): PlanScopedRoutingPreflight;
