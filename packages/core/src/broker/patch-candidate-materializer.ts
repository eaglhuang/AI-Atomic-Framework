import { createHash } from 'node:crypto';
import { composeTransactionalMutations, type TransactionalCompositionPlan } from './transactional-composer.ts';
import type { FileDescriptor, MutationRequest } from './types.ts';

/**
 * Immutable post-compose candidate materialization.
 * Serializability proves a legal order exists; this digest binds the exact
 * composed bytes that semantic validators must check before any canonical write.
 * Core never mutates the live worktree — outputs stay in-memory only.
 */

export interface PatchCandidateMaterializationInput {
  readonly baseHeadSha: string;
  readonly baseFiles: readonly FileDescriptor[];
  readonly requests: readonly MutationRequest[];
  readonly validators?: readonly string[];
  readonly adapters?: Parameters<typeof composeTransactionalMutations>[0]['adapters'];
  readonly maxPermutationChecks?: number;
  /** Declared card/proposal validators (capability ids or command refs). */
  readonly cardValidators?: readonly string[];
  /** Resolved language-adapter fast static checks (capability-driven refs). */
  readonly adapterStaticChecks?: readonly string[];
  /** Catalog-selected targeted tests (capability-driven refs). */
  readonly catalogTargetedTests?: readonly string[];
}

export interface SealedValidatorSelection {
  readonly schemaId: 'atm.sealedValidatorSelection.v1';
  readonly selectionInputDigest: string;
  readonly sealedSelectionSourceDigest: string;
  readonly requiredValidatorIds: readonly string[];
  readonly cardValidators: readonly string[];
  readonly adapterStaticChecks: readonly string[];
  readonly catalogTargetedTests: readonly string[];
}

export interface PatchCandidateMaterialization {
  readonly schemaId: 'atm.patchCandidate.v1';
  readonly specVersion: '0.1.0';
  readonly baseHeadSha: string;
  readonly candidateDigest: string;
  readonly compositionPlanDigest: string;
  readonly serializabilityProofDigest: string;
  readonly serializabilityProofPresent: boolean;
  readonly liveWorktreeMutation: false;
  readonly plan: TransactionalCompositionPlan;
  readonly outputFiles: readonly FileDescriptor[];
  readonly sealedSelection: SealedValidatorSelection;
  readonly memberAttribution: TransactionalCompositionPlan['memberAttribution'];
  readonly reasons: readonly string[];
  readonly ok: boolean;
}

/**
 * Seal the validator union before any producer can read a locked negative-control
 * fixture. Post-reveal union changes invalidate the cell (digest mismatch).
 */
export function sealValidatorSelection(input: {
  readonly cardValidators?: readonly string[];
  readonly adapterStaticChecks?: readonly string[];
  readonly catalogTargetedTests?: readonly string[];
}): SealedValidatorSelection {
  const cardValidators = normalizeRefs(input.cardValidators);
  const adapterStaticChecks = normalizeRefs(input.adapterStaticChecks);
  const catalogTargetedTests = normalizeRefs(input.catalogTargetedTests);
  const selectionInputDigest = digestJson({
    cardValidators,
    adapterStaticChecks,
    catalogTargetedTests
  });
  const requiredValidatorIds = uniqueSorted([
    ...cardValidators,
    ...adapterStaticChecks,
    ...catalogTargetedTests
  ]);
  const sealedSelectionSourceDigest = digestJson({
    selectionInputDigest,
    requiredValidatorIds
  });
  return {
    schemaId: 'atm.sealedValidatorSelection.v1',
    selectionInputDigest,
    sealedSelectionSourceDigest,
    requiredValidatorIds,
    cardValidators,
    adapterStaticChecks,
    catalogTargetedTests
  };
}

/**
 * Materialize an exact composed candidate from an immutable base snapshot.
 * Does not write to the live worktree.
 */
export function materializePatchCandidate(
  input: PatchCandidateMaterializationInput
): PatchCandidateMaterialization {
  const reasons: string[] = [];
  if (!input.baseHeadSha || input.baseHeadSha.trim().length === 0) {
    reasons.push('missing-base-head-sha');
  }
  if (!Array.isArray(input.baseFiles) || input.baseFiles.length === 0) {
    reasons.push('missing-base-files');
  }
  if (!Array.isArray(input.requests) || input.requests.length === 0) {
    reasons.push('missing-mutation-requests');
  }

  const sealedSelection = sealValidatorSelection({
    cardValidators: input.cardValidators ?? input.validators ?? [],
    adapterStaticChecks: input.adapterStaticChecks ?? [],
    catalogTargetedTests: input.catalogTargetedTests ?? []
  });

  const composition = composeTransactionalMutations({
    files: input.baseFiles,
    requests: input.requests,
    validators: sealedSelection.requiredValidatorIds,
    adapters: input.adapters,
    maxPermutationChecks: input.maxPermutationChecks
  });

  if (!composition.ok) {
    reasons.push('composition-blocked-or-incomplete');
  }
  if (!composition.plan.serializabilityProof.permutationStable) {
    reasons.push('serializability-proof-unstable');
  }

  for (const request of input.requests) {
    if (!request.requestId || !request.filePath) {
      reasons.push(`malformed-request:${request.requestId || 'unknown'}`);
    }
  }

  const compositionPlanDigest = digestJson(composition.plan);
  const serializabilityProofDigest = digestJson(composition.plan.serializabilityProof);
  const candidateDigest = digestCandidate(composition.plan, composition.outputFiles);

  // Verify plan attribution and slice digests bind to output bytes.
  for (const slice of composition.plan.fileSlices) {
    const output = composition.outputFiles.find((file) => normalizePath(file.filePath) === normalizePath(slice.filePath));
    if (!output) {
      reasons.push(`missing-output-slice:${slice.filePath}`);
      continue;
    }
    if (hashContent(output.content) !== slice.outputHash) {
      reasons.push(`output-hash-mismatch:${slice.filePath}`);
    }
  }

  return {
    schemaId: 'atm.patchCandidate.v1',
    specVersion: '0.1.0',
    baseHeadSha: input.baseHeadSha,
    candidateDigest,
    compositionPlanDigest,
    serializabilityProofDigest,
    serializabilityProofPresent: composition.plan.serializabilityProof.permutationStable,
    liveWorktreeMutation: false,
    plan: composition.plan,
    outputFiles: composition.outputFiles,
    sealedSelection,
    memberAttribution: composition.plan.memberAttribution,
    reasons,
    ok: reasons.length === 0 && composition.ok
  };
}

export function digestCandidate(
  plan: TransactionalCompositionPlan,
  outputFiles: readonly FileDescriptor[]
): string {
  return digestJson({
    planDigest: digestJson(plan),
    outputs: [...outputFiles]
      .map((file) => ({ filePath: normalizePath(file.filePath), contentHash: hashContent(file.content) }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath))
  });
}

function normalizeRefs(values: readonly string[] | undefined): readonly string[] {
  return uniqueSorted((values ?? []).map((value) => value.trim()).filter(Boolean));
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function digestJson(value: unknown): string {
  return hashContent(JSON.stringify(value));
}

function hashContent(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
