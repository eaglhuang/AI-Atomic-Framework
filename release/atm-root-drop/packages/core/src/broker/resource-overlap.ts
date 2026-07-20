import { createHash } from 'node:crypto';
import type { ActiveWriteIntent, WriteIntent, WriteIntentAtomRef } from './types.ts';

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

export function compareResourceKeys(resourceKind: string, leftKey: string, rightKey: string): ResourceKeyOverlapFact {
  const left = normalizeResourceKey(leftKey);
  const right = normalizeResourceKey(rightKey);
  if (!left || !right) {
    return resourceFact(resourceKind, leftKey, rightKey, left, right, 'unknown', 'empty resource key cannot be matched safely');
  }
  if (left === right) {
    return resourceFact(resourceKind, leftKey, rightKey, left, right, 'overlap', 'resource keys are equal after normalization');
  }
  const leftPattern = parseResourcePattern(left);
  const rightPattern = parseResourcePattern(right);
  if (leftPattern.unsupported || rightPattern.unsupported) {
    return resourceFact(resourceKind, leftKey, rightKey, left, right, 'unknown', 'unsupported pattern syntax');
  }
  if (leftPattern.hasPattern && !rightPattern.hasPattern) {
    return resourceFact(resourceKind, leftKey, rightKey, left, right, matchGlob(left, right) ? 'overlap' : 'clear', 'left pattern tested against right literal');
  }
  if (!leftPattern.hasPattern && rightPattern.hasPattern) {
    return resourceFact(resourceKind, leftKey, rightKey, left, right, matchGlob(right, left) ? 'overlap' : 'clear', 'right pattern tested against left literal');
  }
  if (leftPattern.hasPattern && rightPattern.hasPattern) {
    const verdict = patternPrefixesIntersect(left, right) ? 'overlap' : 'clear';
    return resourceFact(resourceKind, leftKey, rightKey, left, right, verdict, 'pattern prefixes compared for non-empty intersection');
  }
  return resourceFact(resourceKind, leftKey, rightKey, left, right, 'clear', 'distinct literal resource keys');
}

export function collectResourceKeyOverlapFacts(resourceKind: string, left: readonly string[], right: readonly string[]): readonly ResourceKeyOverlapFact[] {
  return left.flatMap((leftKey) => right.map((rightKey) => compareResourceKeys(resourceKind, leftKey, rightKey)));
}

export function resourceListsOverlap(resourceKind: string, left: readonly string[], right: readonly string[]): boolean {
  return collectResourceKeyOverlapFacts(resourceKind, left, right).some((fact) => fact.verdict !== 'clear');
}

export interface ResourceOverlapMatch {
  readonly resourceKind: string;
  readonly leftKey: string;
  readonly rightKey: string;
  readonly verdict: 'overlap' | 'unknown';
  readonly reason: string;
}

export function findResourceOverlapMatches(
  resourceKind: string,
  left: readonly string[],
  right: readonly string[]
): readonly ResourceOverlapMatch[] {
  const matches: ResourceOverlapMatch[] = [];
  for (const fact of collectResourceKeyOverlapFacts(resourceKind, left, right)) {
    if (fact.verdict === 'clear') continue;
    matches.push({
      resourceKind: fact.resourceKind,
      leftKey: fact.leftKey,
      rightKey: fact.rightKey,
      verdict: fact.verdict,
      reason: fact.reason
    });
  }
  return matches;
}

export function buildResourceOverlapReport(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[]): ResourceOverlapReport {
  const facts = activeIntents.flatMap((active) => active.taskId === newIntent.taskId ? [] : buildResourceOverlaps(newIntent, active));
  const summary = {
    overlap: facts.filter((fact) => fact.verdict === 'overlap').length,
    disjoint: facts.filter((fact) => fact.verdict === 'disjoint').length,
    unknown: facts.filter((fact) => fact.verdict === 'unknown').length,
    shadowMismatches: facts.filter((fact) => fact.shadow?.parity === 'mismatch').length
  };
  const inputDigest = digestStable({ taskId: newIntent.taskId, baseCommit: newIntent.baseCommit, active: activeIntents.map((entry) => entry.intentId) });
  return {
    schemaId: 'atm.resourceOverlapReport.v1',
    specVersion: '0.1.0',
    taskId: newIntent.taskId,
    actorId: newIntent.actorId,
    baseCommit: newIntent.baseCommit,
    facts,
    summary,
    inputDigest
  };
}

