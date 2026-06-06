import { type GuidanceSession, type ProjectOrientationReport, type RouteDecision } from './guidance-packet.ts';
import type { LegacyRoutePlan } from './legacy-route-plan.ts';
export interface CreateGuidanceSessionInput {
    readonly repositoryRoot: string;
    readonly goal: string;
    readonly orientation: ProjectOrientationReport;
    readonly routeDecision: RouteDecision;
    readonly actor?: string;
    readonly now?: string;
    readonly legacyRoutePlan?: LegacyRoutePlan;
    readonly shadowMode?: boolean;
}
export interface GuidanceAuditRecord {
    readonly who: string;
    readonly when: string;
    readonly action: string;
    readonly reason: string;
    readonly result: string;
    readonly profile: string;
    readonly sessionId?: string;
}
export declare function createGuidanceSession(input: CreateGuidanceSessionInput): GuidanceSession;
export declare function guidancePaths(repositoryRoot: string, sessionId?: string): {
    activeSessionPath: string;
    sessionsRoot: string;
    auditLogPath: string;
    proposalsRoot: string;
    sessionPath: string | null;
    proposalPath: string | null;
};
export declare function writeGuidanceSession(session: GuidanceSession): void;
export declare function readActiveGuidanceSession(repositoryRoot: string): GuidanceSession | null;
export declare function readGuidanceSession(repositoryRoot: string, sessionId: string): GuidanceSession | null;
export declare function writeGuidanceAudit(repositoryRoot: string, record: GuidanceAuditRecord): void;
