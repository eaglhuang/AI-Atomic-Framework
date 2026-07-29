/**
 * Exact ErrorCode constants owned by TASK-ERR-0004. Downstream adapters must
 * re-export these instead of minting parallel string literals.
 */
export const ATM_BROKER_STEWARD_RECEIPT_REQUIRED = 'ATM_BROKER_STEWARD_RECEIPT_REQUIRED';
export const ATM_BROKER_STEWARD_RECEIPT_INVALID = 'ATM_BROKER_STEWARD_RECEIPT_INVALID';
export const SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID = 'atm.sharedWriteProvenanceReceipt.v1';
/** Only a neutral write lane may be the canonical writer of a shared file. */
export const NEUTRAL_STEWARD_ROLES = ['neutral-steward', 'deterministic-composer'];
/**
 * A canonical shared write is defined purely by write-claim cardinality: a file
 * carrying two or more distinct active write claims is shared, regardless of
 * which task, actor, or path is involved (INV-ATM-009).
 */
export const SHARED_WRITE_CLAIM_CARDINALITY_THRESHOLD = 2;
const COMPOSE_COMMAND = 'node atm.mjs broker compose --proposal-file <path> --json';
const STEWARD_COMMAND = 'node atm.mjs broker steward apply --merge-plan-file <path> --evidence-out <path> --json';
/** A file is shared when at least two distinct write claims cover it. */
export function isSharedCanonicalWrite(file) {
    return distinctTaskIds(file.writeClaimTaskIds).length >= SHARED_WRITE_CLAIM_CARDINALITY_THRESHOLD;
}
/**
 * Single pure admission verifier for every shared-write entry point. Adapters
 * only gather local evidence; all policy lives here so the pre-commit hook, the
 * ATM git commit route, and broker shared delivery cannot drift apart.
 */
