import { type TaskClaimDependencyBlocker } from './tasks/public-surface.ts';
import { type TaskIntentSource, type RequestedTaskAction, type TaskIntent } from './next/intent-normalizers.ts';
import { type ImportedTaskSummary, type PromptScopedRouteStatus, type PromptScopedTaskRoute } from './next/route-predicates.ts';
export declare function runNext(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export type NextClaimIntent = 'write' | 'closeout-only';
export interface ClaimReadinessTaskSummary {
    readonly workItemId: string;
    readonly status: string;
    readonly format: 'json' | 'markdown';
    readonly sourcePlanPath: string | null;
}
export interface ClaimReadinessDiagnostic {
    readonly taskId: string;
    readonly status: string;
    readonly format: 'json' | 'markdown';
    readonly claimable: boolean;
    readonly blockerCode: string;
    readonly blockerSummary: string;
    readonly requiredCommand: string | null;
    readonly dependencyBlockers: readonly TaskClaimDependencyBlocker[];
}
export interface ClaimReadinessReport {
    readonly schemaId: 'atm.claimReadinessReport.v1';
    readonly diagnostics: readonly ClaimReadinessDiagnostic[];
    readonly primaryBlocker: ClaimReadinessDiagnostic | null;
}
export declare function diagnoseClaimReadinessForTasks(cwd: string, tasks: readonly ClaimReadinessTaskSummary[], claimIntent: NextClaimIntent): ClaimReadinessReport;
export interface PromptScopedTaskContext {
    readonly taskIntent: {
        readonly userPrompt: string | null;
        readonly explicitTaskIds: readonly string[];
        readonly taskScopeMentioned: boolean;
        readonly requestedAction: RequestedTaskAction | null;
        readonly source: TaskIntentSource;
    } | null;
    readonly promptScope: {
        readonly status: PromptScopedRouteStatus;
        readonly selectedTasks: readonly ImportedTaskSummary[];
        readonly targetRepo: string | null;
        readonly diagnostics: readonly string[];
    } | null;
}
export declare function shouldSkipExternalTaskCardScan(cwd: string, jsonTasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): boolean;
export declare function shouldSkipMarkdownTaskDiscovery(cwd: string, jsonTasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): boolean;
export declare function resolvePromptScopedTaskContext(cwd: string, input: {
    readonly prompt?: string | null;
    readonly intentPath?: string | null;
}): PromptScopedTaskContext;
/**
 * Handoff documents are workspace-level artifacts rather than task cards, so
 * their filename cannot score against a ledger task path. When a handoff is
 * explicitly named, use the handoff's task references only as a constrained
 * hint: a referenced active claim is safe, a stale reference is not, and an
 * unqualified handoff may fall back only when exactly one active claim exists.
 */
export declare function resolveHandoffResumeTaskRoute(cwd: string, tasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): PromptScopedTaskRoute | null;
export interface ActiveWorkSummary {
    readonly schemaId: 'atm.activeWorkSummary.v1';
    readonly generatedAt: string;
    readonly activeClaimCount: number;
    readonly activeActors: readonly {
        readonly actorId: string;
        readonly taskIds: readonly string[];
        readonly fileCount: number;
    }[];
    readonly activeClaims: readonly {
        readonly taskId: string;
        readonly title: string;
        readonly actorId: string;
        readonly intent: string;
        readonly claimedAt: string | null;
        readonly heartbeatAt: string | null;
        readonly heartbeatAgeSeconds: number | null;
        readonly ttlSeconds: number | null;
        readonly leaseFresh: boolean | null;
        readonly files: readonly string[];
    }[];
    readonly activeLocks: readonly {
        readonly workItemId: string;
        readonly actorId: string;
        readonly heartbeatAt: string | null;
        readonly heartbeatAgeSeconds: number | null;
        readonly ttlSeconds: number | null;
        readonly leaseFresh: boolean | null;
        readonly files: readonly string[];
    }[];
    readonly freshReservationCount: number;
    readonly freshReservations: readonly {
        readonly taskId: string;
        readonly title: string;
        readonly actorId: string;
        readonly createdAt: string | null;
        readonly importedAt: string | null;
        readonly ageSeconds: number;
        readonly ttlSeconds: number;
        readonly leaseFresh: boolean;
        readonly files: readonly string[];
    }[];
    readonly stagedFiles: readonly string[];
    readonly hasForeignActiveWork: boolean;
    readonly teamLevelRecommendation: {
        readonly level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
        readonly reason: string;
        readonly ownFiles: readonly string[];
        readonly overlappingFiles: readonly string[];
        readonly foreignActors: readonly string[];
    };
    readonly brokerRecommendation: {
        readonly enabled: boolean;
        readonly reason: string | null;
        readonly statusCommand: string;
        readonly brokerStatusCommand: string;
        readonly teamStatusCommand: string;
    };
}
export declare function buildActiveWorkSummary(cwd: string, currentActorId?: string | null, ownFiles?: readonly string[]): ActiveWorkSummary;
