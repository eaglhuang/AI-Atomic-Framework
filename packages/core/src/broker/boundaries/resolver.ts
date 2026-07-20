import {
  type ContentAnchor,
  type ContentAnchorLocation,
  type ContentAnchorResolution,
  sha256Text
} from './content-anchor.ts';

export const CONTENT_ANCHOR_RESOLVER_VERSION = 'content-anchor-resolver@0.1.0';

export interface ContentAnchorResolverAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  supports(filePath: string, sourceText: string): boolean;
  findSymbol?(sourceText: string, symbolName: string): readonly ContentAnchorLocation[];
}

export function resolveContentAnchor(input: {
  readonly anchor: ContentAnchor;
  readonly currentFilePath: string;
  readonly currentSourceText: string;
  readonly adapter?: ContentAnchorResolverAdapter;
}): ContentAnchorResolution {
  const filePath = input.currentFilePath.replace(/\\/g, '/');
  const currentFileDigest = sha256Text(input.currentSourceText);
  if (filePath !== input.anchor.filePath) {
    return resolution(input.anchor, 'stale', filePath, [], 'anchor file path changed; rename must be re-anchored', currentFileDigest);
  }
  if (input.adapter && !input.adapter.supports(filePath, input.currentSourceText)) {
    return resolution(input.anchor, 'unsupported', filePath, [], 'adapter does not support this file surface', currentFileDigest);
  }

  const candidates = findCandidates(input.anchor, input.currentSourceText, input.adapter);
  if (candidates.length === 1) {
    return resolution(input.anchor, 'resolved', filePath, candidates, 'exactly one content anchor candidate resolved', currentFileDigest);
  }
  if (candidates.length > 1) {
    return resolution(input.anchor, 'ambiguous', filePath, candidates, 'multiple content anchor candidates matched', currentFileDigest);
  }
  return resolution(input.anchor, 'stale', filePath, [], 'no current content matched the anchor preimage or symbol', currentFileDigest);
}

function findCandidates(
  anchor: ContentAnchor,
  sourceText: string,
  adapter?: ContentAnchorResolverAdapter
): readonly ContentAnchorLocation[] {
  if ((anchor.kind === 'symbol' || anchor.kind === 'ast-node') && anchor.symbolName && adapter?.findSymbol) {
    const symbolMatches = adapter.findSymbol(sourceText, anchor.symbolName);
    const exactSymbolMatches = filterByPreimage(anchor, sourceText, symbolMatches);
    return exactSymbolMatches.length > 0 ? exactSymbolMatches : symbolMatches;
  }
  return findTextMatches(anchor, sourceText);
}

function findTextMatches(anchor: ContentAnchor, sourceText: string): readonly ContentAnchorLocation[] {
  const lines = sourceText.split(/\r?\n/);
  const expectedLength = anchor.location ? anchor.location.lineEnd - anchor.location.lineStart + 1 : 1;
  const candidates: ContentAnchorLocation[] = [];
  for (let start = 0; start <= lines.length - expectedLength; start += 1) {
    const segment = lines.slice(start, start + expectedLength).join('\n');
    if (sha256Text(segment) === anchor.preimageDigest && contextMatches(anchor, lines, start, expectedLength)) {
      candidates.push({ filePath: anchor.filePath, lineStart: start + 1, lineEnd: start + expectedLength });
    }
  }
  return candidates;
}

function filterByPreimage(
  anchor: ContentAnchor,
  sourceText: string,
  candidates: readonly ContentAnchorLocation[]
): readonly ContentAnchorLocation[] {
  const lines = sourceText.split(/\r?\n/);
  return candidates.filter((candidate) => {
    const segment = lines.slice(candidate.lineStart - 1, candidate.lineEnd).join('\n');
    return sha256Text(segment) === anchor.preimageDigest;
  });
}

function contextMatches(anchor: ContentAnchor, lines: readonly string[], start: number, length: number): boolean {
  const before = anchor.contextBefore ?? [];
  const after = anchor.contextAfter ?? [];
  if (before.length > 0) {
    const actualBefore = lines.slice(Math.max(0, start - before.length), start);
    if (actualBefore.join('\n') !== before.slice(-actualBefore.length).join('\n')) return false;
  }
  if (after.length > 0) {
    const actualAfter = lines.slice(start + length, start + length + after.length);
    if (actualAfter.join('\n') !== after.slice(0, actualAfter.length).join('\n')) return false;
  }
  return true;
}

function resolution(
  anchor: ContentAnchor,
  status: ContentAnchorResolution['status'],
  filePath: string,
  candidates: readonly ContentAnchorLocation[],
  reason: string,
  currentFileDigest: string
): ContentAnchorResolution {
  return {
    schemaId: 'atm.contentAnchorResolution.v1',
    specVersion: '0.1.0',
    anchorId: anchor.anchorId,
    status,
    filePath,
    ...(status === 'resolved' && candidates[0] ? { resolvedLocation: candidates[0] } : {}),
    candidateCount: candidates.length,
    reason,
    currentFileDigest,
    resolverVersion: CONTENT_ANCHOR_RESOLVER_VERSION
  };
}
