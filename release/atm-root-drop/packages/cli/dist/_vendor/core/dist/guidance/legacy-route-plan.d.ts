export type LegacySegmentRole = 'trunk' | 'leaf' | 'adapter-boundary';
export type LegacySegmentRiskLevel = 'low' | 'medium' | 'high';
export interface LegacyRoutePlanSegment {
    readonly symbolName: string;
    readonly role: LegacySegmentRole;
    readonly riskLevel: LegacySegmentRiskLevel;
    readonly fanOut: number;
    readonly callerDemand: number;
    readonly existingAtomMatch: string | null;
    readonly recommendedBehavior: 'atomize' | 'infect' | 'split' | 'leave-in-place';
}
export interface LegacyRoutePlan {
    readonly schemaId: 'atm.legacyRoutePlan';
    readonly specVersion: '0.1.0';
    readonly targetFile: string;
    readonly segments: readonly LegacyRoutePlanSegment[];
    readonly trunkFunctions: readonly string[];
    readonly leafFunctions: readonly string[];
    readonly adapterBoundaries: readonly string[];
    readonly existingAtomMatches: readonly string[];
    readonly releaseBlockers: readonly string[];
    readonly safeFirstAtoms: readonly string[];
    readonly noTouchZones: readonly string[];
    readonly requiredDryRunProposal: boolean;
}
export declare function isLegacyRoutePlan(value: unknown): value is LegacyRoutePlan;
export declare function hasTrunkSegments(plan: LegacyRoutePlan): boolean;
export interface ExistingAtomMatchInput {
    readonly symbolName: string;
    readonly atomId: string;
    readonly fingerprint?: string;
}
export interface CallerDistributionInput {
    readonly symbolName: string;
    readonly callerCount: number;
}
export interface BuildLegacyRoutePlanInput {
    readonly sourceText: string;
    readonly targetFile: string;
    readonly releaseBlockerSymbols?: readonly string[];
    readonly existingAtomMatches?: readonly ExistingAtomMatchInput[];
    readonly callerDistribution?: Readonly<Record<string, number>> | readonly CallerDistributionInput[];
    readonly noTouchZones?: readonly string[];
    readonly demandThreshold?: number;
    readonly fanOutThreshold?: number;
}
export declare function buildLegacyRoutePlan(input: BuildLegacyRoutePlanInput): Promise<LegacyRoutePlan>;
