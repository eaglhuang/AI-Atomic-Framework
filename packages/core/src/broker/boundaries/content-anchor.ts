import { createHash } from 'node:crypto';
import type { MigrationRecord } from '../types.ts';

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

export const CONTENT_ANCHOR_MIGRATION: MigrationRecord = Object.freeze({
  strategy: 'none',
  fromVersion: null,
  notes: 'content anchor substrate baseline'
});

export function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function createContentAnchor(input: {
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
}): ContentAnchor {
  const lines = input.sourceText.split(/\r?\n/);
  const location = normalizeLocation(input.filePath, input.lineStart, input.lineEnd, lines.length);
  const preimage = location
    ? lines.slice(location.lineStart - 1, location.lineEnd).join('\n')
    : input.sourceText;
  const contextRadius = input.contextRadius ?? 2;
  const contextBefore = location
    ? lines.slice(Math.max(0, location.lineStart - 1 - contextRadius), location.lineStart - 1)
    : [];
  const contextAfter = location
    ? lines.slice(location.lineEnd, Math.min(lines.length, location.lineEnd + contextRadius))
    : [];
  const identity = [
    input.baseDigest,
    input.filePath.replace(/\\/g, '/'),
    input.kind,
    input.symbolName ?? '',
    input.astPath?.join('/') ?? '',
    sha256Text(preimage)
  ].join('\0');

  return {
    schemaId: 'atm.contentAnchor.v1',
    specVersion: '0.1.0',
    migration: CONTENT_ANCHOR_MIGRATION,
    anchorId: `content-anchor-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
    baseDigest: input.baseDigest,
    filePath: input.filePath.replace(/\\/g, '/'),
    fileDigest: sha256Text(input.sourceText),
    kind: input.kind,
    ...(input.symbolName ? { symbolName: input.symbolName } : {}),
    ...(input.astPath ? { astPath: input.astPath } : {}),
    contextBefore,
    contextAfter,
    preimageDigest: sha256Text(preimage),
    ...(location ? { location } : {}),
    provenance: input.provenance,
    confidence: input.confidence
  };
}

function normalizeLocation(
  filePath: string,
  lineStart: number | undefined,
  lineEnd: number | undefined,
  lineCount: number
): ContentAnchorLocation | undefined {
  if (lineStart === undefined && lineEnd === undefined) {
    return undefined;
  }
  const start = lineStart ?? lineEnd;
  const end = lineEnd ?? lineStart;
  if (!Number.isInteger(start) || !Number.isInteger(end) || !start || !end || start < 1 || end < start || end > lineCount) {
    throw new Error(`Invalid content anchor line window for ${filePath}: ${lineStart ?? '?'}-${lineEnd ?? '?'}`);
  }
  return { filePath: filePath.replace(/\\/g, '/'), lineStart: start, lineEnd: end };
}
