import { type RunnerInputGraph, type RunnerSyncErrorCode } from './runner-version-contract.js';
/**
 * Runner-sync session: the durable, coalescing-aware lifecycle owner
 * (ATM-GOV-0266 Phase A deep module).
 *
 * Deletion test: without this module, coalesced-group attribution, per-member
 * child receipts, the durable `prepared -> built-provisional ->
 * publication-ready -> published` (with `reconciled`/`abandoned` recovery)
 * state machine, legacy build-lease recovery, and seal
 * revalidation must reappear scattered across `runner-sync-steward-queue.ts`
 * (coalescing), `runner-sync-incremental-build.ts` (single-task receipt), and
 * `runner-publication-lifecycle.ts` (single-task phase machine) — exactly the
 * three-way duplicated policy that let a head-owner-only receipt release a
 * three-member group with no member attribution.
 *
 * The module is pure. The caller supplies the current session snapshot and a
 * small `SessionPorts` capability (clock only) and executes the returned next
 * action; nothing here performs IO.
 */
export declare const RUNNER_SYNC_SESSION_STATE_SCHEMA: "atm.runnerSyncSessionState.v1";
export declare const RUNNER_SYNC_GROUP_MANIFEST_SCHEMA: "atm.runnerSyncCoalescedGroupManifest.v1";
export declare const RUNNER_SYNC_CHILD_RECEIPT_SCHEMA: "atm.runnerSyncChildReceipt.v1";
/**
 * Durable coalesced-session lifecycle. A recorded build is *provisional*: the
 * group manifest and per-member child receipts are retained through every phase
 * until the session is released (`published`) or reconciled. No transition erases
 * group state before release/reconcile.
 *
 *   prepared -> built-provisional -> publication-ready -> published
 *                   \                                  |
 *                    -> abandoned (seal drift)     reconciled (recovered)
 *
 * `prepared` deliberately holds no shared queue/build lease. It represents
 * private compilation and staging; only the later publication transaction may
 * acquire a shared lease.
 */
export type RunnerSyncSessionPhase = 'prepared' | 'queued' | 'building' | 'built-provisional' | 'publication-ready' | 'published' | 'reconciled' | 'abandoned';
export interface SessionPorts {
    readonly now: () => string;
}
/** A coalesced member as declared at enqueue time. */
export interface RunnerSyncMemberRequest {
    readonly taskId: string;
    readonly actorId: string;
    readonly laneSessionId: string | null;
    readonly requestedSurfaces: readonly string[];
}
export interface CoalescedGroupMember {
    readonly taskId: string;
    readonly actorId: string;
    readonly laneFingerprint: string | null;
    readonly requestedSurfaces: readonly string[];
    /** Digest binding this member's request to the group. */
    readonly requestDigest: string;
}
export interface CoalescedGroupManifest {
    readonly schemaId: typeof RUNNER_SYNC_GROUP_MANIFEST_SCHEMA;
    readonly stewardWorkId: string;
    readonly sealedSourceSha: string;
    readonly members: readonly CoalescedGroupMember[];
    /** Every coalesced member task id, sorted; the attribution key. */
    readonly memberTaskIds: readonly string[];
    /** Shared sealed input digest (aggregate input tree hash of the build). */
    readonly sharedSealedInputDigest: string;
    /** Shared output digest, filled once the build is recorded. */
    readonly sharedOutputDigest: string | null;
    readonly manifestDigest: string;
    readonly createdAt: string;
}
export interface ChildReceipt {
    readonly schemaId: typeof RUNNER_SYNC_CHILD_RECEIPT_SCHEMA;
    readonly taskId: string;
    readonly parentStewardWorkId: string;
    readonly groupManifestDigest: string;
    readonly memberRequestDigest: string;
    readonly sealedSourceSha: string;
    readonly sharedSealedInputDigest: string;
    readonly sharedOutputDigest: string;
    readonly receiptDigest: string;
    readonly issuedAt: string;
}
export interface BuildLease {
    readonly leaseId: string;
    readonly heartbeatAt: string;
    readonly expiresAt: string;
    readonly ttlSeconds: number;
}
export interface RunnerSyncSessionState {
    readonly schemaId: typeof RUNNER_SYNC_SESSION_STATE_SCHEMA;
    readonly specVersion: '0.1.0';
    readonly phase: RunnerSyncSessionPhase;
    readonly stewardWorkId: string;
    readonly sealedSourceSha: string;
    readonly groupManifest: CoalescedGroupManifest;
    readonly buildLease: BuildLease | null;
    readonly childReceipts: readonly ChildReceipt[];
    readonly inputGraph: RunnerInputGraph | null;
    readonly updatedAt: string;
}
export type SessionAction = 'prepare' | 'build' | 'renew-lease' | 'publish-receipts' | 'attest-publication' | 'release' | 'resume-build' | 'revalidate-seal' | 'complete' | 'wait';
export interface RunnerSyncSessionDecision {
    readonly schemaId: 'atm.runnerSyncSessionDecision.v1';
    readonly action: SessionAction;
    readonly allowed: boolean;
    readonly errorCode: RunnerSyncErrorCode | null;
    readonly state: RunnerSyncSessionState;
    /** Present when this transition publishes/attributes per-member child receipts. */
    readonly childReceipts: readonly ChildReceipt[];
    readonly recoveryCommand: string | null;
    readonly reason: string;
}
export interface StartSessionRequest {
    readonly stewardWorkId: string;
    readonly sealedSourceSha: string;
    readonly members: readonly RunnerSyncMemberRequest[];
    readonly sharedSealedInputDigest: string;
    readonly buildLeaseTtlSeconds?: number;
}
export interface BuildResult {
    readonly sharedOutputDigest: string;
    readonly inputGraph: RunnerInputGraph;
}
export interface SealObservation {
    readonly currentHead: string;
    /** Paths changed between the sealed source and current HEAD. */
    readonly headDeltaPaths: readonly string[];
}
/**
 * Start a runner-sync session from a coalesced candidate. Builds the group
 * manifest with full member attribution and enters `prepared` without a shared
 * lease. Private build work must not reserve the publication queue. Fails
 * closed if no members are declared.
 */
