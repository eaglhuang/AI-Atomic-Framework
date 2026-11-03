import { applyUnifiedPatch, UnifiedPatchApplicationError } from './unified-patch.ts';
import type { BaseCompositionResult } from './steward-base-composer.ts';
import type { PatchProposal } from './types.ts';

interface ByteEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/**
 * JSON anchors permit overlapping patch context only for prefix-disjoint paths.
 * Render original patch bytes, never JSON.stringify: a conservative single-span
 * splice per proposal preserves whitespace, line endings, key order and EOF.
 * Any uncertainty returns control to the strict immutable-base text composer.
 */
export function composeJsonPointerPatches(before: string, proposals: readonly PatchProposal[]): BaseCompositionResult | null {
  const pointers = proposals.map((proposal) => declaredPointer(proposal));
  if (pointers.some((pointer) => pointer === null)) return null;
  const tokens = pointers as string[][];
  for (let left = 0; left < tokens.length; left += 1) {
    for (let right = left + 1; right < tokens.length; right += 1) {
      const a = tokens[left]!;
      const b = tokens[right]!;
      // Compare decoded segments, not string prefixes (/a and /ab are siblings).
      if (a.slice(0, Math.min(a.length, b.length)).every((token, index) => token === b[index])) return null;
    }
  }

  let base: unknown;
  try { base = JSON.parse(before); } catch { return null; }
  if (!isObject(base)) return null;
  const edits: ByteEdit[] = [];
  const patchedDocuments: unknown[] = [];
  for (const [index, proposal] of proposals.entries()) {
    let after: string;
    let patched: unknown;
    try {
      after = applyUnifiedPatch(before, proposal.patch);
      patched = JSON.parse(after);
    } catch (error) {
      if (!(error instanceof UnifiedPatchApplicationError) && !(error instanceof SyntaxError)) throw error;
      return null;
    }
    if (!isObject(patched) || !equalOutsidePointers(base, patched, [tokens[index]!])) return null;
    patchedDocuments.push(patched);
    if (after !== before) edits.push(singleSpanEdit(before, after));
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < edits.length; index += 1) {
    const previous = edits[index - 1]!;
    const current = edits[index]!;
    // Same-gap insertions and insertions on a replacement boundary are ambiguous.
    if (current.start <= previous.end) return null;
  }
  let content = before;
  for (const edit of [...edits].reverse()) {
    content = content.slice(0, edit.start) + edit.replacement + content.slice(edit.end);
  }
  // Independently valid edits (e.g. adjacent property deletions) may jointly
  // invalidate JSON. Verify every selected value and the untouched document.
  let composed: unknown;
  try { composed = JSON.parse(content); } catch { return null; }
  if (!equalOutsidePointers(base, composed, tokens)) return null;
  if (tokens.some((pointer, index) => JSON.stringify(readPointer(composed, pointer))
    !== JSON.stringify(readPointer(patchedDocuments[index], pointer)))) return null;
  return { ok: true, content, checkedPermutationCount: 1 };
}

function declaredPointer(proposal: PatchProposal): string[] | null {
  if (proposal.anchors.length !== 1 || proposal.anchors[0]?.kind !== 'json-pointer') return null;
  const pointer = proposal.anchors[0].hint;
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/.test(pointer)) return null;
  return pointer.slice(1).split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function singleSpanEdit(before: string, after: string): ByteEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let end = before.length;
  let afterEnd = after.length;
  while (end > start && afterEnd > start && before[end - 1] === after[afterEnd - 1]) { end -= 1; afterEnd -= 1; }
  return { start, end, replacement: after.slice(start, afterEnd) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPointer(document: unknown, tokens: readonly string[]): unknown {
  let current = document;
  for (const token of tokens) {
    if (!isObject(current) || !Object.hasOwn(current, token)) return undefined;
    current = current[token];
  }
  return current;
}

function equalOutsidePointers(before: unknown, after: unknown, pointers: readonly string[][]): boolean {
  const strip = (document: unknown): unknown => {
    const copy: unknown = structuredClone(document);
    for (const tokens of pointers) {
      let current = copy;
      for (const token of tokens.slice(0, -1)) {
        current = isObject(current) && Object.hasOwn(current, token) ? current[token] : undefined;
      }
      const leaf = tokens.at(-1);
      if (isObject(current) && leaf !== undefined) delete current[leaf];
    }
    return copy;
  };
  return JSON.stringify(strip(before)) === JSON.stringify(strip(after));
}
