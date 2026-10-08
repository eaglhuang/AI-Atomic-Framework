import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sortProposalsForCompose } from './merge-plan.ts';
import {
  commitCanonicalFiles,
  defaultStewardCommitLockRoot,
  type StewardCommitFault
} from './steward-commit-guard.ts';
import { composeTextPatchesAgainstBase, type BaseCompositionResult, type StewardCompositionBlock } from './steward-base-composer.ts';
import { applyUnifiedPatch, UnifiedPatchApplicationError } from './unified-patch.ts';
import type {
  CompositionFileSlice,
  CompositionMemberAttribution,
  TransactionalCompositionPlan
} from './transactional-composer.ts';
import type { FileDescriptor, MergePlan, MigrationRecord, PatchProposal } from './types.ts';

export interface StewardSemanticValidationReceipt {
  readonly schemaId: 'atm.stewardSemanticValidationReceipt.v1';
  readonly candidateDigest: string;
  readonly outputDigest: string;
  readonly ok: true;
}

export interface TransactionalStewardFileReceipt {
  readonly filePath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly canonicalWriteCount: 1;
  readonly tempOutputHash: string;
}

export interface TransactionalStewardApplyReceipt {
  readonly schemaId: 'atm.transactionalStewardApplyReceipt.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly stewardId: string;
  readonly writerRole: 'neutral-steward';
  readonly compositionPlanId: string;
  readonly compositionPlanDigest: string;
  readonly serializabilityProofDigest: string;
  readonly candidateDigest: string;
  readonly canonicalRoot: string;
  readonly baseHead: string | null;
  readonly memberAttribution: TransactionalCompositionPlan['memberAttribution'];
  readonly files: readonly TransactionalStewardFileReceipt[];
  readonly verdict: 'applied' | 'blocked' | 'rolled-back' | 're-compose' | 'recovery-required';
  readonly blockedReasons: readonly string[];
  readonly compensation?: {
    readonly restoredFiles: readonly string[];
    readonly failedFile: string | null;
    readonly reason: string;
  };
}

export interface TransactionalStewardApplyResult {
  readonly ok: boolean;
  readonly receipt: TransactionalStewardApplyReceipt;
}

