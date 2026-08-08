import { createHash } from 'node:crypto';

export const SANDBOXED_TEST_PATCH_SCHEMA_ID = 'atm.sandboxedTestPatch.v1' as const;
export type SandboxedTestPatchStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';

export interface PatchAuthority { readonly authorityId: string; readonly baseDigest: string; readonly sealed: boolean; }
export interface TestPatchOperation { readonly operationId: string; readonly path: string; readonly start: number; readonly end: number; readonly replacement: string; }
export interface SandboxPatchInput {
  readonly authority: PatchAuthority;
  readonly patchId: string;
  readonly operations: readonly TestPatchOperation[];
  readonly requiredTestIds: readonly string[];
  readonly passingTestIds: readonly string[];
  readonly sourceDigest: string;
  readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface SandboxPatchResult {
  readonly schemaId: typeof SANDBOXED_TEST_PATCH_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly patchId: string;
  readonly authority: PatchAuthority;
  readonly operations: readonly TestPatchOperation[];
  readonly minimizedOperationIds: readonly string[];
  readonly requiredTestIds: readonly string[];
  readonly passingTestIds: readonly string[];
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly status: SandboxedTestPatchStatus;
  readonly diagnostics: readonly string[];
  readonly repairCommand: string | null;
  readonly resultDigest: string;
}

export function compileSandboxedTestPatch(input: SandboxPatchInput): SandboxPatchResult {
  const n = normalize(input);
  const diagnostics: string[] = [];
  if (!n.authority.authorityId || !n.authority.baseDigest || n.authority.sealed !== true) diagnostics.push('authority-incomplete');
  if (!n.patchId || !n.sourceDigest || n.operations.length === 0) diagnostics.push('patch-incomplete');
  const seen = new Set<string>();
  for (const operation of n.operations) {
    if (seen.has(operation.operationId)) diagnostics.push(`duplicate-operation:${operation.operationId}`);
    seen.add(operation.operationId);
    if (!operation.path || operation.start < 0 || operation.end < operation.start) diagnostics.push(`invalid-operation:${operation.operationId}`);
  }
  const passing = new Set(n.passingTestIds);
  for (const id of n.requiredTestIds) if (!passing.has(id)) diagnostics.push(`missing-test:${id}`);
  if (n.sourceDigest !== n.authority.baseDigest) diagnostics.push('source-authority-drift');
  const minimized = minimize(n.operations);
  const status: SandboxedTestPatchStatus = diagnostics.some((entry) => entry.startsWith('duplicate-') || entry.startsWith('invalid-') || entry === 'authority-incomplete' || entry === 'patch-incomplete') ? 'contradictory' : diagnostics.some((entry) => entry === 'source-authority-drift') ? 'stale' : diagnostics.length ? 'blocked' : 'proven';
  const repairCommand = status === 'proven' ? null : 'restore the sealed source authority, repair patch/test evidence, then recompile in the sandbox';
  const result: SandboxPatchResult = {
    schemaId: SANDBOXED_TEST_PATCH_SCHEMA_ID,
    specVersion: '0.1.0',
    patchId: n.patchId,
    authority: n.authority,
    operations: n.operations,
    minimizedOperationIds: minimized.map((operation) => operation.operationId),
    requiredTestIds: n.requiredTestIds,
    passingTestIds: n.passingTestIds,
    provenance: n.provenance,
    status,
    diagnostics,
    repairCommand,
    resultDigest: digest({ patchId: n.patchId, authority: n.authority, operations: n.operations, minimizedOperationIds: minimized.map((operation) => operation.operationId), requiredTestIds: n.requiredTestIds, passingTestIds: n.passingTestIds, status, diagnostics })
  };
  return result;
}

export const createSandboxedTestPatch = compileSandboxedTestPatch;
export function replaySandboxedTestPatch(result: SandboxPatchResult): SandboxPatchResult { return compileSandboxedTestPatch({ authority: result.authority, patchId: result.patchId, operations: result.operations, requiredTestIds: result.requiredTestIds, passingTestIds: result.passingTestIds, sourceDigest: result.authority.baseDigest, provenance: result.provenance }); }
export function validateSandboxedTestPatch(result: SandboxPatchResult) { const replay = replaySandboxedTestPatch(result); const diagnostics = [...result.diagnostics]; if (result.resultDigest !== replay.resultDigest) diagnostics.push('result-digest-mismatch'); if (result.status !== replay.status) diagnostics.push('status-mismatch'); return { ok: diagnostics.length === 0 && result.status === 'proven', diagnostics: [...new Set(diagnostics)] }; }

function normalize(input: SandboxPatchInput) { return { authority: { authorityId: text(input.authority?.authorityId), baseDigest: text(input.authority?.baseDigest), sealed: input.authority?.sealed === true as true }, patchId: text(input.patchId), operations: [...(input.operations ?? [])].map((operation) => ({ operationId: text(operation.operationId), path: text(operation.path), start: Number(operation.start), end: Number(operation.end), replacement: String(operation.replacement ?? '') })).sort(compareOperation), requiredTestIds: [...(input.requiredTestIds ?? [])].map(text).filter(Boolean).sort(), passingTestIds: [...(input.passingTestIds ?? [])].map(text).filter(Boolean).sort(), sourceDigest: text(input.sourceDigest), provenance: input.provenance ?? {} }; }
function minimize(operations: readonly TestPatchOperation[]) { return [...operations].sort((a, b) => (a.end - a.start) - (b.end - b.start) || compareOperation(a, b)); }
function compareOperation(a: TestPatchOperation, b: TestPatchOperation) { return [a.path, a.start, a.end, a.replacement, a.operationId].join('\u001f').localeCompare([b.path, b.start, b.end, b.replacement, b.operationId].join('\u001f')); }
function text(value: unknown) { return String(value ?? '').trim(); }
function digest(value: unknown) { return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`; }
function stableStringify(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`; }
