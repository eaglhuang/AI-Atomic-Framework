import type { MigrationRecord } from '../types.js';
export type ContentAnchorKind = 'symbol' | 'ast-node' | 'text-context' | 'file';
export type ContentAnchorResolutionStatus = 'resolved' | 'stale' | 'ambiguous' | 'unsupported';
export interface ContentAnchorLocation {
    readonly filePath: string;
    readonly lineStart: number;
    readonly lineEnd: number;
}
export interface ContentAnchorProvenance {
    readonly adapterId: string;
    readonly adapterVersion: string;
    readonly createdAt: string;
}
export interface ContentAnchor {
    readonly schemaId: 'atm.contentAnchor.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly anchorId: string;
    readonly baseDigest: string;
    readonly filePath: string;
    readonly fileDigest: string;
    readonly kind: ContentAnchorKind;
    readonly symbolName?: string;
    readonly astPath?: readonly string[];
    readonly contextBefore?: readonly string[];
    readonly contextAfter?: readonly string[];
    readonly preimageDigest: string;
    readonly location?: ContentAnchorLocation;
    readonly provenance: ContentAnchorProvenance;
    readonly confidence: 'high' | 'medium' | 'low';
}
export interface ContentAnchorResolution {
    readonly schemaId: 'atm.contentAnchorResolution.v1';
    readonly specVersion: '0.1.0';
    readonly anchorId: string;
    readonly status: ContentAnchorResolutionStatus;
    readonly filePath: string;
    readonly resolvedLocation?: ContentAnchorLocation;
    readonly candidateCount: number;
    readonly reason: string;
    readonly currentFileDigest?: string;
    readonly resolverVersion: string;
}
export declare const CONTENT_ANCHOR_MIGRATION: MigrationRecord;
export declare function sha256Text(value: string): string;
export declare function createContentAnchor(input: {
    readonly baseDigest: string;
    readonly filePath: string;
    readonly sourceText: string;
    readonly kind: ContentAnchorKind;
    readonly symbolName?: string;
    readonly astPath?: readonly string[];
    readonly lineStart?: number;
    readonly lineEnd?: number;
    readonly contextRadius?: number;
    readonly provenance: ContentAnchorProvenance;
    readonly confidence: ContentAnchor['confidence'];
}): ContentAnchor;