export function buildPatchProposalComposition(input: {
  readonly cwd: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
}): {
  readonly plan: TransactionalCompositionPlan;
  readonly outputFiles: readonly FileDescriptor[];
  /** Set when a file cannot be composed against its base; nothing may be written then. */
  readonly blocked: StewardCompositionBlock | null;
} {
  const sorted = sortProposalsForCompose(input.proposals);
  const byFile = new Map<string, PatchProposal[]>();
  for (const proposal of sorted) {
    const group = byFile.get(proposal.targetFile) ?? [];
    group.push(proposal);
    byFile.set(proposal.targetFile, group);
  }
  const outputFiles: FileDescriptor[] = [];
  const fileSlices: CompositionFileSlice[] = [];
  const attribution: CompositionMemberAttribution[] = [];
  const selectedIds: string[] = [];
  let blocked: StewardCompositionBlock | null = null;
  let checkedPermutationCount = 0;
  for (const [filePath, proposals] of [...byFile].sort((left, right) => left[0].localeCompare(right[0]))) {
    const targetPath = path.resolve(input.cwd, filePath);
    const before = readFileSync(targetPath, 'utf8');
    const composed = composeProposalPatchesAgainstImmutableBase(filePath, before, proposals);
    if (!composed.ok) {
      blocked = composed.block;
      break;
    }
    checkedPermutationCount += composed.checkedPermutationCount;
    const after = composed.content;
    for (const proposal of proposals) {
      selectedIds.push(proposal.proposalId);
      attribution.push({
        requestId: proposal.proposalId,
        actorId: proposal.actorId,
        taskId: proposal.taskId,
        transactionIds: extractProposalTransactionIds(proposal),
        filePath: proposal.targetFile,
        adapterId: `steward.${input.mergePlan.applyMethod}`,
        verdict: 'selected',
        reason: 'patch proposal composed into a single steward-authored output file'
      });
    }
    outputFiles.push({ filePath, content: after });
    fileSlices.push({
      filePath,
      adapterId: `steward.${input.mergePlan.applyMethod}`,
      baseHash: hashContent(before),
      outputHash: hashContent(after),
      selectedRequestIds: proposals.map((proposal) => proposal.proposalId).sort((left, right) => left.localeCompare(right))
    });
  }
  const outputDigest = hashContent(outputFiles.map((file) => `${file.filePath}\0${hashContent(file.content)}`).join('\n'));
  const plan: TransactionalCompositionPlan = {
    schemaId: 'atm.compositionPlan.v1',
    specVersion: '0.1.0',
    migration: input.mergePlan.migration,
    planId: `steward-${input.mergePlan.mergePlanId}`,
    baseTree: 'in-memory',
    outputTree: 'in-memory',
    bounded: true,
    selectedRequestIds: blocked ? [] : selectedIds.sort((left, right) => left.localeCompare(right)),
    skippedRequestIds: [],
    blockedRequestIds: blocked ? [...new Set(sorted.map((proposal) => proposal.proposalId))].sort((left, right) => left.localeCompare(right)) : [],
    fileSlices: fileSlices.sort((left, right) => left.filePath.localeCompare(right.filePath)),
    memberAttribution: attribution.sort((left, right) => left.requestId.localeCompare(right.requestId)),
    serializabilityProof: {
      legalSerialOrder: blocked ? [] : selectedIds.sort((left, right) => left.localeCompare(right)),
      // Each file is rendered under every checked proposal order; a differing
      // render blocks the composition, so reaching here means it was stable.
      permutationStable: blocked === null,
      equivalentOutputHash: outputDigest,
      checkedPermutationCount: Math.max(1, checkedPermutationCount)
    },
    rollback: {
      strategy: 'discard-temp-tree',
      tempTreeMutation: false,
      liveWorktreeMutation: false,
      returnedQueueRequestIds: []
    },
    validatorRefs: [...new Set(sorted.flatMap((proposal) => proposal.validators))].sort((left, right) => left.localeCompare(right))
  };
  return {
    plan,
    outputFiles: blocked ? [] : outputFiles.sort((left, right) => left.filePath.localeCompare(right.filePath)),
    blocked
  };
}

/**
 * Compose each proposal against the same immutable source bytes.  Text patches
 * go through the base composer, which resolves every hunk against the base and
 * fails closed on overlap.  JSON-pointer proposals are different: their
 * declared pointers describe disjoint semantic slices, so they are merged as
 * JSON values and fall back to the text route on any hidden mutation.
 */
function composeProposalPatchesAgainstImmutableBase(filePath: string, before: string, proposals: readonly PatchProposal[]): BaseCompositionResult {
  const textRoute = () => composeTextPatchesAgainstBase(filePath, before, proposals);
  const pointers = proposals.map((proposal) => declaredSingleJsonPointer(proposal));
  const useJsonPointerComposition = pointers.every((pointer): pointer is string => pointer !== null)
    && new Set(pointers).size === pointers.length;
  if (!useJsonPointerComposition) return textRoute();

  let baseDocument: unknown;
  try {
    baseDocument = JSON.parse(before);
  } catch {
    return textRoute();
  }
  if (!isJsonObject(baseDocument)) return textRoute();

  const composed = structuredClone(baseDocument) as Record<string, unknown>;
  for (const [index, proposal] of proposals.entries()) {
    const pointer = pointers[index] as string;
    let patched: unknown;
    try {
      patched = JSON.parse(applyUnifiedPatch(before, proposal.patch)) as unknown;
    } catch (error) {
      if (!(error instanceof UnifiedPatchApplicationError) && !(error instanceof SyntaxError)) throw error;
      return textRoute();
    }
    if (!isJsonObject(patched) || !isOnlyDeclaredPointerMutation(baseDocument, patched, pointer)) {
      // A JSON anchor is an authority boundary, never a hint: any hidden
      // mutation falls back to the strict text route and fails closed if stale.
      return textRoute();
    }
    setJsonPointer(composed, pointer, readJsonPointer(patched, pointer));
  }
  return { ok: true, content: `${JSON.stringify(composed, null, 2)}\n`, checkedPermutationCount: 1 };
}

