import { createHash } from 'node:crypto';
import {
  evaluateSealContinuity,
  RUNNER_SYNC_ERROR_CODES,
  sortedUnique,
  type RunnerInputGraph,
  type RunnerSyncErrorCode
} from './runner-version-contract.ts';

/**
 * Runner-sync session: the durable, coalescing-aware lifecycle owner
 * (ATM-GOV-0266 Phase A deep module).
 *
 * Deletion test: without this module, coalesced-group attribution, per-member
 * child receipts, the durable `queued -> building -> built-provisional ->
 * publication-ready -> published` (with `reconciled`/`abandoned` recovery)
 * state machine, build-lease heartbeat, and seal
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

export const RUNNER_SYNC_SESSION_STATE_SCHEMA = 'atm.runnerSyncSessionState.v1' as const;
export const RUNNER_SYNC_GROUP_MANIFEST_SCHEMA = 'atm.runnerSyncCoalescedGroupManifest.v1' as const;
export const RUNNER_SYNC_CHILD_RECEIPT_SCHEMA = 'atm.runnerSyncChildReceipt.v1' as const;

/**
 * Durable coalesced-session lifecycle. A recorded build is *provisional*: the
 * group manifest and per-member child receipts are retained through every phase
 * until the session is released (`published`) or reconciled. No transition erases
 * group state before release/reconcile.
 *
 *   queued -> building -> built-provisional -> publication-ready -> published
 *                                    \                                  |
 *                                     -> abandoned (seal drift)     reconciled (recovered)
 */
export type RunnerSyncSessionPhase =
  | 'queued'
  | 'building'
  | 'built-provisional'
  | 'publication-ready'
  | 'published'
  | 'reconciled'
  | 'abandoned';

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

export type SessionAction =
  | 'build'
  | 'renew-lease'
  | 'publish-receipts'
  | 'attest-publication'
  | 'release'
  | 'resume-build'
  | 'revalidate-seal'
  | 'complete'
  | 'wait';

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

const DEFAULT_BUILD_LEASE_TTL_SECONDS = 3600;

/**
 * Start a runner-sync session from a coalesced enqueue. Builds the group
 * manifest with full member attribution and enters `building` with a fresh
 * build lease. Fails closed if no members are declared.
 */
export function startRunnerSyncSession(
  request: StartSessionRequest,
  ports: SessionPorts
): RunnerSyncSessionDecision {
  const now = ports.now();
  const members = normalizeMembers(request.members, request.stewardWorkId, request.sealedSourceSha);
  if (members.length === 0) {
    const emptyManifest = buildManifest(request.stewardWorkId, request.sealedSourceSha, [], request.sharedSealedInputDigest, null, now);
    return decide('wait', false, RUNNER_SYNC_ERROR_CODES.coalescedAttributionMissing, {
      schemaId: RUNNER_SYNC_SESSION_STATE_SCHEMA,
      specVersion: '0.1.0',
      phase: 'queued',
      stewardWorkId: request.stewardWorkId,
      sealedSourceSha: request.sealedSourceSha,
      groupManifest: emptyManifest,
      buildLease: null,
      childReceipts: [],
      inputGraph: null,
      updatedAt: now
    }, [], null, 'A runner-sync session requires at least one attributable coalesced member.');
  }
  const manifest = buildManifest(request.stewardWorkId, request.sealedSourceSha, members, request.sharedSealedInputDigest, null, now);
  const ttl = request.buildLeaseTtlSeconds && request.buildLeaseTtlSeconds > 0 ? Math.trunc(request.buildLeaseTtlSeconds) : DEFAULT_BUILD_LEASE_TTL_SECONDS;
  const state: RunnerSyncSessionState = {
    schemaId: RUNNER_SYNC_SESSION_STATE_SCHEMA,
    specVersion: '0.1.0',
    phase: 'building',
    stewardWorkId: request.stewardWorkId,
    sealedSourceSha: request.sealedSourceSha,
    groupManifest: manifest,
    buildLease: newLease(now, ttl),
    childReceipts: [],
    inputGraph: null,
    updatedAt: now
  };
  return decide('build', true, null, state, [], null,
    `Session started for ${manifest.memberTaskIds.length} coalesced member(s); run one build for ${request.sealedSourceSha} then record it.`);
}

/**
 * Renew the build lease during a long build. If the lease already expired,
 * fail closed with `ATM_RUNNER_SYNC_STEWARD_LEASE_EXPIRED` and return a resume
 * path rather than silently dropping the reservation.
 */
