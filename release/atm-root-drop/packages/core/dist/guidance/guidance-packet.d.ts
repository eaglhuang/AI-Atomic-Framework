import type { LegacyRoutePlan } from './legacy-route-plan.ts';
export type GuidanceRoute = 'create-atom' | 'legacy-candidate-ranking' | 'task-plan-import' | 'atomize' | 'infect' | 'split' | 'evolve' | 'adapter-bootstrap' | 'legacy-fix' | 'docs-first';
export type GuidanceConfidence = number;
export interface HostGate {
    readonly gateId: string;
    readonly description: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly blocking: boolean;
}
export interface NoTouchZone {
    readonly path: string;
    readonly reason: string;
    readonly scope: 'file' | 'directory' | 'glob' | 'unknown';
}
export interface MutationPolicy {
    readonly requireSession: boolean;
    readonly requireDryRunProposal: boolean;
    readonly requireReviewBeforeApply: boolean;
    readonly allowUnguidedInDev: boolean;
    readonly allowUnguidedInCI: boolean;
}
export interface ProjectOrientationReport {
    readonly schemaId: 'atm.projectOrientationReport';
    readonly specVersion: '0.1.0';
    readonly repositoryRoot: string;
    readonly detectedLanguages: readonly string[];
    readonly packageManager: string | null;
    readonly testEntrypoints: readonly string[];
    readonly governanceFiles: readonly string[];
    readonly adapterStatus: {
        readonly status: 'missing' | 'available' | 'unknown';
        readonly reason: string;
    };
    readonly availableAdapters: readonly string[];
    readonly registryState: StateSummary;
    readonly mapState: StateSummary;
    readonly atomState: StateSummary;
    readonly legacyUriSupport: {
        readonly supported: boolean;
        readonly scheme: 'legacy';
        readonly resolver: string | null;
    };
    readonly hostGates: readonly HostGate[];
    readonly noTouchZones: readonly NoTouchZone[];
    readonly mutationPolicy: MutationPolicy;
    readonly legacyHotspots: readonly LegacyHotspot[];
    readonly configLegacyHotspots: readonly LegacyHotspotConfig[];
    readonly releaseBlockers: readonly string[];
    readonly releaseAdvisories?: readonly string[];
    readonly defaultLegacyFlow?: 'shadow' | 'dry-run';
    readonly unknowns: readonly string[];
}
export interface StateSummary {
    readonly status: 'missing' | 'present' | 'partial' | 'unknown';
    readonly paths: readonly string[];
    readonly count?: number;
}
export interface LegacyHotspot {
    readonly path: string;
    readonly reason: string;
    readonly riskLevel: 'low' | 'medium' | 'high';
}
export interface LegacyHotspotConfig {
    readonly path: string;
    readonly releaseBlockers: readonly string[];
    readonly demandReportPath?: string | null;
    readonly existingAtomIndexPath?: string | null;
}
export interface RouteChoice {
    readonly route: GuidanceRoute;
    readonly reason: string;
    readonly goalAlignment?: {
        readonly symbolName: string;
        readonly matchedTerms: readonly string[];
        readonly score: number;
    };
    readonly overrideReason?: string;
}
export interface RouteDecision {
    readonly schemaId: 'atm.guidanceRouteDecision';
    readonly specVersion: '0.1.0';
    readonly recommendedRoute: GuidanceRoute;
    readonly confidence: GuidanceConfidence;
    readonly reasons: readonly string[];
    readonly routeChoices: readonly RouteChoice[];
    readonly requiredEvidence: readonly string[];
    readonly blockedBy: readonly string[];
    readonly nextCommand: string;
}
export interface GuidanceNextAction {
    readonly status: 'ready' | 'action' | 'blocked';
    readonly command: string;
    readonly reason: string;
    readonly allowedCommands: readonly string[];
    readonly blockedCommands: readonly string[];
    readonly missingEvidence: readonly string[];
    readonly proposalId?: string;
    readonly proposalStatus?: string;
    readonly nextRouteState?: 'proposal-required' | 'proposal-pending-review' | 'proposal-approved' | 'proposal-rejected' | 'proposal-rollout-ready';
    readonly selectedSegment?: string;
    readonly blockedSegments?: readonly string[];
    readonly legacyTarget?: string;
    readonly targetFile?: string;
    readonly selectedBehavior?: string;
}
export interface GuidancePacket {
    readonly schemaId: 'atm.guidancePacket';
    readonly specVersion: '0.1.0';
    readonly sessionId: string;
    readonly readFirst: readonly string[];
    readonly doNotTouch: readonly string[];
    readonly nextCommand: string;
    readonly allowedCommands: readonly string[];
    readonly blockedCommands: readonly string[];
    readonly requiredGates: readonly string[];
    readonly missingEvidence: readonly string[];
    readonly rollbackHint: string;
    readonly whyThisRoute: readonly string[];
}
export interface GuidanceSession {
    readonly schemaId: 'atm.guidanceSession';
    readonly specVersion: '0.1.0';
    readonly sessionId: string;
    readonly repositoryRoot: string;
    readonly goal: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly actor: string;
    readonly orientation: ProjectOrientationReport;
    readonly routeDecision: RouteDecision;
    readonly packet: GuidancePacket;
    readonly legacyRoutePlan?: LegacyRoutePlan;
    readonly shadowMode?: boolean;
}
export declare const defaultMutationPolicy: MutationPolicy;
export declare function buildGuidancePacket(input: {
    readonly sessionId: string;
    readonly orientation: ProjectOrientationReport;
    readonly routeDecision: RouteDecision;
}): GuidancePacket;
export declare function toGuidanceNextAction(packet: GuidancePacket, blockedBy?: readonly string[]): GuidanceNextAction;