export function buildResourceOverlaps(newIntent: WriteIntent, active: ActiveWriteIntent): readonly ResourceOverlap[] {
  const pairs: Array<{ kind: string; left: readonly string[]; right: readonly string[]; provenance: readonly string[] }> = [
    { kind: 'file', left: newIntent.targetFiles, right: active.resourceKeys.files, provenance: ['targetFiles', 'active.resourceKeys.files'] },
    { kind: 'atom-id', left: newIntent.atomRefs.map((ref) => ref.atomId), right: active.resourceKeys.atomIds, provenance: ['atomRefs.atomId', 'active.resourceKeys.atomIds'] },
    { kind: 'atom-cid', left: newIntent.atomRefs.map((ref) => ref.atomCid), right: active.resourceKeys.atomCids, provenance: ['atomRefs.atomCid', 'active.resourceKeys.atomCids'] },
    { kind: 'read-atom-id', left: (newIntent.readAtoms ?? []).map((ref) => ref.atomId), right: active.resourceKeys.atomIds, provenance: ['readAtoms.atomId', 'active.resourceKeys.atomIds'] },
    { kind: 'read-atom-cid', left: (newIntent.readAtoms ?? []).map((ref) => ref.atomCid), right: active.resourceKeys.atomCids, provenance: ['readAtoms.atomCid', 'active.resourceKeys.atomCids'] },
    { kind: 'active-read-atom-id', left: newIntent.atomRefs.map((ref) => ref.atomId), right: active.resourceKeys.readAtomIds ?? [], provenance: ['atomRefs.atomId', 'active.resourceKeys.readAtomIds'] },
    { kind: 'active-read-atom-cid', left: newIntent.atomRefs.map((ref) => ref.atomCid), right: active.resourceKeys.readAtomCids ?? [], provenance: ['atomRefs.atomCid', 'active.resourceKeys.readAtomCids'] },
    { kind: 'generator', left: newIntent.sharedSurfaces.generators, right: active.resourceKeys.generators, provenance: ['sharedSurfaces.generators', 'active.resourceKeys.generators'] },
    { kind: 'projection', left: newIntent.sharedSurfaces.projections, right: active.resourceKeys.projections, provenance: ['sharedSurfaces.projections', 'active.resourceKeys.projections'] },
    { kind: 'registry', left: newIntent.sharedSurfaces.registries, right: active.resourceKeys.registries, provenance: ['sharedSurfaces.registries', 'active.resourceKeys.registries'] },
    { kind: 'validator', left: newIntent.sharedSurfaces.validators, right: active.resourceKeys.validators, provenance: ['sharedSurfaces.validators', 'active.resourceKeys.validators'] },
    { kind: 'artifact', left: newIntent.sharedSurfaces.artifacts, right: active.resourceKeys.artifacts, provenance: ['sharedSurfaces.artifacts', 'active.resourceKeys.artifacts'] }
  ];

  const keyFacts = pairs.flatMap(({ kind, left, right, provenance }) => collectResourceKeyOverlapFacts(kind, left, right)
    .map((fact) => toResourceOverlap(newIntent, active, fact, provenance, anchorsFor(newIntent.atomRefs, active, fact))));
  const rangeFacts = buildLineRangeOverlaps(newIntent, active);
  return [...keyFacts, ...rangeFacts].sort((left, right) => digestStable(left).localeCompare(digestStable(right)));
}

function buildLineRangeOverlaps(newIntent: WriteIntent, active: ActiveWriteIntent): readonly ResourceOverlap[] {
  const sourceRanges = newIntent.atomRefs
    .map((entry) => ({ entry, range: entry.sourceRange }))
    .filter((candidate): candidate is { entry: WriteIntentAtomRef; range: NonNullable<WriteIntentAtomRef['sourceRange']> } => !!candidate.range);
  const activeRanges = active.resourceKeys.atomRanges ?? [];
  return sourceRanges.flatMap((source) => activeRanges
    .filter((activeRange) => normalizeResourceKey(activeRange.filePath) === normalizeResourceKey(source.range.filePath))
    .map((activeRange) => {
      const overlaps = source.range.lineStart <= activeRange.lineEnd && source.range.lineEnd >= activeRange.lineStart;
      const fact = compareResourceKeys('file', source.range.filePath, activeRange.filePath);
      return toResourceOverlap(newIntent, active, fact, ['atomRefs.sourceRange', 'active.resourceKeys.atomRanges'], [
        anchorForRef(newIntent.taskId, source.entry),
        { taskId: active.taskId, atomCid: activeRange.atomCid, filePath: activeRange.filePath, lineStart: activeRange.lineStart, lineEnd: activeRange.lineEnd, contentAnchorIds: [] }
      ], overlaps ? 'overlap' : 'disjoint', {
        kind: 'line-range',
        detail: overlaps ? `${source.range.lineStart}-${source.range.lineEnd} intersects ${activeRange.lineStart}-${activeRange.lineEnd}` : `${source.range.lineStart}-${source.range.lineEnd} is disjoint from ${activeRange.lineStart}-${activeRange.lineEnd}`
      });
    }));
}

