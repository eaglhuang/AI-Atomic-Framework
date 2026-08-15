/**
 * Shared-delivery commit transaction ordering.
 *
 * The broker used to assemble a tree, create a commit object and move `HEAD`,
 * and only afterwards ask whether the shared-delivery plan was admissible. A
 * rejected plan therefore reported `ok: false` while the ref had already
 * advanced — the caller was told the write did not happen, and it had.
 *
 * This module owns the correct order for the commit surface:
 *
 *   1. plan and admit against the pre-apply HEAD;
 *   2. only if admitted, seal the payload and build the candidate tree;
 *   3. prove the candidate equals the seal;
 *   4. move the ref;
 *   5. re-derive the receipt from the tree that actually landed.
 *
 * Steps 1 to 3 have no ref side effect, so any rejection leaves HEAD where it
 * was. The wait/retry decision for a moved HEAD stays with the broker queue —
 * this module only reports the CAS mismatch rather than forcing past it.
 */
import { type SharedDeliveryCommitInput, type SharedDeliveryCommitPlan } from '../../../../core/src/broker/shared-delivery-commit.ts';
import { assertCommitAttribution } from '../git-governance/implementation/sealed-commit-attribution.ts';
import { assertRecordCommitPayloadPresent } from '../git-governance/record-commit-payload-assertion.ts';
export declare const ATM_BROKER_BATCH_COMMIT_BLOCKED: "ATM_BROKER_BATCH_COMMIT_BLOCKED";
export declare const ATM_BROKER_BATCH_COMMIT_HEAD_MOVED: "ATM_BROKER_BATCH_COMMIT_HEAD_MOVED";
export interface SharedDeliveryApplyOutcome {
    readonly commitSha: string;
    readonly committedFiles: readonly string[];
    readonly attributionProof: ReturnType<typeof assertCommitAttribution>;
    readonly payloadAssertion: ReturnType<typeof assertRecordCommitPayloadPresent>;
}
/**
 * Assemble, prove, then move the ref. `commit-tree` writes an object but does
 * not publish it; `update-ref` is the only step with an observable effect, and
 * it runs last and with a compare-and-swap against the expected HEAD.
 */
export declare function applySealedSharedDeliveryCommit(input: {
    readonly cwd: string;
    readonly actorId: string;
    readonly taskIds: readonly string[];
    readonly expectedHeadSha: string;
    readonly files: readonly string[];
}): SharedDeliveryApplyOutcome;
export interface SharedDeliveryCommitTransaction {
    readonly plan: SharedDeliveryCommitPlan;
    readonly applied: SharedDeliveryApplyOutcome | null;
    readonly admissionPlan: SharedDeliveryCommitPlan;
    readonly headMoved: boolean;
}
/**
 * Admission first, side effect second. `planInput` describes the transaction
 * as it would land; the pre-apply pass runs it with no commit sha so a
 * rejection is observed before any object or ref is written.
 */
export declare function runSharedDeliveryCommitTransaction(input: {
    readonly cwd: string;
    readonly apply: boolean;
    readonly actorId: string;
    readonly taskIds: readonly string[];
    readonly expectedHeadSha: string;
    readonly payloadFiles: readonly string[];
    readonly planInput: Omit<SharedDeliveryCommitInput, 'commitSha' | 'committedFiles'>;
}): SharedDeliveryCommitTransaction;