export function evaluateSharedWriteAdmission(observation) {
    const receipts = [];
    const invalidReceiptReasons = new Map();
    for (const candidate of observation.receipts ?? []) {
        const reasons = receiptStructureReasons(candidate);
        if (reasons.length === 0) {
            receipts.push(candidate);
            continue;
        }
        invalidReceiptReasons.set(receiptLabel(candidate), reasons);
    }
    const sharedFiles = [];
    const admittedFiles = [];
    const findings = [];
    const attributedTaskIds = new Set();
    const consumedReceiptIds = new Set();
    for (const file of observation.files ?? []) {
        if (!isSharedCanonicalWrite(file))
            continue;
        const normalized = file.path;
        sharedFiles.push(normalized);
        const claimTaskIds = distinctTaskIds(file.writeClaimTaskIds);
        const covering = receipts.filter((receipt) => Object.prototype.hasOwnProperty.call(receipt.fileDigests, normalized));
        if (covering.length === 0) {
            const structuralReasons = [...invalidReceiptReasons.values()].flat();
            if (structuralReasons.length > 0) {
                findings.push(invalidFinding(normalized, claimTaskIds, unique(structuralReasons)));
            }
            else {
                findings.push(requiredFinding(normalized, claimTaskIds));
            }
            continue;
        }
        let admitted = null;
        const rejectionReasons = [];
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
        for (const taskId of distinctTaskIds(admitted.memberTaskIds))
            attributedTaskIds.add(taskId);
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
function receiptStructureReasons(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return ['receipt-not-an-object'];
    }
    const receipt = candidate;
    const reasons = [];
    if (receipt.schemaId !== SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID) {
        return [`unsupported-receipt-schema:${String(receipt.schemaId ?? 'missing')}`];
    }
    if (!isNonEmptyText(receipt.receiptId))
        reasons.push('missing-receipt-id');
    if (!isNonEmptyText(receipt.canonicalRoot))
        reasons.push('missing-canonical-root');
    if (!isNonEmptyText(receipt.baseSha))
        reasons.push('missing-base-sha');
    if (!isNonEmptyText(receipt.headSha))
        reasons.push('missing-head-sha');
    if (!isNonEmptyText(receipt.compositionPlanDigest))
        reasons.push('missing-composition-plan-digest');
    if (!isNonEmptyText(receipt.candidateOutputDigest))
        reasons.push('missing-candidate-output-digest');
    if (!isNonEmptyText(receipt.stewardId))
        reasons.push('missing-steward-id');
    if (!isNeutralStewardRole(receipt.stewardRole))
        reasons.push(`caller-shaped-steward-role:${String(receipt.stewardRole ?? 'missing')}`);
    if (!Array.isArray(receipt.memberTaskIds) || distinctTaskIds(receipt.memberTaskIds).length === 0) {
        reasons.push('missing-member-attribution');
    }
    if (!isPlainRecordOfText(receipt.fileDigests))
        reasons.push('missing-file-digests');
    if (receipt.canonicalWriteCount !== 1)
        reasons.push(`canonical-write-count-not-one:${String(receipt.canonicalWriteCount)}`);
    if (!isNonEmptyText(receipt.issuedAt))
        reasons.push('missing-issued-at');
    if (isNonEmptyText(receipt.consumedAt))
        reasons.push('receipt-already-consumed');
    reasons.push(...semanticAuthorizationReasons(receipt));
    return reasons;
}
/** Binding of a structurally valid receipt to one exact staged mutation. */
function receiptBindingReasons(receipt, file, claimTaskIds, observation) {
    const reasons = [];
    if (receipt.canonicalRoot !== observation.canonicalRoot)
        reasons.push('canonical-root-mismatch');
    if (receipt.baseSha !== observation.baseSha)
        reasons.push('base-sha-mismatch');
    if (receipt.headSha !== observation.headSha)
        reasons.push('stale-head-sha');
    if (!isNonEmptyText(file.stagedBlobDigest)) {
        reasons.push(`staged-blob-digest-unreadable:${file.path}`);
    }
    else if (receipt.fileDigests[file.path] !== file.stagedBlobDigest) {
        reasons.push(`file-digest-mismatch:${file.path}`);
    }
    const members = distinctTaskIds(receipt.memberTaskIds);
    const unattributed = claimTaskIds.filter((taskId) => !members.includes(taskId));
    if (unattributed.length > 0)
        reasons.push(`attribution-mismatch:${unattributed.join(',')}`);
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
    if (receipt.semanticBaseHeadSha !== observation.headSha)
        reasons.push('semantic-receipt-base-head-drift');
    return reasons;
}
/** The ATM-GOV-0254 semantic authorization must pass and bind this candidate. */
function semanticAuthorizationReasons(receipt) {
    const authorization = receipt.semanticAuthorization;
    if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
        return ['missing-semantic-validation-receipt'];
    }
    const reasons = [];
    if (authorization.schemaId !== 'atm.stewardSemanticValidationReceipt.v1') {
        return [`unsupported-semantic-receipt-schema:${String(authorization.schemaId ?? 'missing')}`];
    }
    if (authorization.ok !== true)
        reasons.push('semantic-validation-not-authorized');
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
    if (!isNonEmptyText(receipt.semanticBaseHeadSha))
        reasons.push('missing-semantic-base-head');
    if (!isNonEmptyText(receipt.semanticSealedSelectionSourceDigest))
        reasons.push('missing-sealed-validator-selection');
    if (!isNonEmptyText(receipt.semanticRunnerBuildDigest))
        reasons.push('missing-runner-build-digest');
    return reasons;
}
function requiredFinding(file, writeClaimTaskIds) {
    return {
        code: ATM_BROKER_STEWARD_RECEIPT_REQUIRED,
        file,
        writeClaimTaskIds,
        reasons: ['no-consumed-steward-receipt'],
        detail: `Shared canonical write ${file} is covered by ${writeClaimTaskIds.length} active write claims (${writeClaimTaskIds.join(', ')}) but no consumed steward receipt binds its blob digest. Route the change through broker composition and neutral-steward delivery.`,
        requiredCommand: COMPOSE_COMMAND
    };
}
function invalidFinding(file, writeClaimTaskIds, reasons) {
    return {
        code: ATM_BROKER_STEWARD_RECEIPT_INVALID,
        file,
        writeClaimTaskIds,
        reasons,
        detail: `A steward receipt was presented for shared canonical write ${file} but it is not trustworthy (${reasons.join('; ')}). Re-run steward delivery to obtain a receipt bound to the current base/HEAD and exact composed output.`,
        requiredCommand: STEWARD_COMMAND
    };
}
function receiptLabel(candidate) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        const receiptId = candidate.receiptId;
        if (isNonEmptyText(receiptId))
            return receiptId;
    }
    return `unlabeled-${Math.abs(hashText(JSON.stringify(candidate ?? null)))}`;
}
function hashText(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return hash;
}
function isNeutralStewardRole(value) {
    return typeof value === 'string' && NEUTRAL_STEWARD_ROLES.includes(value);
}
function isNonEmptyText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isPlainRecordOfText(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const entries = Object.entries(value);
    if (entries.length === 0)
        return false;
    return entries.every(([key, entry]) => key.trim().length > 0 && isNonEmptyText(entry));
}
function distinctTaskIds(values) {
    if (!Array.isArray(values))
        return [];
    return unique(values.filter(isNonEmptyText).map((value) => value.trim()));
}
function unique(values) {
    return [...new Set(values)].sort();
}
