import type { ProjectOrientationReport, RouteDecision } from './guidance-packet.ts';
import type { LegacyRoutePlan } from './legacy-route-plan.ts';
export interface RouteEngineEvidence {
    readonly existingAtomMatches?: readonly string[];
    readonly demandPoliceFindings?: readonly string[];
    readonly legacyRoutePlan?: LegacyRoutePlan;
    readonly legacyTargetFile?: string | null;
    readonly touchedSymbols?: readonly string[];
}
export interface RouteEngineInput {
    readonly goal: string;
    readonly orientation: ProjectOrientationReport;
    readonly evidence?: RouteEngineEvidence;
}
export declare function decideGuidanceRoute(input: RouteEngineInput): RouteDecision;
