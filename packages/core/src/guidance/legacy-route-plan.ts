export type LegacySegmentRole = 'trunk' | 'leaf' | 'adapter-boundary';
export type LegacySegmentRiskLevel = 'low' | 'medium' | 'high';

export interface LegacyRoutePlanSegment {
  readonly symbolName: string;
  readonly role: LegacySegmentRole;
  readonly riskLevel: LegacySegmentRiskLevel;
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

export function isLegacyRoutePlan(value: unknown): value is LegacyRoutePlan {
  const candidate = value as Partial<LegacyRoutePlan> | null;
  return Boolean(
    candidate
    && candidate.schemaId === 'atm.legacyRoutePlan'
    && typeof candidate.targetFile === 'string'
    && Array.isArray(candidate.segments)
  );
}

export function hasTrunkSegments(plan: LegacyRoutePlan): boolean {
  return plan.segments.some((segment) => segment.role === 'trunk');
}