export function renewRunnerSyncSession(
  session: RunnerSyncSessionState,
  ports: SessionPorts
): RunnerSyncSessionDecision {
  const now = ports.now();
  if (session.phase !== 'building') {
    return decide('wait', false, null, touch(session, now), [], null, `Lease renewal only applies while building; session is ${session.phase}.`);
  }
  if (!session.buildLease) {
    return decide('resume-build', false, RUNNER_SYNC_ERROR_CODES.resumeRequired, touch(session, now), [], resumeCommand(session),
      'Session is building with no build lease; resume the build to re-establish a lease.');
  }
  if (leaseExpired(session.buildLease, now)) {
    return decide('resume-build', false, RUNNER_SYNC_ERROR_CODES.stewardLeaseExpired, touch(session, now), [], resumeCommand(session),
      `Build lease ${session.buildLease.leaseId} expired at ${session.buildLease.expiresAt}; resume the build (state preserved) instead of re-enqueueing.`);
  }
  const ttl = session.buildLease.ttlSeconds;
  const renewed: RunnerSyncSessionState = { ...session, buildLease: newLease(now, ttl), updatedAt: now };
  return decide('renew-lease', true, null, renewed, [], null, `Build lease renewed until ${renewed.buildLease?.expiresAt}.`);
}

/**
 * Record a completed build. Fills the shared output digest, attaches the input
 * graph, generates one attributable child receipt per member, and advances to
 * `built-provisional`. The build output and child receipts are provisional: they
 * are retained (never erased) until the session is released or reconciled. Fails
 * closed if the manifest has no members.
 */
export function recordRunnerSyncBuild(
  session: RunnerSyncSessionState,
  buildResult: BuildResult,
  ports: SessionPorts
): RunnerSyncSessionDecision {
  const now = ports.now();
  if (session.phase !== 'building') {
    return decide('wait', false, null, touch(session, now), [], null, `A build can only be recorded while building; session is ${session.phase}.`);
  }
  if (session.groupManifest.members.length === 0) {
    return decide('wait', false, RUNNER_SYNC_ERROR_CODES.coalescedAttributionMissing, touch(session, now), [], null,
      'Cannot record a build for a group manifest with no attributable members.');
  }
  const manifest: CoalescedGroupManifest = rehashManifest({ ...session.groupManifest, sharedOutputDigest: buildResult.sharedOutputDigest });
  const childReceipts = manifest.members.map((member) => buildChildReceipt(manifest, member, buildResult.sharedOutputDigest, now));
  const state: RunnerSyncSessionState = {
    ...session,
    phase: 'built-provisional',
    groupManifest: manifest,
    childReceipts,
    inputGraph: buildResult.inputGraph,
    updatedAt: now
  };
  return decide('publish-receipts', true, null, state, childReceipts, null,
    `Build recorded provisionally; generated ${childReceipts.length} attributable child receipt(s). Attest attribution and finalize against current HEAD before releasing.`);
}

/**
 * Attest that a provisional build carries one child receipt per member and
 * advance to `publication-ready`. Fails closed (attribution missing) and stays
 * `built-provisional` — never erasing group state — when attribution is
 * incomplete.
 */
export function attestRunnerSyncPublication(
  session: RunnerSyncSessionState,
  ports: SessionPorts
): RunnerSyncSessionDecision {
  const now = ports.now();
  if (session.phase !== 'built-provisional' && session.phase !== 'publication-ready') {
    return decide('wait', false, null, touch(session, now), [], null,
      `Attestation requires a built-provisional session; session is ${session.phase}.`);
  }
  const attribution = verifyMemberAttribution(session);
  if (!attribution.complete) {
    return decide('attest-publication', false, RUNNER_SYNC_ERROR_CODES.coalescedAttributionMissing,
      { ...session, phase: 'built-provisional', updatedAt: now }, session.childReceipts, null,
      `Missing attributable child receipt(s) for member(s): ${attribution.missing.join(', ')}. Publication is blocked; provisional build retained.`);
  }
  return decide('attest-publication', true, null, { ...session, phase: 'publication-ready', updatedAt: now }, session.childReceipts, null,
    `All ${session.groupManifest.memberTaskIds.length} member(s) attributed; publication is ready pending seal continuity.`);
}

/**
 * Drive a provisional/publication-ready session to a terminal success phase.
 * Verifies complete member attribution (else fail closed, provisional retained)
 * and seal continuity against the current HEAD. A runner-affecting seal drift
 * abandons the provisional build (`abandoned`, rebuild required); otherwise the
 * session reaches `successPhase` with group state intact.
 */
