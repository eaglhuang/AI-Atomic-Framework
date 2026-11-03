import type { ActiveWriteIntent, WriteIntent } from './types.js';
export type ResourceOverlapVerdict = 'overlap' | 'disjoint' | 'unknown';
export type ResourceKeyOverlapVerdict = 'overlap' | 'clear' | 'unknown';
export interface ResourceKeyOverlapFact {
    readonly resourceKind: string;
    readonly leftKey: string;
    readonly rightKey: string;
    readonly normalizedLeftKey: string;
    readonly normalizedRightKey: string;
    readonly verdict: ResourceKeyOverlapVerdict;
    readonly reason: string;
    readonly matcherVersion: 'resource-key-matcher@0.2.0';
}
export interface ResourceOverlap {
    readonly schemaId: 'atm.resourceOverlap.v1';
    readonly specVersion: '0.1.0';
    readonly resourceKind: string;
    readonly leftTaskId: string;
    readonly leftActorId: string;
    readonly leftLaneSessionId: string | null;
    readonly leftIntentId: string | null;
    readonly rightTaskId: string;
    readonly rightActorId: string;
    readonly rightLaneSessionId: string | null;
    readonly rightIntentId: string | null;
    readonly leftKey: string;
    readonly rightKey: string;
    readonly normalizedLeftKey: string;
    readonly normalizedRightKey: string;
    readonly verdict: ResourceOverlapVerdict;
    readonly matcherVersion: 'resource-overlap@0.1.0';
    readonly resolverVersion: 'resource-key-matcher@0.2.0';
    readonly provenance: readonly string[];
    readonly confidence: 'high' | 'medium' | 'low';
    readonly anchors: readonly ResourceOverlapAnchor[];
    readonly intersection: ResourceOverlapIntersection;
    readonly inputDigest: string;
    readonly shadow?: ResourceOverlapShadowReport;
}
export interface ResourceOverlapAnchor {
    readonly taskId: string;
    readonly atomId?: string;
    readonly atomCid?: string;
    readonly filePath?: string;
    readonly lineStart?: number;
    readonly lineEnd?: number;
    readonly contentAnchorIds: readonly string[];
}
export interface ResourceOverlapIntersection {
    readonly kind: 'key' | 'line-range' | 'pattern' | 'unknown';
    readonly detail: string;
}
export interface ResourceOverlapShadowReport {
    readonly legacyPredicate: boolean;
    readonly structuredVerdict: ResourceOverlapVerdict;
    readonly parity: 'match' | 'mismatch';
    readonly reason: string;
}
export interface ResourceOverlapReport {
    readonly schemaId: 'atm.resourceOverlapReport.v1';
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly actorId: string;
    readonly baseCommit: string;
    readonly facts: readonly ResourceOverlap[];
    readonly summary: {
        readonly overlap: number;
        readonly disjoint: number;
        readonly unknown: number;
        readonly shadowMismatches: number;
    };
    readonly inputDigest: string;
}
export declare function compareResourceKeys(resourceKind: string, leftKey: string, rightKey: string): ResourceKeyOverlapFact;
export declare function collectResourceKeyOverlapFacts(resourceKind: string, left: readonly string[], right: readonly string[]): readonly ResourceKeyOverlapFact[];
export declare function resourceListsOverlap(resourceKind: string, left: readonly string[], right: readonly string[]): boolean;
export interface ResourceOverlapMatch {
    readonly resourceKind: string;
    readonly leftKey: string;
    readonly rightKey: string;
    readonly verdict: 'overlap' | 'unknown';
    readonly reason: string;
}
export declare function findResourceOverlapMatches(resourceKind: string, left: readonly string[], right: readonly string[]): readonly ResourceOverlapMatch[];
export declare function buildResourceOverlapReport(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[]): ResourceOverlapReport;
export declare function buildResourceOverlaps(newIntent: WriteIntent, active: ActiveWriteIntent): readonly ResourceOverlap[];
