export type PatchEnvelopeMode = 'metadata-only' | 'textual-diff';
export type PatchEnvelopeWipState = 'partial' | 'complete';

export interface PatchEnvelope {
  readonly schemaId: 'atm.patchEnvelope.v1';
  readonly specVersion: '0.1.0';
  readonly envelopeId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly mode: PatchEnvelopeMode;
  readonly wipState: PatchEnvelopeWipState;
  readonly snapshotDir: string;
  readonly targetFiles: readonly string[];
  readonly patchText: string | null;
  readonly metadata: {
    readonly freezeId: string;
    readonly capturedAt: string;
    readonly confidence: 'low' | 'medium' | 'high';
    readonly partialReason: string | null;
  };
}

export function createPatchEnvelope(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly freezeId: string;
  readonly snapshotDir?: string;
  readonly targetFiles?: readonly string[];
  readonly patchText?: string | null;
  readonly wipState?: PatchEnvelopeWipState;
  readonly confidence?: 'low' | 'medium' | 'high';
  readonly partialReason?: string | null;
  readonly capturedAt?: string;
}): PatchEnvelope {
  const patchText = input.patchText ?? null;
  const mode: PatchEnvelopeMode = patchText ? 'textual-diff' : 'metadata-only';
  return {
    schemaId: 'atm.patchEnvelope.v1',
    specVersion: '0.1.0',
    envelopeId: `patch-envelope-${Date.now()}`,
    taskId: input.taskId,
    actorId: input.actorId,
    mode,
    wipState: input.wipState ?? 'partial',
    snapshotDir: input.snapshotDir ?? '.atm/runtime/wip-snapshot',
    targetFiles: input.targetFiles ?? [],
    patchText,
    metadata: {
      freezeId: input.freezeId,
      capturedAt: input.capturedAt ?? new Date().toISOString(),
      confidence: input.confidence ?? 'medium',
      partialReason: input.partialReason ?? null
    }
  };
}

export function isMetadataOnlyEnvelope(envelope: PatchEnvelope): boolean {
  return envelope.mode === 'metadata-only' && envelope.patchText === null;
}

export interface PatchEnvelopeSummary {
  readonly envelopeId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly freezeId: string;
  readonly mode: PatchEnvelopeMode;
  readonly wipState: PatchEnvelopeWipState;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly fileCount: number;
  readonly hasPatchText: boolean;
  readonly capturedAt: string;
}

export interface PatchEnvelopeDivergence {
  readonly field: string;
  readonly left: unknown;
  readonly right: unknown;
}

export function summarizePatchEnvelope(envelope: PatchEnvelope): PatchEnvelopeSummary {
  return {
    envelopeId: envelope.envelopeId,
    taskId: envelope.taskId,
    actorId: envelope.actorId,
    freezeId: envelope.metadata.freezeId,
    mode: envelope.mode,
    wipState: envelope.wipState,
    confidence: envelope.metadata.confidence,
    fileCount: envelope.targetFiles.length,
    hasPatchText: envelope.patchText !== null && envelope.patchText.length > 0,
    capturedAt: envelope.metadata.capturedAt
  };
}

export function comparePatchEnvelopes(
  left: PatchEnvelope,
  right: PatchEnvelope
): { readonly equal: boolean; readonly divergences: readonly PatchEnvelopeDivergence[] } {
  const divergences: PatchEnvelopeDivergence[] = [];
  const scalarFields: readonly (keyof PatchEnvelope)[] = [
    'taskId', 'actorId', 'mode', 'wipState', 'snapshotDir', 'patchText'
  ];
  for (const field of scalarFields) {
    if (left[field] !== right[field]) {
      divergences.push({ field: String(field), left: left[field], right: right[field] });
    }
  }
  if (left.targetFiles.length !== right.targetFiles.length ||
      left.targetFiles.some((file, idx) => file !== right.targetFiles[idx])) {
    divergences.push({ field: 'targetFiles', left: left.targetFiles, right: right.targetFiles });
  }
  const metadataFields: readonly (keyof PatchEnvelope['metadata'])[] = [
    'freezeId', 'confidence', 'partialReason'
  ];
  for (const field of metadataFields) {
    if (left.metadata[field] !== right.metadata[field]) {
      divergences.push({ field: `metadata.${String(field)}`, left: left.metadata[field], right: right.metadata[field] });
    }
  }
  return { equal: divergences.length === 0, divergences };
}

export function validatePatchEnvelope(envelope: PatchEnvelope): { readonly ok: boolean; readonly reason: string } {
  if (!envelope.taskId.trim()) {
    return { ok: false, reason: 'taskId is required' };
  }
  if (!envelope.actorId.trim()) {
    return { ok: false, reason: 'actorId is required' };
  }
  if (!envelope.metadata.freezeId.trim()) {
    return { ok: false, reason: 'freezeId is required' };
  }
  if (envelope.wipState === 'partial' && !envelope.patchText && envelope.metadata.confidence === 'low') {
    return { ok: true, reason: 'metadata-only partial WIP envelope accepted' };
  }
  if (envelope.mode === 'textual-diff' && !envelope.patchText) {
    return { ok: false, reason: 'textual-diff envelope must carry patchText' };
  }
  return { ok: true, reason: 'patch envelope accepted' };
}
