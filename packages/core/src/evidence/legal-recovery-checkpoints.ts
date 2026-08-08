import { createHash } from 'node:crypto';

export const LEGAL_RECOVERY_CHECKPOINTS_SCHEMA_ID = 'atm.legalRecoveryCheckpointsResult.v1' as const;
export type RecoveryPhase = 'check-in' | 'close' | 'phase' | 'release';
export interface RecoveryAuthority { readonly authorityId: string; readonly sealed: boolean; readonly digest: string; readonly epoch?: string | null; }
export interface RecoveryCheckpoint { readonly checkpointId: string; readonly phase: RecoveryPhase | string; readonly state: string; readonly predecessorIds?: readonly string[]; readonly payload?: Readonly<Record<string, string | number | boolean | null>>; }
export interface RecoveryInput { readonly runId: string; readonly authority: RecoveryAuthority; readonly checkpoints: readonly RecoveryCheckpoint[]; }
export interface RecoveryDiagnostic { readonly code: string; readonly severity: 'error' | 'warning'; readonly message: string; readonly ref: string | null; readonly repairCommand: string | null; }
export interface RecoveryProjection { readonly projectionId: string; readonly checkpointId: string; readonly phase: RecoveryPhase; readonly canonicalState: string; readonly predecessorIds: readonly string[]; readonly payload: Readonly<Record<string, string | number | boolean | null>>; }
export interface RecoveryResult { readonly schemaId: typeof LEGAL_RECOVERY_CHECKPOINTS_SCHEMA_ID; readonly specVersion: '0.1.0'; readonly runId: string; readonly resultId: string; readonly authority: RecoveryAuthority; readonly status: 'projected' | 'blocked' | 'stale' | 'contradictory'; readonly projections: readonly RecoveryProjection[]; readonly diagnostics: readonly RecoveryDiagnostic[]; readonly provenance: { readonly inputDigest: string; readonly checkpointCount: number; readonly phases: readonly RecoveryPhase[] }; }

const PHASES = new Set<RecoveryPhase>(['check-in', 'close', 'phase', 'release']);
const text = (value: unknown) => String(value ?? '').trim();
const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const error = (code: string, message: string, ref: string | null, repairCommand: string | null = null): RecoveryDiagnostic => ({ code, severity: 'error', message, ref, repairCommand });

