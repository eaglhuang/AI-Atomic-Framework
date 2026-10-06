import { createHash } from 'node:crypto';
import type { BridgeAtomCandidate } from './candidate-bridge.ts';

/**
 * Derived atom identity helpers (TASK-ASP-0006).
 *
 * A derived atom is computed from source code on demand; it is never stored
 * as a second registry. These helpers make the candidate list identity-stable
 * before `computeCandidateAtomCid` hashes it:
 *
 * - consecutive same-kind, same-symbol candidates in one file (TypeScript
 *   overload signatures followed by the implementation) merge into one atom;
 * - remaining same-kind, same-symbol duplicates get an `ordinal` in source
 *   order. Atoms without duplicates carry no ordinal, so their CID does not
 *   move when unrelated code is added. Inserting a new same-name atom before
 *   an existing one shifts that atom's ordinal (documented limitation).
 */
export function normalizeDerivedCandidates<T extends BridgeAtomCandidate>(candidates: readonly T[]): T[] {
  const byFile = new Map<string, T[]>();
  for (const candidate of candidates) {
    const key = candidate.filePath.replace(/\\/g, '/');
    byFile.set(key, [...(byFile.get(key) ?? []), candidate]);
  }
  const normalized: T[] = [];
  for (const fileCandidates of byFile.values()) {
    const ordered = [...fileCandidates].sort((left, right) => (left.lineStart ?? 0) - (right.lineStart ?? 0));
    const merged: T[] = [];
    for (const candidate of ordered) {
      const previous = merged[merged.length - 1];
      if (previous && previous.kind === candidate.kind && previous.symbol === candidate.symbol) {
        merged[merged.length - 1] = {
          ...previous,
          lineEnd: maxLine(previous.lineEnd, candidate.lineEnd)
        };
        continue;
      }
      merged.push(candidate);
    }
    const totals = new Map<string, number>();
    for (const candidate of merged) {
      const key = `${candidate.kind}\u0000${candidate.symbol}`;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    for (const candidate of merged) {
      const key = `${candidate.kind}\u0000${candidate.symbol}`;
      if ((totals.get(key) ?? 0) < 2) {
        const { ordinal: _ordinal, ...rest } = candidate;
        normalized.push(rest as T);
        continue;
      }
      const ordinal = seen.get(key) ?? 0;
      seen.set(key, ordinal + 1);
      normalized.push({ ...candidate, ordinal });
    }
  }
  return normalized;
}

/**
 * Content version of a line range: SHA-256 over the range text with line
 * endings normalized to LF, so CRLF and LF checkouts agree. Changes here do
 * not change the atom CID.
 */
export function computeAtomContentVersion(sourceText: string, lineStart: number, lineEnd: number): string {
  const lines = sourceText.replace(/\r\n?/g, '\n').split('\n');
  const body = lines.slice(Math.max(0, lineStart - 1), Math.max(lineStart, lineEnd)).join('\n');
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

function maxLine(left: number | null, right: number | null): number | null {
  if (left == null) return right;
  if (right == null) return left;
  return Math.max(left, right);
}
