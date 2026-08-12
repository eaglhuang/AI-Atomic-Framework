import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { computeWriteScopeDigest, normalizeWritePathList, pathMatchesWriteScope } from './write-scope-policy.ts';
import type { ForeignGeneratedResidueProvenance } from './foreign-generated-residue-disposition.ts';

export const WORK_ADMISSION_TICKET_SCHEMA_ID = 'atm.workAdmissionTicket.v1';
export const WORK_ADMISSION_COVERAGE_RECEIPT_SCHEMA_ID = 'atm.workAdmissionCoverageReceipt.v1';

export type WorkAdmissionRecoveryMode = 'auto' | 'enabled' | 'disabled';
export type ResolvedWorkAdmissionRecoveryMode = Exclude<WorkAdmissionRecoveryMode, 'auto'>;
export type WorkAdmissionGrantKind = 'file-write' | 'lifecycle-operation' | 'process-manifest';
export type WorkAdmissionOperation = 'write' | 'stage' | 'commit' | 'close' | 'push';
export type WorkAdmissionOrigin = 'claim' | 'task-import' | 'repair-closure';

export interface WorkAdmissionRunnerSelection {
  readonly runnerKind: 'frozen' | 'source-first';
  readonly runnerRef: string;
  readonly selectedAt: string;
}

export interface WorkAdmissionGrant {
  readonly kind: WorkAdmissionGrantKind;
  readonly values: readonly string[];
  readonly digest: `sha256:${string}`;
}

export interface WorkAdmissionRecoveryPolicy {
  readonly requestedMode: WorkAdmissionRecoveryMode;
  readonly resolvedMode: ResolvedWorkAdmissionRecoveryMode;
  readonly reasons: readonly string[];
  readonly maxSavePoints: 0 | 2;
  readonly perTaskByteBudget: number;
  readonly repositoryByteBudget: number;
  readonly handoffTtlSeconds: number;
  readonly tempRoot: '.atm/runtime/work-admission-temp';
  readonly policyDigest: `sha256:${string}`;
}

export interface WorkAdmissionTicket {
  readonly schemaId: typeof WORK_ADMISSION_TICKET_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly ticketId: string;
  readonly ticketDigest: `sha256:${string}`;
  readonly taskId: string;
  readonly origin: WorkAdmissionOrigin;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly claimGeneration: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly scopeDigest: `sha256:${string}`;
  readonly runnerSelection: WorkAdmissionRunnerSelection;
  readonly grants: readonly WorkAdmissionGrant[];
  readonly deferredForeignResidue: readonly ForeignGeneratedResidueProvenance[];
  readonly recovery: WorkAdmissionRecoveryPolicy;
}

export interface WorkAdmissionCoverageReceipt {
  readonly schemaId: typeof WORK_ADMISSION_COVERAGE_RECEIPT_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly ticketId: string;
  readonly ticketDigest: `sha256:${string}`;
  readonly taskId: string;
  readonly actorId: string;
  readonly operation: WorkAdmissionOperation;
  readonly path: string;
  readonly baseDigest: `sha256:${string}` | null;
  readonly observedDigest: `sha256:${string}`;
  readonly producingAtmCommand: string;
  readonly recordedAt: string;
}

export interface WorkAdmissionTicketDecision {
  readonly ok: boolean;
  readonly code: 'ATM_WORK_ADMISSION_OK' | 'ATM_WRITE_TICKET_MISSING' | 'ATM_WRITE_TICKET_STALE' | 'ATM_WRITE_TICKET_SCOPE_VIOLATION' | 'ATM_WORK_ADMISSION_DELIVERY_NOT_AUTHORIZED';
  readonly reason: string;
}

export interface WorkAdmissionRecoveryDecision {
  readonly state: 'covered' | 'recovery-required';
  readonly disposition:
    | 'late-attach'
    | 'scope-amendment'
    | 'split'
    | 'handoff'
    | 'quarantine'
    | 'discard-with-proof'
    | 'historical-delivery-review'
    | 'corrective-commit'
    | 'remote-incident';
  readonly reason: string;
}