export function projectLegalRecoveryCheckpoints(input: RecoveryInput): RecoveryResult {
  const normalized = { runId: text(input?.runId), authority: { authorityId: text(input?.authority?.authorityId), sealed: input?.authority?.sealed === true, digest: text(input?.authority?.digest), epoch: input?.authority?.epoch == null ? null : text(input.authority.epoch) }, checkpoints: [...(input?.checkpoints ?? [])].map((checkpoint) => ({ checkpointId: text(checkpoint.checkpointId), phase: text(checkpoint.phase).toLowerCase(), state: text(checkpoint.state).toLowerCase(), predecessorIds: [...(checkpoint.predecessorIds ?? [])].map(text).sort(), payload: checkpoint.payload ?? {} })).sort((a, b) => a.checkpointId.localeCompare(b.checkpointId)) };
  const diagnostics: RecoveryDiagnostic[] = [];
  if (!normalized.runId) diagnostics.push(error('ATM_RECOVERY_RUN_ID_MISSING', 'runId is required.', 'runId'));
  if (!normalized.authority.authorityId || !normalized.authority.digest) diagnostics.push(error('ATM_RECOVERY_AUTHORITY_INCOMPLETE', 'A sealed authority id and digest are required.', 'authority', 'restore and seal the recovery authority'));
  if (!normalized.authority.sealed) diagnostics.push(error('ATM_RECOVERY_AUTHORITY_UNSEALED', 'Recovery projections require a sealed authority.', 'authority.sealed', 'seal the recovery authority before projection'));
  if (!normalized.checkpoints.length) diagnostics.push(error('ATM_RECOVERY_INPUT_EMPTY', 'At least one recovery checkpoint is required.', 'checkpoints', 'restore the deterministic recovery fixture'));
  const ids = new Set<string>(); const projections: RecoveryProjection[] = [];
  for (const checkpoint of normalized.checkpoints) {
    if (!checkpoint.checkpointId || ids.has(checkpoint.checkpointId)) diagnostics.push(error('ATM_RECOVERY_CHECKPOINT_DUPLICATE', `Duplicate or missing checkpoint id ${checkpoint.checkpointId}.`, checkpoint.checkpointId || null, 'deduplicate checkpoint authority'));
    ids.add(checkpoint.checkpointId);
    if (!PHASES.has(checkpoint.phase as RecoveryPhase)) { diagnostics.push(error('ATM_RECOVERY_PHASE_UNSUPPORTED', `Unsupported recovery phase ${checkpoint.phase}.`, checkpoint.checkpointId, 'use check-in, close, phase, or release')); continue; }
    if (!checkpoint.state) diagnostics.push(error('ATM_RECOVERY_STATE_INCOMPLETE', `Checkpoint ${checkpoint.checkpointId} has no state.`, checkpoint.checkpointId, 'restore checkpoint state from sealed authority'));
    projections.push({ projectionId: `recovery_${digest(checkpoint).slice(7, 23)}`, checkpointId: checkpoint.checkpointId, phase: checkpoint.phase as RecoveryPhase, canonicalState: checkpoint.state, predecessorIds: checkpoint.predecessorIds, payload: checkpoint.payload });
  }
  const projectionIds = new Set(projections.map((projection) => projection.checkpointId));
  for (const projection of projections) for (const predecessorId of projection.predecessorIds) if (!projectionIds.has(predecessorId)) diagnostics.push(error('ATM_RECOVERY_PREDECESSOR_MISSING', `Predecessor ${predecessorId} is not in the sealed checkpoint set.`, projection.checkpointId, 'restore the complete predecessor chain'));
  const inputDigest = digest(normalized); const status = diagnostics.some((entry) => entry.code.includes('AUTHORITY')) ? 'stale' : diagnostics.some((entry) => entry.code.includes('DUPLICATE') || entry.code.includes('PREDECESSOR')) ? 'contradictory' : diagnostics.some((entry) => entry.severity === 'error') ? 'blocked' : 'projected';
  return { schemaId: LEGAL_RECOVERY_CHECKPOINTS_SCHEMA_ID, specVersion: '0.1.0', runId: normalized.runId, resultId: `legal_recovery_${inputDigest.slice(7, 23)}`, authority: normalized.authority, status, projections: projections.sort((a, b) => a.projectionId.localeCompare(b.projectionId)), diagnostics, provenance: { inputDigest, checkpointCount: normalized.checkpoints.length, phases: [...new Set(projections.map((projection) => projection.phase))].sort() } };
}
export const createLegalRecoveryCheckpoints = projectLegalRecoveryCheckpoints;
export function replayLegalRecoveryCheckpoints(input: RecoveryInput, expected: RecoveryResult) { const result = projectLegalRecoveryCheckpoints(input); return { deterministic: JSON.stringify(result) === JSON.stringify(expected), result }; }
export function validateLegalRecoveryCheckpoints(result: RecoveryResult) { const diagnostics: RecoveryDiagnostic[] = []; if (result.schemaId !== LEGAL_RECOVERY_CHECKPOINTS_SCHEMA_ID) diagnostics.push(error('ATM_RECOVERY_SCHEMA_INVALID', 'Unexpected recovery schema id.', 'schemaId')); if (!/^legal_recovery_[0-9a-f]{16}$/.test(result.resultId)) diagnostics.push(error('ATM_RECOVERY_RESULT_ID_INVALID', 'resultId must derive from input digest.', 'resultId')); if (result.status === 'projected' && result.diagnostics.some((entry) => entry.severity === 'error')) diagnostics.push(error('ATM_RECOVERY_FALSE_GREEN', 'Projected result cannot contain error diagnostics.', 'status')); return { ok: diagnostics.length === 0, diagnostics }; }