function drivePublication(
  session: RunnerSyncSessionState,
  observation: SealObservation,
  now: string,
  successPhase: 'published' | 'reconciled'
): RunnerSyncSessionDecision {
  const attribution = verifyMemberAttribution(session);
  if (!attribution.complete) {
    return decide('attest-publication', false, RUNNER_SYNC_ERROR_CODES.coalescedAttributionMissing,
      { ...session, phase: 'built-provisional', updatedAt: now }, session.childReceipts, null,
      `Missing attributable child receipt(s) for member(s): ${attribution.missing.join(', ')}. Release and non-head close are blocked; provisional build retained.`);
  }
  if (session.inputGraph) {
    const continuity = evaluateSealContinuity({ graph: session.inputGraph, headDeltaPaths: observation.headDeltaPaths });
    if (continuity.revalidationRequired) {
      return decide('revalidate-seal', false, continuity.errorCode,
        { ...session, phase: 'abandoned', updatedAt: now }, session.childReceipts, resumeCommand(session),
        `${continuity.reason} Provisional build abandoned; rebuild and reseal before publication (group manifest retained).`);
    }
  }
  return decide('release', true, null, { ...session, phase: successPhase, updatedAt: now }, session.childReceipts, null,
    `All ${session.groupManifest.memberTaskIds.length} member(s) attributed and seal continuous at HEAD ${observation.currentHead}; ${successPhase === 'reconciled' ? 'reconciled and released' : 'released'} the steward group.`);
}

/**
 * Finalize publication and release the session. Accepts a `built-provisional` or
 * `publication-ready` session, requires one child receipt per member (else fail
 * closed on missing attribution, provisional retained) and seal continuity
 * against the current HEAD (else abandon and rebuild). Only then advances to
 * `published`.
 */
export function finalizeRunnerSyncPublication(
  session: RunnerSyncSessionState,
  observation: SealObservation,
  ports: SessionPorts
): RunnerSyncSessionDecision {
  const now = ports.now();
  if (session.phase !== 'built-provisional' && session.phase !== 'publication-ready') {
    return decide('wait', false, null, touch(session, now), [], null,
      `Finalization requires a built-provisional or publication-ready session; session is ${session.phase}.`);
  }
  return drivePublication(session, observation, now, 'published');
}

/**
 * Reconcile a session recovered from durable state (e.g. after a steward crash
 * or timeout). A `building` session with an expired/absent lease resumes to a
 * fresh build (`ATM_RUNNER_SYNC_RESUME_REQUIRED`); a provisional/publication-ready
 * session re-drives publication (reaching `reconciled` on success, or `abandoned`
 * on seal drift); an `abandoned` session resumes to rebuild; terminal states are
 * idempotent no-ops. Reconciliation never erases the retained group manifest or
 * child receipts.
 */
export function reconcileRunnerSyncSession(
  session: RunnerSyncSessionState,
  observation: SealObservation,
  ports: SessionPorts
): RunnerSyncSessionDecision {
  const now = ports.now();
  switch (session.phase) {
    case 'queued':
      return decide('build', true, null, touch(session, now), [], null, 'Session reconciled in queued state; start the build.');
    case 'building': {
      if (session.buildLease && !leaseExpired(session.buildLease, now)) {
        return decide('wait', true, null, touch(session, now), [], null,
          `Build lease ${session.buildLease.leaseId} is still live until ${session.buildLease.expiresAt}; build in progress.`);
      }
      return decide('resume-build', false, RUNNER_SYNC_ERROR_CODES.resumeRequired, touch(session, now), [], resumeCommand(session),
        'Session was building with no live lease (crash/timeout); resume the build deterministically from the preserved manifest.');
    }
    case 'built-provisional':
    case 'publication-ready':
      return drivePublication(session, observation, now, 'reconciled');
    case 'abandoned':
      return decide('resume-build', false, RUNNER_SYNC_ERROR_CODES.resumeRequired, touch(session, now), session.childReceipts, resumeCommand(session),
        'Session was abandoned after a seal drift; resume the build to reseal and rebuild before publication (group manifest retained).');
    case 'published':
      return decide('complete', true, null, touch(session, now), session.childReceipts, null,
        'Session already published/released; reconciliation is an idempotent no-op.');
    case 'reconciled':
      return decide('complete', true, null, touch(session, now), session.childReceipts, null, 'Session already reconciled.');
    default: {
      const exhaustive: never = session.phase;
      throw new Error(`Unhandled runner-sync session phase: ${String(exhaustive)}`);
    }
  }
}

// ---- attribution / manifest helpers ---------------------------------------

export interface MemberAttributionResult {
  readonly complete: boolean;
  readonly missing: readonly string[];
}

/** Every manifest member must have exactly one matching child receipt. */
export function verifyMemberAttribution(session: RunnerSyncSessionState): MemberAttributionResult {
  const attributed = new Set(session.childReceipts.map((receipt) => receipt.taskId));
  const missing = session.groupManifest.memberTaskIds.filter((taskId) => !attributed.has(taskId));
  return { complete: missing.length === 0 && session.groupManifest.memberTaskIds.length > 0, missing };
}

