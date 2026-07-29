import type { StewardSemanticAuthorizationReceipt } from './post-compose-semantic-validation-policy.ts';

/**
 * Exact ErrorCode constants owned by TASK-ERR-0004. Downstream adapters must
 * re-export these instead of minting parallel string literals.
 */
export const ATM_BROKER_STEWARD_RECEIPT_REQUIRED = 'ATM_BROKER_STEWARD_RECEIPT_REQUIRED' as const;
export const ATM_BROKER_STEWARD_RECEIPT_INVALID = 'ATM_BROKER_STEWARD_RECEIPT_INVALID' as const;

export type SharedWriteAdmissionCode =
  | typeof ATM_BROKER_STEWARD_RECEIPT_REQUIRED
  | typeof ATM_BROKER_STEWARD_RECEIPT_INVALID;

export const SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID = 'atm.sharedWriteProvenanceReceipt.v1' as const;

/** Only a neutral write lane may be the canonical writer of a shared file. */
export const NEUTRAL_STEWARD_ROLES = ['neutral-steward', 'deterministic-composer'] as const;
export type NeutralStewardRole = (typeof NEUTRAL_STEWARD_ROLES)[number];

/**
 * A canonical shared write is defined purely by write-claim cardinality: a file
 * carrying two or more distinct active write claims is shared, regardless of
 * which task, actor, or path is involved (INV-ATM-009).
 */
export const SHARED_WRITE_CLAIM_CARDINALITY_THRESHOLD = 2;

export interface SharedWriteProvenanceReceipt {
  readonly schemaId: typeof SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID;
  readonly receiptId: string;
  readonly canonicalRoot: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly compositionPlanDigest: string;
  readonly candidateOutputDigest: string;
  readonly serializabilityProofDigest: string | null;
  readonly stewardId: string;
  readonly stewardRole: NeutralStewardRole;
  readonly memberTaskIds: readonly string[];
  /** normalized repo-relative path -> exact blob digest of the steward output. */
  readonly fileDigests: Readonly<Record<string, string>>;
  readonly canonicalWriteCount: number;
  readonly semanticAuthorization: StewardSemanticAuthorizationReceipt;
  readonly semanticBaseHeadSha: string;
  readonly semanticSealedSelectionSourceDigest: string;
  readonly semanticRunnerBuildDigest: string;
  readonly issuedAt: string;
  readonly consumedAt?: string | null;
}

export interface SharedWriteObservedFile {
  readonly path: string;
  readonly writeClaimTaskIds: readonly string[];
  /** Exact digest of the bytes about to be committed; null when unreadable. */
  readonly stagedBlobDigest: string | null;
}

export interface SharedWriteAdmissionObservation {
  readonly canonicalRoot: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly committingTaskId?: string | null;
  readonly files: readonly SharedWriteObservedFile[];
  /** Raw, still-untrusted receipt evidence gathered by the local adapter. */
  readonly receipts: readonly unknown[];
  readonly expectedCompositionPlanDigest?: string | null;
  readonly expectedSealedSelectionSourceDigest?: string | null;
  readonly expectedRunnerBuildDigest?: string | null;
}

export interface SharedWriteAdmissionFinding {
  readonly code: SharedWriteAdmissionCode;
  readonly file: string;
  readonly writeClaimTaskIds: readonly string[];
  readonly reasons: readonly string[];
  readonly detail: string;
  readonly requiredCommand: string;
}

export interface SharedWriteAdmissionDecision {
  readonly schemaId: 'atm.sharedWriteAdmissionDecision.v1';
  readonly ok: boolean;
  readonly verdict: 'admit' | 'blocked';
  readonly sharedFiles: readonly string[];
  readonly admittedFiles: readonly string[];
  readonly findings: readonly SharedWriteAdmissionFinding[];
  /** Attribution is derived from validated receipts only, never from callers. */
  readonly attributedTaskIds: readonly string[];
  readonly consumedReceiptIds: readonly string[];
}

const COMPOSE_COMMAND = 'node atm.mjs broker compose --proposal-file <path> --json';
const STEWARD_COMMAND = 'node atm.mjs broker steward apply --merge-plan-file <path> --evidence-out <path> --json';

/** A file is shared when at least two distinct write claims cover it. */
export function isSharedCanonicalWrite(file: SharedWriteObservedFile): boolean {
  return distinctTaskIds(file.writeClaimTaskIds).length >= SHARED_WRITE_CLAIM_CARDINALITY_THRESHOLD;
}

/**
 * Single pure admission verifier for every shared-write entry point. Adapters
 * only gather local evidence; all policy lives here so the pre-commit hook, the
 * ATM git commit route, and broker shared delivery cannot drift apart.
 */