function declaredSingleJsonPointer(proposal: PatchProposal): string | null {
  if (proposal.anchors.length !== 1 || proposal.anchors[0]?.kind !== 'json-pointer') return null;
  const pointer = proposal.anchors[0]?.hint;
  return typeof pointer === 'string' && pointer.startsWith('/') ? pointer : null;
}

function isOnlyDeclaredPointerMutation(before: unknown, after: unknown, pointer: string): boolean {
  const beforeWithoutPointer = structuredClone(before);
  const afterWithoutPointer = structuredClone(after);
  deleteJsonPointer(beforeWithoutPointer, pointer);
  deleteJsonPointer(afterWithoutPointer, pointer);
  return JSON.stringify(beforeWithoutPointer) === JSON.stringify(afterWithoutPointer);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pointerTokens(pointer: string): string[] {
  return pointer.slice(1).split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function readJsonPointer(document: unknown, pointer: string): unknown {
  let current: unknown = document;
  for (const token of pointerTokens(pointer)) {
    if (!isJsonObject(current) || !(token in current)) return undefined;
    current = current[token];
  }
  return structuredClone(current);
}

function setJsonPointer(document: Record<string, unknown>, pointer: string, value: unknown): void {
  const tokens = pointerTokens(pointer);
  let current: Record<string, unknown> = document;
  for (const token of tokens.slice(0, -1)) {
    const next = current[token];
    if (!isJsonObject(next)) current[token] = {};
    current = current[token] as Record<string, unknown>;
  }
  const leaf = tokens.at(-1);
  if (!leaf) throw new Error('JSON pointer must target a property.');
  if (value === undefined) delete current[leaf];
  else current[leaf] = value;
}

function deleteJsonPointer(document: unknown, pointer: string): void {
  if (!isJsonObject(document)) return;
  const tokens = pointerTokens(pointer);
  let current: Record<string, unknown> = document;
  for (const token of tokens.slice(0, -1)) {
    const next = current[token];
    if (!isJsonObject(next)) return;
    current = next;
  }
  const leaf = tokens.at(-1);
  if (leaf) delete current[leaf];
}

export function buildStewardSemanticValidationReceipt(input: {
  readonly plan: TransactionalCompositionPlan;
  readonly outputFiles: readonly FileDescriptor[];
}): StewardSemanticValidationReceipt {
  const digest = digestCandidate(input.plan, input.outputFiles);
  return {
    schemaId: 'atm.stewardSemanticValidationReceipt.v1',
    candidateDigest: digest,
    outputDigest: digest,
    ok: true
  };
}

export function applyTransactionalStewardPlan(input: {
  readonly cwd: string;
  readonly stewardId: string;
  readonly writerRole: 'neutral-steward';
  readonly plan: TransactionalCompositionPlan;
  readonly outputFiles: readonly FileDescriptor[];
  readonly scopeFiles: readonly string[];
  readonly semanticValidation: StewardSemanticValidationReceipt;
  readonly baseHead?: string | null;
  readonly failAfterWrites?: number;
  /**
   * Test seam. `beforePrecheck` runs before the unlocked stale check.
   * `afterPrecheck` runs after that check and temp materialization, before the
   * commit lock. Neither seam skips the commit guard or is a CLI option.
   */
  readonly commitHooks?: {
    readonly beforePrecheck?: () => void;
    readonly afterPrecheck?: () => void;
  };
  /** Directory for the cross-process commit locks. Defaults to `<cwd>/.atm/runtime/steward-commit-locks`. */
  readonly commitLockRoot?: string;
  readonly commitLockWaitMs?: number;
  readonly commitLockPollMs?: number;
  /** Test-only fault injected inside the canonical commit, never a CLI option. */
  readonly commitFault?: StewardCommitFault;
}): TransactionalStewardApplyResult {
  const cwd = path.resolve(input.cwd);
  const outputByPath = new Map(input.outputFiles.map((file) => [normalizePath(file.filePath), file]));
  const scopeSet = new Set(input.scopeFiles.map(normalizePath));
  const fileSlices = [...input.plan.fileSlices].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const blockedReasons: string[] = [];
  const staleReasons: string[] = [];

  if (input.writerRole !== 'neutral-steward') {
    blockedReasons.push('canonical writes require the neutral-steward writer role');
  }
  if (!input.plan.serializabilityProof.permutationStable) {
    blockedReasons.push('serializability proof is not permutation-stable');
  }
  const candidateDigest = digestCandidate(input.plan, input.outputFiles);
  if (input.semanticValidation.ok !== true || input.semanticValidation.candidateDigest !== candidateDigest || input.semanticValidation.outputDigest !== candidateDigest) {
    blockedReasons.push('semantic validation receipt does not authorize the exact composed candidate digest');
  }

  input.commitHooks?.beforePrecheck?.();

  for (const slice of fileSlices) {
    if (!scopeSet.has(normalizePath(slice.filePath))) {
      blockedReasons.push(`declared output is outside steward scope: ${slice.filePath}`);
    }
    const output = outputByPath.get(normalizePath(slice.filePath));
    if (!output) {
      blockedReasons.push(`missing composed output file: ${slice.filePath}`);
      continue;
    }
    if (hashContent(output.content) !== slice.outputHash) {
      blockedReasons.push(`composed output hash mismatch: ${slice.filePath}`);
    }
    const targetPath = resolveInsideRoot(cwd, slice.filePath);
    if (!targetPath) {
      blockedReasons.push(`declared output is outside canonical root: ${slice.filePath}`);
      continue;
    }
    if (!existsSync(targetPath)) {
      blockedReasons.push(`canonical target is missing: ${slice.filePath}`);
      continue;
    }
    const before = readFileSync(targetPath, 'utf8');
    const observed = hashContent(before);
    if (observed !== slice.baseHash) {
      staleReasons.push(`re-compose: canonical target base hash is stale: ${slice.filePath} (expected ${slice.baseHash}, observed ${observed}). Re-read the file and compose again against the current bytes.`);
    }
  }

  if (blockedReasons.length > 0) {
    return {
      ok: false,
      receipt: buildReceipt(input, {
        candidateDigest,
        canonicalRoot: cwd,
        files: [],
        verdict: 'blocked',
        blockedReasons
      })
    };
  }
  if (staleReasons.length > 0) {
    return {
      ok: false,
      receipt: buildReceipt(input, {
        candidateDigest,
        canonicalRoot: cwd,
        files: [],
        verdict: 're-compose',
        blockedReasons: staleReasons
      })
    };
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-apply-'));
  let materializeError: Error | null = null;
  try {
    // Materialize all candidates away from the canonical tree before any side effect.
    for (const slice of fileSlices) {
      const output = outputByPath.get(normalizePath(slice.filePath))!;
      const tempPath = path.join(tempRoot, normalizePath(slice.filePath));
      mkdirSync(path.dirname(tempPath), { recursive: true });
      writeFileSync(tempPath, output.content, 'utf8');
      if (hashContent(readFileSync(tempPath, 'utf8')) !== slice.outputHash) {
        throw new Error(`temporary output hash mismatch: ${slice.filePath}`);
      }
    }
  } catch (error) {
    materializeError = error instanceof Error ? error : new Error(String(error));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  if (materializeError) {
    return {
      ok: false,
      receipt: buildReceipt(input, {
        candidateDigest,
        canonicalRoot: cwd,
        files: [],
        verdict: 'rolled-back',
        blockedReasons: [materializeError.message],
        compensation: {
          restoredFiles: [],
          failedFile: null,
          reason: 'discarded materialized temp outputs before canonical write'
        }
      })
    };
  }

  // The barrier sits outside the commit lock so a peer can finish its own commit first.
  input.commitHooks?.afterPrecheck?.();

  const committed = commitCanonicalFiles({
    entries: fileSlices.map((slice) => ({
      filePath: slice.filePath,
      targetPath: resolveInsideRoot(cwd, slice.filePath)!,
      expectedBaseHash: slice.baseHash,
      content: outputByPath.get(normalizePath(slice.filePath))!.content,
      outputHash: slice.outputHash
    })),
    cwd,
    lockRoot: input.commitLockRoot ?? defaultStewardCommitLockRoot(cwd),
    lockWaitMs: input.commitLockWaitMs,
    lockPollMs: input.commitLockPollMs,
    failAfterWrites: input.failAfterWrites,
    commitFault: input.commitFault
  });
  const files = committed.files.map((file): TransactionalStewardFileReceipt => ({
    filePath: file.filePath,
    beforeHash: file.beforeHash,
    afterHash: file.afterHash,
    canonicalWriteCount: 1,
    tempOutputHash: file.outputHash
  }));
  if (committed.status === 'applied') {
    return {
      ok: true,
      receipt: buildReceipt(input, {
        candidateDigest,
        canonicalRoot: cwd,
        files,
        verdict: 'applied',
        blockedReasons: []
      })
    };
  }
  if (committed.status === 'rolled-back') {
    return {
      ok: false,
      receipt: buildReceipt(input, {
        candidateDigest,
        canonicalRoot: cwd,
        files,
        verdict: 'rolled-back',
        blockedReasons: [committed.reason],
        compensation: {
          restoredFiles: committed.restoredFiles,
          failedFile: committed.failedFile,
          reason: files.length > 0
            ? 'restored canonical files after partial apply failure'
            : 'discarded materialized temp outputs before canonical write'
        }
      })
    };
  }
  return {
    ok: false,
    receipt: buildReceipt(input, {
      candidateDigest,
      canonicalRoot: cwd,
      files: [],
      verdict: committed.status,
      blockedReasons: [committed.reason]
    })
  };
}

function buildReceipt(input: {
  readonly stewardId: string;
  readonly writerRole: 'neutral-steward';
  readonly plan: TransactionalCompositionPlan;
  readonly baseHead?: string | null;
}, details: {
  readonly candidateDigest: string;
  readonly canonicalRoot: string;
  readonly files: readonly TransactionalStewardFileReceipt[];
  readonly verdict: TransactionalStewardApplyReceipt['verdict'];
  readonly blockedReasons: readonly string[];
  readonly compensation?: TransactionalStewardApplyReceipt['compensation'];
}): TransactionalStewardApplyReceipt {
  return {
    schemaId: 'atm.transactionalStewardApplyReceipt.v1',
    specVersion: '0.1.0',
    migration: input.plan.migration,
    stewardId: input.stewardId,
    writerRole: input.writerRole,
    compositionPlanId: input.plan.planId,
    compositionPlanDigest: hashJson(input.plan),
    serializabilityProofDigest: hashJson(input.plan.serializabilityProof),
    candidateDigest: details.candidateDigest,
    canonicalRoot: details.canonicalRoot,
    baseHead: input.baseHead ?? null,
    memberAttribution: input.plan.memberAttribution,
    files: [...details.files].sort((left, right) => left.filePath.localeCompare(right.filePath)),
    verdict: details.verdict,
    blockedReasons: [...details.blockedReasons],
    ...(details.compensation ? { compensation: details.compensation } : {})
  };
}

function digestCandidate(plan: TransactionalCompositionPlan, outputFiles: readonly FileDescriptor[]): string {
  return hashJson({
    planDigest: hashJson(plan),
    outputs: [...outputFiles]
      .map((file) => ({ filePath: normalizePath(file.filePath), contentHash: hashContent(file.content) }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath))
  });
}

function hashJson(value: unknown): string {
  return hashContent(JSON.stringify(value));
}

function hashContent(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}


function extractProposalTransactionIds(proposal: PatchProposal): readonly string[] {
  const values = [
    proposal.transactionId,
    ...(proposal.transactionIds ?? []),
    ...(proposal.transaction_ids ?? [])
  ];
  return values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function resolveInsideRoot(root: string, relativePath: string): string | null {
  const targetPath = path.resolve(root, relativePath);
  const outside = (base: string, target: string): boolean => {
    const relative = path.relative(base, target);
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  };
  if (outside(root, targetPath)) return null;
  // Resolve directory junctions as well as file symlinks before reading or writing.
  // Return the physical target, not the alias checked above. Concurrent directory
  // replacement still requires stronger filesystem isolation, not a lexical gate.
  if (!existsSync(targetPath)) return targetPath;
  try {
    const physicalRoot = realpathSync(root);
    const physicalTarget = realpathSync(targetPath);
    return outside(physicalRoot, physicalTarget) ? null : physicalTarget;
  } catch {
    return null;
  }
}
