import { createHash } from 'node:crypto';

export const GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID = 'atm.governanceModelAdaptersResult.v1' as const;
export type GovernanceModelKind = 'task' | 'lane' | 'broker' | 'close' | 'runner';
export interface GovernanceAuthority { readonly authorityId: string; readonly sealed: boolean; readonly digest: string; readonly version?: string | null; }
export interface GovernanceModel { readonly modelId: string; readonly kind: GovernanceModelKind | string; readonly state: string; readonly owner?: string | null; readonly attributes?: Readonly<Record<string, string | number | boolean | null>>; }
export interface GovernanceAdapterInput { readonly runId: string; readonly authority: GovernanceAuthority; readonly models: readonly GovernanceModel[]; }
export interface GovernanceAdapterDiagnostic { readonly code: string; readonly severity: 'error' | 'warning'; readonly message: string; readonly ref: string | null; readonly repairCommand: string | null; }
export interface GovernanceAdapterProjection { readonly projectionId: string; readonly modelId: string; readonly kind: GovernanceModelKind; readonly canonicalState: string; readonly owner: string | null; readonly attributes: Readonly<Record<string, string | number | boolean | null>>; }
export interface GovernanceAdapterResult { readonly schemaId: typeof GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID; readonly specVersion: '0.1.0'; readonly runId: string; readonly resultId: string; readonly authority: GovernanceAuthority; readonly status: 'adapted' | 'blocked' | 'stale' | 'unsupported'; readonly projections: readonly GovernanceAdapterProjection[]; readonly diagnostics: readonly GovernanceAdapterDiagnostic[]; readonly provenance: { readonly inputDigest: string; readonly modelCount: number; readonly adapterKinds: readonly GovernanceModelKind[] }; }

/** One authority-preserving adapter seam for task/lane/broker/close/runner models. */
export function adaptGovernanceModels(input: GovernanceAdapterInput): GovernanceAdapterResult {
  const normalized = normalize(input); const diagnostics: GovernanceAdapterDiagnostic[] = [];
  if (!normalized.runId) diagnostics.push(error('ATM_GOV_ADAPTER_RUN_ID_MISSING', 'runId is required.', 'runId'));
  if (!normalized.authority.authorityId || !normalized.authority.digest) diagnostics.push(error('ATM_GOV_ADAPTER_AUTHORITY_INCOMPLETE', 'A sealed authority id and digest are required.', 'authority', 'restore and seal the governance model authority'));
  if (!normalized.authority.sealed) diagnostics.push(error('ATM_GOV_ADAPTER_AUTHORITY_UNSEALED', 'Model projections require a sealed authority.', 'authority.sealed', 'seal the governance model authority before adapting'));
  if (!normalized.models.length) diagnostics.push(error('ATM_GOV_ADAPTER_INPUT_INCOMPLETE', 'At least one governance model is required.', 'models', 'restore the deterministic governance fixture'));
  const ids = new Set<string>(); const projections: GovernanceAdapterProjection[] = [];
  for (const model of normalized.models) {
    if (ids.has(model.modelId)) diagnostics.push(error('ATM_GOV_ADAPTER_MODEL_DUPLICATE', `Duplicate model id ${model.modelId}.`, model.modelId, 'deduplicate the model authority'));
    ids.add(model.modelId);
    if (!KINDS.has(model.kind as GovernanceModelKind)) { diagnostics.push(error('ATM_GOV_ADAPTER_KIND_UNSUPPORTED', `Unsupported model kind ${model.kind}.`, model.modelId, 'use task, lane, broker, close, or runner')); continue; }
    if (!model.state) diagnostics.push(error('ATM_GOV_ADAPTER_STATE_INCOMPLETE', `Model ${model.modelId} has no state.`, model.modelId, 'restore the model state from the sealed authority'));
    projections.push({ projectionId: `projection_${digest(model).slice(7, 23)}`, modelId: model.modelId, kind: model.kind as GovernanceModelKind, canonicalState: model.state.toLowerCase(), owner: model.owner ?? null, attributes: model.attributes ?? {} });
  }
  const inputDigest = digest(normalized); const status = diagnostics.some((entry) => entry.severity === 'error') ? diagnostics.some((entry) => entry.code.includes('AUTHORITY')) ? 'stale' : diagnostics.some((entry) => entry.code.includes('UNSUPPORTED')) ? 'unsupported' : 'blocked' : 'adapted';
  return { schemaId: GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID, specVersion: '0.1.0', runId: normalized.runId, resultId: `governance_adapters_${inputDigest.slice(7, 23)}`, authority: normalized.authority, status, projections: projections.sort((a, b) => a.projectionId.localeCompare(b.projectionId)), diagnostics, provenance: { inputDigest, modelCount: normalized.models.length, adapterKinds: [...new Set(projections.map((entry) => entry.kind))].sort() } };
}
export const createGovernanceModelAdapters = adaptGovernanceModels;
export function replayGovernanceModelAdapters(input: GovernanceAdapterInput, expected: GovernanceAdapterResult): { readonly deterministic: boolean; readonly result: GovernanceAdapterResult } { const result = adaptGovernanceModels(input); return { deterministic: JSON.stringify(result) === JSON.stringify(expected), result }; }
export function validateGovernanceModelAdapters(result: GovernanceAdapterResult): { readonly ok: boolean; readonly diagnostics: readonly GovernanceAdapterDiagnostic[] } { const diagnostics: GovernanceAdapterDiagnostic[] = []; if (result.schemaId !== GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID) diagnostics.push(error('ATM_GOV_ADAPTER_SCHEMA_INVALID', 'Unexpected adapter schema id.', 'schemaId')); if (!/^governance_adapters_[0-9a-f]{16}$/.test(result.resultId)) diagnostics.push(error('ATM_GOV_ADAPTER_RESULT_ID_INVALID', 'resultId must derive from the input digest.', 'resultId')); if (result.status === 'adapted' && result.diagnostics.some((entry) => entry.severity === 'error')) diagnostics.push(error('ATM_GOV_ADAPTER_FALSE_GREEN', 'An adapted result cannot contain error diagnostics.', 'status')); return { ok: diagnostics.length === 0, diagnostics }; }
function normalize(input: GovernanceAdapterInput): GovernanceAdapterInput { return { runId: text(input?.runId), authority: { authorityId: text(input?.authority?.authorityId), sealed: input?.authority?.sealed === true, digest: text(input?.authority?.digest), version: input?.authority?.version == null ? null : text(input.authority.version) }, models: [...(input?.models ?? [])].map((model) => ({ modelId: text(model.modelId), kind: text(model.kind).toLowerCase(), state: text(model.state), owner: model.owner == null ? null : text(model.owner), attributes: model.attributes ?? {} })).sort((a, b) => a.modelId.localeCompare(b.modelId)) }; }
function digest(value: unknown): string { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function text(value: unknown): string { return String(value ?? '').trim(); }
function error(code: string, message: string, ref: string | null, repairCommand: string | null = null): GovernanceAdapterDiagnostic { return { code, severity: 'error', message, ref, repairCommand }; }
const KINDS = new Set<GovernanceModelKind>(['task', 'lane', 'broker', 'close', 'runner']);