export function evaluateSharedWriteAdmission(
  observation: SharedWriteAdmissionObservation
): SharedWriteAdmissionDecision {
  const receipts: SharedWriteProvenanceReceipt[] = [];
  const invalidReceiptReasons = new Map<string, readonly string[]>();
  for (const candidate of observation.receipts ?? []) {
    const reasons = receiptStructureReasons(candidate);
    if (reasons.length === 0) {
      receipts.push(candidate as SharedWriteProvenanceReceipt);
      continue;
    }
    invalidReceiptReasons.set(receiptLabel(candidate), reasons);
  }

  const sharedFiles: string[] = [];
  const admittedFiles: string[] = [];
  const findings: SharedWriteAdmissionFinding[] = [];
  const attributedTaskIds = new Set<string>();
  const consumedReceiptIds = new Set<string>();

  for (const file of observation.files ?? []) {
    if (!isSharedCanonicalWrite(file)) continue;
    const normalized = file.path;
    sharedFiles.push(normalized);
    const claimTaskIds = distinctTaskIds(file.writeClaimTaskIds);
    const covering = receipts.filter((receipt) => Object.prototype.hasOwnProperty.call(receipt.fileDigests, normalized));

    if (covering.length === 0) {
      const structuralReasons = [...invalidReceiptReasons.values()].flat();
      if (structuralReasons.length > 0) {
        findings.push(invalidFinding(normalized, claimTaskIds, unique(structuralReasons)));
      } else {
        findings.push(requiredFinding(normalized, claimTaskIds));
      }
      continue;
    }

    let admitted: SharedWriteProvenanceReceipt | null = null;
    const rejectionReasons: string[] = [];
    for (const receipt of covering) {
      const reasons = receiptBindingReasons(receipt, file, claimTaskIds, observation);
      if (reasons.length === 0) {
        admitted = receipt;
        break;
      }
      rejectionReasons.push(...reasons);
    }

    if (!admitted) {
      findings.push(invalidFinding(normalized, claimTaskIds, unique(rejectionReasons)));
      continue;
    }
    admittedFiles.push(normalized);
    consumedReceiptIds.add(admitted.receiptId);
    for (const taskId of distinctTaskIds(admitted.memberTaskIds)) attributedTaskIds.add(taskId);
  }

  return {
    schemaId: 'atm.sharedWriteAdmissionDecision.v1',
    ok: findings.length === 0,
    verdict: findings.length === 0 ? 'admit' : 'blocked',
    sharedFiles: unique(sharedFiles),
    admittedFiles: unique(admittedFiles),
    findings,
    attributedTaskIds: [...attributedTaskIds].sort(),
    consumedReceiptIds: [...consumedReceiptIds].sort()
  };
}

/** Structural validity of a receipt envelope, independent of any single file. */
function receiptStructureReasons(candidate: unknown): string[] {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return ['receipt-not-an-object'];
  }
  const receipt = candidate as Partial<SharedWriteProvenanceReceipt>;
  const reasons: string[] = [];
  if (receipt.schemaId !== SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID) {
    return [`unsupported-receipt-schema:${String(receipt.schemaId ?? 'missing')}`];
  }
  if (!isNonEmptyText(receipt.receiptId)) reasons.push('missing-receipt-id');
  if (!isNonEmptyText(receipt.canonicalRoot)) reasons.push('missing-canonical-root');
  if (!isNonEmptyText(receipt.baseSha)) reasons.push('missing-base-sha');
  if (!isNonEmptyText(receipt.headSha)) reasons.push('missing-head-sha');
  if (!isNonEmptyText(receipt.compositionPlanDigest)) reasons.push('missing-composition-plan-digest');
  if (!isNonEmptyText(receipt.candidateOutputDigest)) reasons.push('missing-candidate-output-digest');
  if (!isNonEmptyText(receipt.stewardId)) reasons.push('missing-steward-id');
  if (!isNeutralStewardRole(receipt.stewardRole)) reasons.push(`caller-shaped-steward-role:${String(receipt.stewardRole ?? 'missing')}`);
  if (!Array.isArray(receipt.memberTaskIds) || distinctTaskIds(receipt.memberTaskIds).length === 0) {
    reasons.push('missing-member-attribution');
  }
  if (!isPlainRecordOfText(receipt.fileDigests)) reasons.push('missing-file-digests');
  if (receipt.canonicalWriteCount !== 1) reasons.push(`canonical-write-count-not-one:${String(receipt.canonicalWriteCount)}`);
  if (!isNonEmptyText(receipt.issuedAt)) reasons.push('missing-issued-at');
  if (isNonEmptyText(receipt.consumedAt)) reasons.push('receipt-already-consumed');
  reasons.push(...semanticAuthorizationReasons(receipt));
  return reasons;
}

