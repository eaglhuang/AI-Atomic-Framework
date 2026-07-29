import { createHash } from 'node:crypto';

export type WriteScopeDecisionCode =
  | 'ATM_WRITE_SCOPE_AMENDMENT_REQUIRED'
  | 'ATM_WRITE_SCOPE_UNATTACHED_WIP'
  | 'ATM_WRITE_TICKET_SCOPE_VIOLATION'
  | 'ATM_WRITE_TICKET_MISSING'
  | 'ATM_WRITE_TICKET_STALE';

export type WriteScopeOperation = 'write' | 'stage' | 'commit' | 'close' | 'push';

export interface WriteScopePolicyInput {
  readonly taskId: string;
  readonly actorId: string;
  readonly requestedFiles: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly operation?: WriteScopeOperation;
  readonly observedPhase?: 'pre-write' | 'post-write' | 'commit' | 'close' | 'push';
  readonly ticketActorId?: string | null;
  readonly ticketTaskId?: string | null;
  readonly claimActorId?: string | null;
  readonly laneSessionId?: string | null;
  readonly ticketLaneSessionId?: string | null;
  readonly ambientActorId?: string | null;
  readonly ticketExpiresAt?: string | null;
  readonly now?: string | null;
  readonly recoveryBypassed?: boolean;
}

export interface WriteScopePolicyDecision {
  readonly ok: boolean;
  readonly code: WriteScopeDecisionCode | null;
  readonly classification: 'allowed' | 'amendment-required' | 'unattached-wip' | 'violation' | 'missing-ticket' | 'stale-ticket';
  readonly taskId: string;
  readonly actorId: string;
  readonly requestedFiles: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly outOfScopeFiles: readonly string[];
  readonly protectedHistoryFiles: readonly string[];
  readonly scopeDigest: string;
  readonly identity: {
    readonly claimActorId: string | null;
    readonly ticketActorId: string | null;
    readonly ambientActorId: string | null;
    readonly actorMismatch: boolean;
    readonly laneMismatch: boolean;
  };
  readonly recoveryCommand: string | null;
  readonly recoveryCommands: Readonly<Record<string, string>>;
  readonly reason: string;
}

export function normalizeWritePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function normalizeWritePathList(values: readonly string[]): readonly string[] {
  return uniqueSorted(values.map(normalizeWritePath).filter(Boolean));
}

export function computeWriteScopeDigest(allowedFiles: readonly string[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(normalizeWritePathList(allowedFiles))).digest('hex')}`;
}

export function pathMatchesWriteScope(file: string, scope: string): boolean {
  const normalizedFile = normalizeWritePath(file);
  const normalizedScope = normalizeWritePath(scope);
  if (!normalizedFile || !normalizedScope) return false;
  if (normalizedScope === normalizedFile) return true;
  if (normalizedScope.endsWith('/**')) {
    const prefix = normalizedScope.slice(0, -3);
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }
  if (normalizedScope.includes('*')) {
    return globToRegExp(normalizedScope).test(normalizedFile);
  }
  return false;
}

function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    if (glob.slice(index, index + 3) === '**/') {
      pattern += '(?:.*/)?';
      index += 2;
      continue;
    }
    if (glob.slice(index, index + 2) === '**') {
      pattern += '.*';
      index += 1;
      continue;
    }
    if (glob[index] === '*') {
      pattern += '[^/]*';
      continue;
    }
    pattern += escapeRegExp(glob[index]);
  }
  return new RegExp(`^${pattern}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function isProtectedHistoryPath(file: string): boolean {
  const normalized = normalizeWritePath(file);
  return normalized.startsWith('.atm/history/');
}