export interface WorkAdmissionSnapshotPlan {
  readonly enabled: boolean;
  readonly maxSavePoints: 0 | 2;
  readonly claimBaseline: 'reference-clean-git-blobs-and-capture-dirty-preimages' | 'not-created';
  readonly preRiskSavePoint: 'replaceable' | 'not-created';
  readonly tempRoot: '.atm/runtime/work-admission-temp' | null;
  readonly cleanup: 'close-immediately' | 'none';
}

export interface WorkAdmissionSnapshotSource {
  readonly path: string;
  readonly state: 'clean-tracked' | 'dirty-tracked' | 'untracked';
  readonly gitBlobId?: string | null;
  readonly content?: string | null;
}

export interface WorkAdmissionSnapshotEntry {
  readonly path: string;
  readonly kind: 'git-blob-reference' | 'compressed-preimage';
  readonly digest: `sha256:${string}`;
  readonly byteLength: number;
  readonly gitBlobId: string | null;
  readonly objectPath: string | null;
}

export interface WorkAdmissionSnapshot {
  readonly schemaId: 'atm.workAdmissionSnapshot.v1';
  readonly taskId: string;
  readonly ticketId: string;
  readonly point: 'claim-baseline' | 'pre-risk';
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly entries: readonly WorkAdmissionSnapshotEntry[];
  readonly compressedBytes: number;
}

export function issueWorkAdmissionTicket(input: {
  readonly taskId: string;
  readonly origin?: WorkAdmissionOrigin;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly claimGeneration: string;
  readonly allowedFiles: readonly string[];
  readonly requestedRecoveryMode?: WorkAdmissionRecoveryMode | null;
  readonly runnerSelection: WorkAdmissionRunnerSelection;
  readonly now?: string;
  readonly ttlSeconds?: number;
  readonly elevatedRisk?: {
    readonly complex?: boolean;
    readonly destructiveCapability?: boolean;
    readonly sharedSurface?: boolean;
    readonly workerEvidence?: 'trusted' | 'untrusted' | 'degraded' | 'unproven';
  };
  readonly processManifests?: readonly string[];
  readonly deferredForeignResidue?: readonly ForeignGeneratedResidueProvenance[];
}): WorkAdmissionTicket {
  const issuedAt = input.now ?? new Date().toISOString();
  const ttlSeconds = positiveInteger(input.ttlSeconds, 3600);
  const allowedFiles = normalizeWritePathList(input.allowedFiles);
  const recovery = resolveWorkAdmissionRecoveryPolicy({
    requestedMode: input.requestedRecoveryMode ?? 'auto',
    elevatedRisk: input.elevatedRisk
  });
  const grants: readonly WorkAdmissionGrant[] = [
    createGrant('file-write', allowedFiles),
    createGrant('lifecycle-operation', ['write', 'stage', 'commit', 'close', 'push']),
    createGrant('process-manifest', normalizeWritePathList(input.processManifests ?? []))
  ];
  const scopeDigest = asDigest(computeWriteScopeDigest(allowedFiles));
  const expiresAt = new Date(Date.parse(issuedAt) + ttlSeconds * 1000).toISOString();
  const ticketBasis = {
    taskId: input.taskId,
    origin: input.origin ?? 'claim',
    actorId: input.actorId,
    laneSessionId: input.laneSessionId ?? null,
    claimGeneration: input.claimGeneration,
    scopeDigest,
    issuedAt,
    expiresAt,
    runnerSelection: input.runnerSelection,
    grants,
    deferredForeignResidue: normalizeDeferredResidue(input.deferredForeignResidue ?? []),
    recovery
  };
  const ticketDigest = digest(ticketBasis);
  return {
    schemaId: WORK_ADMISSION_TICKET_SCHEMA_ID,
    specVersion: '0.1.0',
    ticketId: `wat-${ticketDigest.slice('sha256:'.length, 'sha256:'.length + 16)}`,
    ticketDigest,
    taskId: input.taskId,
    origin: input.origin ?? 'claim',
    actorId: input.actorId,
    laneSessionId: input.laneSessionId ?? null,
    claimGeneration: input.claimGeneration,
    issuedAt,
    expiresAt,
    scopeDigest,
    runnerSelection: input.runnerSelection,
    grants,
    deferredForeignResidue: normalizeDeferredResidue(input.deferredForeignResidue ?? []),
    recovery
  };
}