/** Binding of a structurally valid receipt to one exact staged mutation. */
function receiptBindingReasons(
  receipt: SharedWriteProvenanceReceipt,
  file: SharedWriteObservedFile,
  claimTaskIds: readonly string[],
  observation: SharedWriteAdmissionObservation
): string[] {
  const reasons: string[] = [];
  if (receipt.canonicalRoot !== observation.canonicalRoot) reasons.push('canonical-root-mismatch');
  if (receipt.baseSha !== observation.baseSha) reasons.push('base-sha-mismatch');
  if (receipt.headSha !== observation.headSha) reasons.push('stale-head-sha');
  if (!isNonEmptyText(file.stagedBlobDigest)) {
    reasons.push(`staged-blob-digest-unreadable:${file.path}`);
  } else if (receipt.fileDigests[file.path] !== file.stagedBlobDigest) {
    reasons.push(`file-digest-mismatch:${file.path}`);
  }
  const members = distinctTaskIds(receipt.memberTaskIds);
  const unattributed = claimTaskIds.filter((taskId) => !members.includes(taskId));
  if (unattributed.length > 0) reasons.push(`attribution-mismatch:${unattributed.join(',')}`);
  if (isNonEmptyText(observation.expectedCompositionPlanDigest)
    && receipt.compositionPlanDigest !== observation.expectedCompositionPlanDigest) {
    reasons.push('composition-plan-digest-mismatch');
  }
  if (isNonEmptyText(observation.expectedSealedSelectionSourceDigest)
    && receipt.semanticSealedSelectionSourceDigest !== observation.expectedSealedSelectionSourceDigest) {
    reasons.push('sealed-validator-selection-drift');
  }
  if (isNonEmptyText(observation.expectedRunnerBuildDigest)
    && receipt.semanticRunnerBuildDigest !== observation.expectedRunnerBuildDigest) {
    reasons.push('runner-build-digest-drift');
  }
  if (receipt.semanticBaseHeadSha !== observation.headSha) reasons.push('semantic-receipt-base-head-drift');
  return reasons;
}

/** The ATM-GOV-0254 semantic authorization must pass and bind this candidate. */
function semanticAuthorizationReasons(receipt: Partial<SharedWriteProvenanceReceipt>): string[] {
  const authorization = receipt.semanticAuthorization;
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return ['missing-semantic-validation-receipt'];
  }
  const reasons: string[] = [];
  if (authorization.schemaId !== 'atm.stewardSemanticValidationReceipt.v1') {
    return [`unsupported-semantic-receipt-schema:${String(authorization.schemaId ?? 'missing')}`];
  }
  if (authorization.ok !== true) reasons.push('semantic-validation-not-authorized');
  if (authorization.decisionVerdict !== 'pass') {
    reasons.push(`semantic-validation-verdict:${String(authorization.decisionVerdict ?? 'missing')}`);
  }
  if (!isNonEmptyText(receipt.compositionPlanDigest)
    || authorization.candidateDigest !== receipt.compositionPlanDigest) {
    reasons.push('semantic-candidate-digest-mismatch');
  }
  if (!isNonEmptyText(receipt.candidateOutputDigest)
    || authorization.outputDigest !== receipt.candidateOutputDigest) {
    reasons.push('semantic-output-digest-mismatch');
  }
  if (!isNonEmptyText(receipt.semanticBaseHeadSha)) reasons.push('missing-semantic-base-head');
  if (!isNonEmptyText(receipt.semanticSealedSelectionSourceDigest)) reasons.push('missing-sealed-validator-selection');
  if (!isNonEmptyText(receipt.semanticRunnerBuildDigest)) reasons.push('missing-runner-build-digest');
  return reasons;
}

function requiredFinding(file: string, writeClaimTaskIds: readonly string[]): SharedWriteAdmissionFinding {
  return {
    code: ATM_BROKER_STEWARD_RECEIPT_REQUIRED,
    file,
    writeClaimTaskIds,
    reasons: ['no-consumed-steward-receipt'],
    detail: `Shared canonical write ${file} is covered by ${writeClaimTaskIds.length} active write claims (${writeClaimTaskIds.join(', ')}) but no consumed steward receipt binds its blob digest. Route the change through broker composition and neutral-steward delivery.`,
    requiredCommand: COMPOSE_COMMAND
  };
}

function invalidFinding(
  file: string,
  writeClaimTaskIds: readonly string[],
  reasons: readonly string[]
): SharedWriteAdmissionFinding {
  return {
    code: ATM_BROKER_STEWARD_RECEIPT_INVALID,
    file,
    writeClaimTaskIds,
    reasons,
    detail: `A steward receipt was presented for shared canonical write ${file} but it is not trustworthy (${reasons.join('; ')}). Re-run steward delivery to obtain a receipt bound to the current base/HEAD and exact composed output.`,
    requiredCommand: STEWARD_COMMAND
  };
}

function receiptLabel(candidate: unknown): string {
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const receiptId = (candidate as { receiptId?: unknown }).receiptId;
    if (isNonEmptyText(receiptId)) return receiptId;
  }
  return `unlabeled-${Math.abs(hashText(JSON.stringify(candidate ?? null)))}`;
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function isNeutralStewardRole(value: unknown): value is NeutralStewardRole {
  return typeof value === 'string' && (NEUTRAL_STEWARD_ROLES as readonly string[]).includes(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainRecordOfText(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(([key, entry]) => key.trim().length > 0 && isNonEmptyText(entry));
}

function distinctTaskIds(values: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return unique(values.filter(isNonEmptyText).map((value) => value.trim()));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
