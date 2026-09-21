import { createHash } from 'node:crypto';
export const GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID = 'atm.governanceModelAdaptersResult.v1';
/** One authority-preserving adapter seam for task/lane/broker/close/runner models. */
export function adaptGovernanceModels(input) {
    const normalized = normalize(input);
    const diagnostics = [];
    if (!normalized.runId)
        diagnostics.push(error('ATM_GOV_ADAPTER_RUN_ID_MISSING', 'runId is required.', 'runId'));
    if (!normalized.authority.authorityId || !normalized.authority.digest)
        diagnostics.push(error('ATM_GOV_ADAPTER_AUTHORITY_INCOMPLETE', 'A sealed authority id and digest are required.', 'authority', 'restore and seal the governance model authority'));
    if (!normalized.authority.sealed)
        diagnostics.push(error('ATM_GOV_ADAPTER_AUTHORITY_UNSEALED', 'Model projections require a sealed authority.', 'authority.sealed', 'seal the governance model authority before adapting'));
    if (!normalized.models.length)
        diagnostics.push(error('ATM_GOV_ADAPTER_INPUT_INCOMPLETE', 'At least one governance model is required.', 'models', 'restore the deterministic governance fixture'));
    const ids = new Set();
    const projections = [];
    for (const model of normalized.models) {
        if (ids.has(model.modelId))
            diagnostics.push(error('ATM_GOV_ADAPTER_MODEL_DUPLICATE', `Duplicate model id ${model.modelId}.`, model.modelId, 'deduplicate the model authority'));
        ids.add(model.modelId);
        if (!KINDS.has(model.kind)) {
            diagnostics.push(error('ATM_GOV_ADAPTER_KIND_UNSUPPORTED', `Unsupported model kind ${model.kind}.`, model.modelId, 'use task, lane, broker, close, or runner'));
            continue;
        }
        if (!model.state)
            diagnostics.push(error('ATM_GOV_ADAPTER_STATE_INCOMPLETE', `Model ${model.modelId} has no state.`, model.modelId, 'restore the model state from the sealed authority'));
        projections.push({ projectionId: `projection_${digest(model).slice(7, 23)}`, modelId: model.modelId, kind: model.kind, canonicalState: model.state.toLowerCase(), owner: model.owner ?? null, attributes: model.attributes ?? {} });
    }
    const inputDigest = digest(normalized);
    const status = diagnostics.some((entry) => entry.severity === 'error') ? diagnostics.some((entry) => entry.code.includes('AUTHORITY')) ? 'stale' : diagnostics.some((entry) => entry.code.includes('UNSUPPORTED')) ? 'unsupported' : 'blocked' : 'adapted';
    return { schemaId: GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID, specVersion: '0.1.0', runId: normalized.runId, resultId: `governance_adapters_${inputDigest.slice(7, 23)}`, authority: normalized.authority, status, projections: projections.sort((a, b) => a.projectionId.localeCompare(b.projectionId)), diagnostics, provenance: { inputDigest, modelCount: normalized.models.length, adapterKinds: [...new Set(projections.map((entry) => entry.kind))].sort() } };
}
export const createGovernanceModelAdapters = adaptGovernanceModels;
export function replayGovernanceModelAdapters(input, expected) { const result = adaptGovernanceModels(input); return { deterministic: JSON.stringify(result) === JSON.stringify(expected), result }; }
export function validateGovernanceModelAdapters(result) { const diagnostics = []; if (result.schemaId !== GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID)
    diagnostics.push(error('ATM_GOV_ADAPTER_SCHEMA_INVALID', 'Unexpected adapter schema id.', 'schemaId')); if (!/^governance_adapters_[0-9a-f]{16}$/.test(result.resultId))
    diagnostics.push(error('ATM_GOV_ADAPTER_RESULT_ID_INVALID', 'resultId must derive from the input digest.', 'resultId')); if (result.status === 'adapted' && result.diagnostics.some((entry) => entry.severity === 'error'))
    diagnostics.push(error('ATM_GOV_ADAPTER_FALSE_GREEN', 'An adapted result cannot contain error diagnostics.', 'status')); return { ok: diagnostics.length === 0, diagnostics }; }
function normalize(input) { return { runId: text(input?.runId), authority: { authorityId: text(input?.authority?.authorityId), sealed: input?.authority?.sealed === true, digest: text(input?.authority?.digest), version: input?.authority?.version == null ? null : text(input.authority.version) }, models: [...(input?.models ?? [])].map((model) => ({ modelId: text(model.modelId), kind: text(model.kind).toLowerCase(), state: text(model.state), owner: model.owner == null ? null : text(model.owner), attributes: model.attributes ?? {} })).sort((a, b) => a.modelId.localeCompare(b.modelId)) }; }
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function text(value) { return String(value ?? '').trim(); }
function error(code, message, ref, repairCommand = null) { return { code, severity: 'error', message, ref, repairCommand }; }
const KINDS = new Set(['task', 'lane', 'broker', 'close', 'runner']);