function normalizeDeferredResidue(entries: readonly ForeignGeneratedResidueProvenance[]): readonly ForeignGeneratedResidueProvenance[] {
  const seen = new Set<string>();
  return [...entries]
    .map((entry) => ({ ...entry, path: normalizeWritePathList([entry.path])[0] ?? entry.path }))
    .filter((entry) => !seen.has(entry.path) && (seen.add(entry.path), true))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function checkWorkAdmissionTicket(input: {
  readonly ticket: WorkAdmissionTicket | null | undefined;
  readonly taskId: string;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly claimGeneration?: string | null;
  readonly files: readonly string[];
  readonly operation: WorkAdmissionOperation;
  readonly runnerSelection?: WorkAdmissionRunnerSelection | null;
  readonly now?: string;
}): WorkAdmissionTicketDecision {
  const ticket = input.ticket;
  if (!ticket) return deny('ATM_WRITE_TICKET_MISSING', 'A work-admission ticket is required before a mutation can become governed delivery.');
  if (ticket.taskId !== input.taskId || ticket.actorId !== input.actorId
    || ticket.laneSessionId !== (input.laneSessionId ?? null)
    || (input.claimGeneration && ticket.claimGeneration !== input.claimGeneration)) {
    return deny('ATM_WORK_ADMISSION_DELIVERY_NOT_AUTHORIZED', 'Ticket identity does not match the current task, actor, lane, or claim generation.');
  }
  if (ticket.origin === 'task-import' && input.operation !== 'write' && input.operation !== 'stage') {
    return deny('ATM_WORK_ADMISSION_DELIVERY_NOT_AUTHORIZED', 'A task-import ticket can only authorize its imported ledger bundle.');
  }
  if (Date.parse(ticket.expiresAt) <= Date.parse(input.now ?? new Date().toISOString())) {
    return deny('ATM_WRITE_TICKET_STALE', 'Ticket expiry requires a governed claim renewal and ticket reseal.');
  }
  if (input.runnerSelection && stableJson(ticket.runnerSelection) !== stableJson(input.runnerSelection)) {
    return deny('ATM_WORK_ADMISSION_DELIVERY_NOT_AUTHORIZED', 'Ticket runner selection no longer matches the observed runner.');
  }
  const fileGrant = ticket.grants.find((grant) => grant.kind === 'file-write');
  const operationGrant = ticket.grants.find((grant) => grant.kind === 'lifecycle-operation');
  const requestedFiles = normalizeWritePathList(input.files);
  // Ticket grants are minted from the same scoped path vocabulary as task cards.
  // Reuse the canonical matcher so a grant such as `evidence/TASK.*` does not
  // become unusable at the final commit boundary.
  const filesAreAuthorized = Boolean(fileGrant) && requestedFiles.every((file) =>
    fileGrant!.values.some((scope) => pathMatchesWriteScope(file, scope))
    || isTaskManagedLifecyclePath(input.taskId, file)
  );
  if (!filesAreAuthorized) {
    return deny('ATM_WRITE_TICKET_SCOPE_VIOLATION', 'Requested mutation path is outside the ticket file grant.');
  }
  if (!operationGrant?.values.includes(input.operation)) {
    return deny('ATM_WORK_ADMISSION_DELIVERY_NOT_AUTHORIZED', 'Requested lifecycle operation is outside the ticket grant.');
  }
  return { ok: true, code: 'ATM_WORK_ADMISSION_OK', reason: 'Ticket identity, scope, runner, and lifecycle operation are current.' };
}

/**
 * ATM owns these task-local lifecycle records. They are never source delivery
 * scope, and are safe only for the ticket's exact task namespace. Keeping this
 * invariant in the authority preserves old tickets that predate lifecycle
 * paths being materialized in claim scope.
 */
function isTaskManagedLifecyclePath(taskId: string, file: string): boolean {
  const normalized = normalizeWritePathList([file])[0] ?? '';
  return normalized === '.atm/history/evidence/git-head.jsonl'
    || normalized === `.atm/history/tasks/${taskId}.json`
    || normalized.startsWith(`.atm/history/evidence/${taskId}.`)
    || normalized.startsWith(`.atm/history/task-events/${taskId}/`);
}

export function createWorkAdmissionCoverageReceipt(input: {
  readonly ticket: WorkAdmissionTicket;
  readonly operation: WorkAdmissionOperation;
  readonly path: string;
  readonly baseContent?: string | null;
  readonly observedContent: string;
  readonly producingAtmCommand: string;
  readonly now?: string;
}): WorkAdmissionCoverageReceipt {
  return {
    schemaId: WORK_ADMISSION_COVERAGE_RECEIPT_SCHEMA_ID,
    specVersion: '0.1.0',
    ticketId: input.ticket.ticketId,
    ticketDigest: input.ticket.ticketDigest,
    taskId: input.ticket.taskId,
    actorId: input.ticket.actorId,
    operation: input.operation,
    path: normalizeWritePathList([input.path])[0] ?? input.path,
    baseDigest: input.baseContent == null ? null : digest(input.baseContent),
    observedDigest: digest(input.observedContent),
    producingAtmCommand: input.producingAtmCommand,
    recordedAt: input.now ?? new Date().toISOString()
  };
}

export function resolveWorkAdmissionRecoveryPolicy(input: {
  readonly requestedMode: WorkAdmissionRecoveryMode;
  readonly elevatedRisk?: {
    readonly complex?: boolean;
    readonly destructiveCapability?: boolean;
    readonly sharedSurface?: boolean;
    readonly workerEvidence?: 'trusted' | 'untrusted' | 'degraded' | 'unproven';
  };
}): WorkAdmissionRecoveryPolicy {
  const requestedMode = input.requestedMode;
  const reasons = riskReasons(input.elevatedRisk);
  const resolvedMode: ResolvedWorkAdmissionRecoveryMode = requestedMode === 'auto'
    ? (reasons.length > 0 ? 'enabled' : 'disabled')
    : requestedMode;
  const policy = {
    requestedMode,
    resolvedMode,
    reasons: reasons.length > 0 ? reasons : ['low-risk-task'],
    maxSavePoints: resolvedMode === 'enabled' ? 2 as const : 0 as const,
    perTaskByteBudget: resolvedMode === 'enabled' ? 16 * 1024 * 1024 : 0,
    repositoryByteBudget: resolvedMode === 'enabled' ? 256 * 1024 * 1024 : 0,
    handoffTtlSeconds: resolvedMode === 'enabled' ? 7 * 24 * 60 * 60 : 0,
    tempRoot: '.atm/runtime/work-admission-temp' as const
  };
  return { ...policy, policyDigest: digest(policy) };
}

export function createWorkAdmissionSnapshotPlan(ticket: WorkAdmissionTicket): WorkAdmissionSnapshotPlan {
  const enabled = ticket.recovery.resolvedMode === 'enabled';
  return enabled
    ? {
      enabled: true,
      maxSavePoints: 2,
      claimBaseline: 'reference-clean-git-blobs-and-capture-dirty-preimages',
      preRiskSavePoint: 'replaceable',
      tempRoot: '.atm/runtime/work-admission-temp',
      cleanup: 'close-immediately'
    }
    : {
      enabled: false,
      maxSavePoints: 0,
      claimBaseline: 'not-created',
      preRiskSavePoint: 'not-created',
      tempRoot: null,
      cleanup: 'none'
    };
}

/**
 * Captures at most the two task-defined save points. Clean files never enter
 * the temp store: their Git blob id is enough to reconstruct the baseline.
 */
export function captureWorkAdmissionSnapshot(input: {
  readonly rootDir: string;
  readonly ticket: WorkAdmissionTicket;
  readonly point: 'claim-baseline' | 'pre-risk';
  readonly sources: readonly WorkAdmissionSnapshotSource[];
  readonly existingTaskBytes?: number;
  readonly existingRepositoryBytes?: number;
  readonly now?: string;
  readonly handoffPinned?: boolean;
}): WorkAdmissionSnapshot {
  if (input.ticket.recovery.resolvedMode !== 'enabled') {
    throw new Error('ATM_WORK_ADMISSION_RECOVERY_REQUIRED: snapshots are disabled by the claim-sealed recovery policy.');
  }
  const existingTaskBytes = input.existingTaskBytes ?? 0;
  const existingRepositoryBytes = input.existingRepositoryBytes ?? 0;
  const objectRoot = path.join(input.rootDir, input.ticket.taskId, input.ticket.ticketId, input.point);
  const entries: WorkAdmissionSnapshotEntry[] = [];
  let compressedBytes = 0;
  for (const source of input.sources) {
    const filePath = normalizeWritePathList([source.path])[0] ?? source.path;
    if (source.state === 'clean-tracked') {
      if (!source.gitBlobId) throw new Error(`ATM_WORK_ADMISSION_RECOVERY_REQUIRED: clean tracked file ${filePath} requires a Git blob id.`);
      entries.push({ path: filePath, kind: 'git-blob-reference', digest: digest(source.gitBlobId), byteLength: 0, gitBlobId: source.gitBlobId, objectPath: null });
      continue;
    }
    if (source.content == null) throw new Error(`ATM_WORK_ADMISSION_RECOVERY_REQUIRED: ${source.state} file ${filePath} requires preimage content.`);
    const compressed = deflateSync(Buffer.from(source.content, 'utf8'));
    const projectedTaskBytes = existingTaskBytes + compressedBytes + compressed.byteLength;
    const projectedRepositoryBytes = existingRepositoryBytes + compressedBytes + compressed.byteLength;
    if (projectedTaskBytes > input.ticket.recovery.perTaskByteBudget || projectedRepositoryBytes > input.ticket.recovery.repositoryByteBudget) {
      throw new Error('ATM_WORK_ADMISSION_SNAPSHOT_BUDGET_EXCEEDED: snapshot byte budget would be exceeded before writing a temp object.');
    }
    const contentDigest = digest(source.content);
    const objectName = `${contentDigest.slice('sha256:'.length)}.deflate`;
    const objectPath = path.join(objectRoot, objectName);
    mkdirSync(objectRoot, { recursive: true });
    if (!existsSync(objectPath)) writeFileSync(objectPath, compressed);
    compressedBytes += compressed.byteLength;
    entries.push({ path: filePath, kind: 'compressed-preimage', digest: contentDigest, byteLength: compressed.byteLength, gitBlobId: null, objectPath });
  }
  const createdAt = input.now ?? new Date().toISOString();
  const expiresAt = input.handoffPinned && input.ticket.recovery.handoffTtlSeconds > 0
    ? new Date(Date.parse(createdAt) + input.ticket.recovery.handoffTtlSeconds * 1000).toISOString()
    : null;
  const snapshot: WorkAdmissionSnapshot = {
    schemaId: 'atm.workAdmissionSnapshot.v1',
    taskId: input.ticket.taskId,
    ticketId: input.ticket.ticketId,
    point: input.point,
    createdAt,
    expiresAt,
    entries,
    compressedBytes
  };
  mkdirSync(objectRoot, { recursive: true });
  writeFileSync(path.join(objectRoot, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return snapshot;
}

export function cleanupWorkAdmissionSnapshots(input: {
  readonly rootDir: string;
  readonly taskId: string;
  readonly ticketId?: string | null;
  readonly now?: string;
  readonly expiredOnly?: boolean;
}): readonly string[] {
  const taskRoot = path.join(input.rootDir, input.taskId);
  if (!existsSync(taskRoot)) return [];
  const removed: string[] = [];
  const ticketIds = input.ticketId ? [input.ticketId] : readdirSync(taskRoot);
  for (const ticketId of ticketIds) {
    const ticketRoot = path.join(taskRoot, ticketId);
    if (!existsSync(ticketRoot)) continue;
    if (input.expiredOnly && !snapshotTreeExpired(ticketRoot, input.now)) continue;
    rmSync(ticketRoot, { recursive: true, force: true });
    removed.push(ticketRoot);
  }
  return removed;
}

function snapshotTreeExpired(ticketRoot: string, now?: string): boolean {
  const nowMs = Date.parse(now ?? new Date().toISOString());
  if (!Number.isFinite(nowMs)) return false;
  const points = readdirSync(ticketRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return points.length > 0 && points.every((point) => {
    try {
      const snapshot = JSON.parse(readFileSync(path.join(ticketRoot, point.name, 'snapshot.json'), 'utf8')) as WorkAdmissionSnapshot;
      return snapshot.expiresAt != null && Date.parse(snapshot.expiresAt) < nowMs;
    } catch {
      return false;
    }
  });
}

export function recoverUnattributedMutation(input: {
  readonly inScope: boolean;
  readonly alreadyPublished?: boolean;
  readonly nativeCommit?: boolean;
  readonly requestedHandoff?: boolean;
}): WorkAdmissionRecoveryDecision {
  if (input.alreadyPublished) return recovery('remote-incident', 'Published state requires remote incident review before any corrective delivery.');
  if (input.nativeCommit) return recovery('historical-delivery-review', 'A native commit requires historical delivery review and a corrective governed commit.');
  if (input.requestedHandoff) return recovery('handoff', 'Preserve the violation receipt and hand off through the governed lifecycle.');
  if (input.inScope) return recovery('late-attach', 'In-scope mutation can be late-attached only with the original violation receipt and fresh validation.');
  return recovery('split', 'Out-of-scope mutation must move to a separately admitted task or quarantine disposition.');
}

function createGrant(kind: WorkAdmissionGrantKind, values: readonly string[]): WorkAdmissionGrant {
  const normalized = [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))].sort();
  return { kind, values: normalized, digest: digest({ kind, values: normalized }) };
}

function riskReasons(input: Parameters<typeof resolveWorkAdmissionRecoveryPolicy>[0]['elevatedRisk']): string[] {
  if (!input) return [];
  const reasons: string[] = [];
  if (input.complex) reasons.push('complex-task');
  if (input.destructiveCapability) reasons.push('destructive-capability');
  if (input.sharedSurface) reasons.push('shared-surface');
  if (input.workerEvidence && input.workerEvidence !== 'trusted') reasons.push(`worker-evidence:${input.workerEvidence}`);
  return reasons;
}

function deny(code: WorkAdmissionTicketDecision['code'], reason: string): WorkAdmissionTicketDecision {
  return { ok: false, code, reason };
}

function recovery(disposition: WorkAdmissionRecoveryDecision['disposition'], reason: string): WorkAdmissionRecoveryDecision {
  return { state: 'recovery-required', disposition, reason };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : fallback;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex')}`;
}

function asDigest(value: string): `sha256:${string}` {
  return value.startsWith('sha256:') ? value as `sha256:${string}` : digest(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
    : entry);
}