function toResourceOverlap(
  newIntent: WriteIntent,
  active: ActiveWriteIntent,
  fact: ResourceKeyOverlapFact,
  provenance: readonly string[],
  anchors: readonly ResourceOverlapAnchor[],
  forcedVerdict?: ResourceOverlapVerdict,
  forcedIntersection?: ResourceOverlapIntersection
): ResourceOverlap {
  const verdict = forcedVerdict ?? (fact.verdict === 'clear' ? 'disjoint' : fact.verdict);
  const legacyPredicate = fact.verdict !== 'clear';
  const inputDigest = digestStable({ fact, newTaskId: newIntent.taskId, activeTaskId: active.taskId, provenance });
  return {
    schemaId: 'atm.resourceOverlap.v1',
    specVersion: '0.1.0',
    resourceKind: fact.resourceKind,
    leftTaskId: newIntent.taskId,
    leftActorId: newIntent.actorId,
    leftLaneSessionId: null,
    leftIntentId: null,
    rightTaskId: active.taskId,
    rightActorId: active.actorId,
    rightLaneSessionId: null,
    rightIntentId: active.intentId,
    leftKey: fact.leftKey,
    rightKey: fact.rightKey,
    normalizedLeftKey: fact.normalizedLeftKey,
    normalizedRightKey: fact.normalizedRightKey,
    verdict,
    matcherVersion: 'resource-overlap@0.1.0',
    resolverVersion: fact.matcherVersion,
    provenance,
    confidence: fact.verdict === 'unknown' ? 'low' : 'high',
    anchors,
    intersection: forcedIntersection ?? { kind: fact.reason.includes('pattern') ? 'pattern' : fact.verdict === 'unknown' ? 'unknown' : 'key', detail: fact.reason },
    inputDigest,
    shadow: {
      legacyPredicate,
      structuredVerdict: verdict,
      parity: legacyPredicate === (verdict !== 'disjoint') ? 'match' : 'mismatch',
      reason: fact.reason
    }
  };
}

function anchorsFor(refs: readonly WriteIntentAtomRef[], active: ActiveWriteIntent, fact: ResourceKeyOverlapFact): readonly ResourceOverlapAnchor[] {
  return [
    ...refs
      .filter((ref) => ref.atomId === fact.leftKey || ref.atomCid === fact.leftKey || ref.sourceRange?.filePath === fact.leftKey)
      .map((ref) => anchorForRef(active.taskId, ref)),
    ...((active.resourceKeys.atomRanges ?? [])
      .filter((range) => range.filePath === fact.rightKey || range.atomCid === fact.rightKey)
      .map((range) => ({ taskId: active.taskId, atomCid: range.atomCid, filePath: range.filePath, lineStart: range.lineStart, lineEnd: range.lineEnd, contentAnchorIds: [] })))
  ];
}

function anchorForRef(taskId: string, ref: WriteIntentAtomRef): ResourceOverlapAnchor {
  return {
    taskId,
    atomId: ref.atomId,
    atomCid: ref.atomCid,
    filePath: ref.sourceRange?.filePath,
    lineStart: ref.sourceRange?.lineStart,
    lineEnd: ref.sourceRange?.lineEnd,
    contentAnchorIds: (ref.contentAnchors ?? []).map((anchor) => anchor.anchorId)
  };
}

function resourceFact(
  resourceKind: string,
  leftKey: string,
  rightKey: string,
  normalizedLeftKey: string,
  normalizedRightKey: string,
  verdict: ResourceKeyOverlapVerdict,
  reason: string
): ResourceKeyOverlapFact {
  return { resourceKind, leftKey, rightKey, normalizedLeftKey, normalizedRightKey, verdict, reason, matcherVersion: 'resource-key-matcher@0.2.0' };
}

function normalizeResourceKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
}

function parseResourcePattern(value: string): { readonly hasPattern: boolean; readonly unsupported: boolean } {
  const hasPattern = /[*?[\]{}]/.test(value);
  return { hasPattern, unsupported: /[?[\]{}]/.test(value) };
}

function matchGlob(pattern: string, literal: string): boolean {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    source += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`).test(literal);
}

function patternPrefixesIntersect(leftPattern: string, rightPattern: string): boolean {
  const leftPrefix = literalPrefix(leftPattern);
  const rightPrefix = literalPrefix(rightPattern);
  return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
}

function literalPrefix(pattern: string): string {
  const index = pattern.search(/[*?[\]{}]/);
  return index < 0 ? pattern : pattern.slice(0, index);
}

function digestStable(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