export function inspectWriteScopePolicy(input: WriteScopePolicyInput): WriteScopePolicyDecision {
  const requestedFiles = normalizeWritePathList(input.requestedFiles);
  const allowedFiles = normalizeWritePathList(input.allowedFiles);
  const outOfScopeFiles = requestedFiles.filter((file) => !allowedFiles.some((scope) => pathMatchesWriteScope(file, scope)));
  const protectedHistoryFiles = requestedFiles.filter(isProtectedHistoryPath);
  const identity = inspectIdentity(input);
  const ticketMissing = !input.ticketActorId || !input.ticketTaskId;
  const ticketStale = isTicketStale(input);
  const recoveryCommands = buildRecoveryCommands(input.taskId, input.actorId, outOfScopeFiles);
  const scopeDigest = computeWriteScopeDigest(allowedFiles);

  if (ticketMissing) {
    return decision(input, {
      ok: false,
      code: 'ATM_WRITE_TICKET_MISSING',
      classification: 'missing-ticket',
      requestedFiles,
      allowedFiles,
      outOfScopeFiles,
      protectedHistoryFiles,
      identity,
      scopeDigest,
      recoveryCommands,
      recoveryCommand: recoveryCommands.acquireTicket,
      reason: 'No write-ticket authority was supplied for a governed write boundary.'
    });
  }
  if (ticketStale) {
    return decision(input, {
      ok: false,
      code: 'ATM_WRITE_TICKET_STALE',
      classification: 'stale-ticket',
      requestedFiles,
      allowedFiles,
      outOfScopeFiles,
      protectedHistoryFiles,
      identity,
      scopeDigest,
      recoveryCommands,
      recoveryCommand: recoveryCommands.acquireTicket,
      reason: 'The write ticket no longer matches the task, actor, lane, or expiry contract.'
    });
  }
  if (identity.actorMismatch || identity.laneMismatch) {
    return decision(input, {
      ok: false,
      code: 'ATM_WRITE_TICKET_STALE',
      classification: 'stale-ticket',
      requestedFiles,
      allowedFiles,
      outOfScopeFiles,
      protectedHistoryFiles,
      identity,
      scopeDigest,
      recoveryCommands,
      recoveryCommand: recoveryCommands.acquireTicket,
      reason: 'The requested actor or lane does not match the active claim/ticket authority.'
    });
  }
  if (outOfScopeFiles.length === 0 && protectedHistoryFiles.length === 0) {
    return decision(input, {
      ok: true,
      code: null,
      classification: 'allowed',
      requestedFiles,
      allowedFiles,
      outOfScopeFiles,
      protectedHistoryFiles,
      identity,
      scopeDigest,
      recoveryCommands,
      recoveryCommand: null,
      reason: 'Requested files are covered by the write ticket scope.'
    });
  }
  if (input.recoveryBypassed || input.operation === 'commit' || input.operation === 'close' || input.operation === 'push') {
    return decision(input, {
      ok: false,
      code: 'ATM_WRITE_TICKET_SCOPE_VIOLATION',
      classification: 'violation',
      requestedFiles,
      allowedFiles,
      outOfScopeFiles,
      protectedHistoryFiles,
      identity,
      scopeDigest,
      recoveryCommands,
      recoveryCommand: recoveryCommands.status,
      reason: 'Out-of-scope write evidence reached a delivery boundary before recovery was resolved.'
    });
  }
  if (input.observedPhase === 'post-write') {
    return decision(input, {
      ok: false,
      code: 'ATM_WRITE_SCOPE_UNATTACHED_WIP',
      classification: 'unattached-wip',
      requestedFiles,
      allowedFiles,
      outOfScopeFiles,
      protectedHistoryFiles,
      identity,
      scopeDigest,
      recoveryCommands,
      recoveryCommand: recoveryCommands.scopeAmendAndAttach,
      reason: 'Out-of-scope dirty WIP already exists and must be attached, preserved, discarded, or split.'
    });
  }
  return decision(input, {
    ok: false,
    code: 'ATM_WRITE_SCOPE_AMENDMENT_REQUIRED',
    classification: 'amendment-required',
    requestedFiles,
    allowedFiles,
    outOfScopeFiles,
    protectedHistoryFiles,
    identity,
    scopeDigest,
    recoveryCommands,
    recoveryCommand: recoveryCommands.scopeAmendAndAttach,
    reason: 'Requested files are outside the write ticket scope and need a governed scope amendment before writing.'
  });
}

function inspectIdentity(input: WriteScopePolicyInput): WriteScopePolicyDecision['identity'] {
  const claimActorId = normalizeOptional(input.claimActorId);
  const ticketActorId = normalizeOptional(input.ticketActorId);
  const ambientActorId = normalizeOptional(input.ambientActorId);
  const actorMismatch = Boolean(
    (claimActorId && claimActorId !== input.actorId)
    || (ticketActorId && ticketActorId !== input.actorId)
  );
  const laneMismatch = Boolean(input.laneSessionId && input.ticketLaneSessionId && input.laneSessionId !== input.ticketLaneSessionId);
  return { claimActorId, ticketActorId, ambientActorId, actorMismatch, laneMismatch };
}

function isTicketStale(input: WriteScopePolicyInput): boolean {
  if (input.ticketTaskId && input.ticketTaskId !== input.taskId) return true;
  if (input.ticketActorId && input.ticketActorId !== input.actorId) return true;
  if (!input.ticketExpiresAt) return false;
  const expiresAt = Date.parse(input.ticketExpiresAt);
  const now = Date.parse(input.now ?? new Date().toISOString());
  return Number.isFinite(expiresAt) && Number.isFinite(now) && expiresAt <= now;
}

function buildRecoveryCommands(taskId: string, actorId: string, outOfScopeFiles: readonly string[]): Readonly<Record<string, string>> {
  const paths = outOfScopeFiles.length > 0 ? outOfScopeFiles.join(',') : '<paths>';
  return {
    acquireTicket: `node atm.mjs write-ticket acquire --task ${taskId} --actor ${actorId} --files ${paths} --intent write --json`,
    scopeAmendAndAttach: `node atm.mjs tasks scope add --task ${taskId} --actor ${actorId} --add ${paths} --reason "write-ticket scope amendment" --json`,
    nonDeliveryWipCommit: `node atm.mjs tasks release --task ${taskId} --actor ${actorId} --wip-commit --reason "preserve unattached WIP" --json`,
    discardReceipt: `node atm.mjs tasks release --task ${taskId} --actor ${actorId} --discard-wip --reason "discard unattached WIP" --json`,
    splitToNewTask: `node atm.mjs next --prompt "Split out-of-scope WIP from ${taskId}" --json`,
    status: `node atm.mjs write-ticket status --task ${taskId} --actor ${actorId} --json`
  };
}

function decision(input: WriteScopePolicyInput, value: Omit<WriteScopePolicyDecision, 'taskId' | 'actorId'>): WriteScopePolicyDecision {
  return {
    ...value,
    taskId: input.taskId,
    actorId: input.actorId
  };
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