export declare function startRunnerSyncSession(request: StartSessionRequest, ports: SessionPorts): RunnerSyncSessionDecision;
/**
 * Renew the build lease during a long build. If the lease already expired,
 * fail closed with `ATM_RUNNER_SYNC_STEWARD_LEASE_EXPIRED` and return a resume
 * path rather than silently dropping the reservation.
 */
export declare function renewRunnerSyncSession(session: RunnerSyncSessionState, ports: SessionPorts): RunnerSyncSessionDecision;
/**
 * Record a completed build. Fills the shared output digest, attaches the input
 * graph, generates one attributable child receipt per member, and advances to
 * `built-provisional`. The build output and child receipts are provisional: they
 * are retained (never erased) until the session is released or reconciled. Fails
 * closed if the manifest has no members.
 */
export declare function recordRunnerSyncBuild(session: RunnerSyncSessionState, buildResult: BuildResult, ports: SessionPorts): RunnerSyncSessionDecision;
/**
 * Attest that a provisional build carries one child receipt per member and
 * advance to `publication-ready`. Fails closed (attribution missing) and stays
 * `built-provisional` — never erasing group state — when attribution is
 * incomplete.
 */
export declare function attestRunnerSyncPublication(session: RunnerSyncSessionState, ports: SessionPorts): RunnerSyncSessionDecision;
/**
 * Finalize publication and release the session. Accepts a `built-provisional` or
 * `publication-ready` session, requires one child receipt per member (else fail
 * closed on missing attribution, provisional retained) and seal continuity
 * against the current HEAD (else abandon and rebuild). Only then advances to
 * `published`.
 */
export declare function finalizeRunnerSyncPublication(session: RunnerSyncSessionState, observation: SealObservation, ports: SessionPorts): RunnerSyncSessionDecision;
/**
 * Reconcile a session recovered from durable state (e.g. after a steward crash
 * or timeout). A `building` session with an expired/absent lease resumes to a
 * fresh build (`ATM_RUNNER_SYNC_RESUME_REQUIRED`); a provisional/publication-ready
 * session re-drives publication (reaching `reconciled` on success, or `abandoned`
 * on seal drift); an `abandoned` session resumes to rebuild; terminal states are
 * idempotent no-ops. Reconciliation never erases the retained group manifest or
 * child receipts.
 */
export declare function reconcileRunnerSyncSession(session: RunnerSyncSessionState, observation: SealObservation, ports: SessionPorts): RunnerSyncSessionDecision;
export interface MemberAttributionResult {
    readonly complete: boolean;
    readonly missing: readonly string[];
}
/** Every manifest member must have exactly one matching child receipt. */
export declare function verifyMemberAttribution(session: RunnerSyncSessionState): MemberAttributionResult;