function normalizeMembers(
  members: readonly RunnerSyncMemberRequest[],
  stewardWorkId: string,
  sealedSourceSha: string
): readonly CoalescedGroupMember[] {
  const byTask = new Map<string, CoalescedGroupMember>();
  for (const member of members) {
    const taskId = String(member.taskId ?? '').trim();
    const actorId = String(member.actorId ?? '').trim();
    if (!taskId || !actorId) continue;
    const requestedSurfaces = sortedUnique(member.requestedSurfaces);
    const requestDigest = `sha256:${createHash('sha256')
      .update(JSON.stringify({ stewardWorkId, sealedSourceSha, taskId, actorId, requestedSurfaces }))
      .digest('hex')}`;
    byTask.set(taskId, {
      taskId,
      actorId,
      laneFingerprint: fingerprint(member.laneSessionId, 'lane'),
      requestedSurfaces,
      requestDigest
    });
  }
  return [...byTask.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
}

function buildManifest(
  stewardWorkId: string,
  sealedSourceSha: string,
  members: readonly CoalescedGroupMember[],
  sharedSealedInputDigest: string,
  sharedOutputDigest: string | null,
  createdAt: string
): CoalescedGroupManifest {
  return rehashManifest({
    schemaId: RUNNER_SYNC_GROUP_MANIFEST_SCHEMA,
    stewardWorkId,
    sealedSourceSha,
    members,
    memberTaskIds: members.map((m) => m.taskId).sort((a, b) => a.localeCompare(b)),
    sharedSealedInputDigest,
    sharedOutputDigest,
    manifestDigest: '',
    createdAt
  });
}

function rehashManifest(manifest: CoalescedGroupManifest): CoalescedGroupManifest {
  const core = {
    schemaId: manifest.schemaId,
    stewardWorkId: manifest.stewardWorkId,
    sealedSourceSha: manifest.sealedSourceSha,
    memberTaskIds: [...manifest.memberTaskIds].sort((a, b) => a.localeCompare(b)),
    members: [...manifest.members]
      .map((m) => ({ taskId: m.taskId, actorId: m.actorId, requestDigest: m.requestDigest, requestedSurfaces: m.requestedSurfaces }))
      .sort((a, b) => a.taskId.localeCompare(b.taskId)),
    sharedSealedInputDigest: manifest.sharedSealedInputDigest,
    sharedOutputDigest: manifest.sharedOutputDigest
  };
  const manifestDigest = `sha256:${createHash('sha256').update(JSON.stringify(core)).digest('hex')}`;
  return { ...manifest, manifestDigest };
}

function buildChildReceipt(
  manifest: CoalescedGroupManifest,
  member: CoalescedGroupMember,
  sharedOutputDigest: string,
  issuedAt: string
): ChildReceipt {
  const core = {
    schemaId: RUNNER_SYNC_CHILD_RECEIPT_SCHEMA,
    taskId: member.taskId,
    parentStewardWorkId: manifest.stewardWorkId,
    groupManifestDigest: manifest.manifestDigest,
    memberRequestDigest: member.requestDigest,
    sealedSourceSha: manifest.sealedSourceSha,
    sharedSealedInputDigest: manifest.sharedSealedInputDigest,
    sharedOutputDigest
  };
  const receiptDigest = `sha256:${createHash('sha256').update(JSON.stringify(core)).digest('hex')}`;
  return { ...core, receiptDigest, issuedAt };
}

function newLease(now: string, ttlSeconds: number): BuildLease {
  const expiresAt = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
  return { leaseId: `build-lease-${now}`, heartbeatAt: now, expiresAt, ttlSeconds };
}

function leaseExpired(lease: BuildLease, now: string): boolean {
  const expiresAt = Date.parse(lease.expiresAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(expiresAt) && Number.isFinite(nowMs) && expiresAt <= nowMs;
}

function resumeCommand(session: RunnerSyncSessionState): string {
  return `node atm.mjs broker runner-sync resume --steward-work-id ${JSON.stringify(session.stewardWorkId)} --sealed-source-sha ${JSON.stringify(session.sealedSourceSha)} --json`;
}

function touch(session: RunnerSyncSessionState, now: string): RunnerSyncSessionState {
  return { ...session, updatedAt: now };
}

function fingerprint(value: string | null | undefined, kind: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return `${kind}fp:${createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16)}`;
}

function decide(
  action: SessionAction,
  allowed: boolean,
  errorCode: RunnerSyncErrorCode | null,
  state: RunnerSyncSessionState,
  childReceipts: readonly ChildReceipt[],
  recoveryCommand: string | null,
  reason: string
): RunnerSyncSessionDecision {
  return {
    schemaId: 'atm.runnerSyncSessionDecision.v1',
    action,
    allowed,
    errorCode,
    state,
    childReceipts,
    recoveryCommand,
    reason
  };
}
