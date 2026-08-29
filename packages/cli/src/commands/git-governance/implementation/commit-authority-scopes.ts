import { pathMatchesTaskScope, uniqueSorted } from '../commit-scope-policy.ts';
import { parseTaskClaim } from './identity-check-command.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;

type CommitAuthorityScopes = {
  readonly enforced: boolean;
  readonly claimScopes: readonly string[];
  readonly ticketScopes: readonly string[];
};

export type CommitPathAuthorityDecision = {
  readonly schemaId: 'atm.commitPathAuthorityDecision.v1';
  readonly ok: boolean;
  readonly code: 'legacy-inspection' | 'claim-and-ticket-covered' | 'claim-not-active' | 'outside-active-claim' | 'outside-ticket-grant';
  readonly reason: string;
};

export type CommitAuthorityPolicy = {
  readonly evaluate: (filePath: string) => CommitPathAuthorityDecision;
};

function stringScopes(value: LegacyValue): readonly string[] {
  return Array.isArray(value)
    ? uniqueSorted(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))
    : [];
}

/**
 * Resolves live commit authority separately from the task card's planning
 * envelope. A declared scope may overlap other tasks; active claim and ticket
 * grants decide which current bytes may enter a sealed candidate.
 */
function resolveCommitAuthorityScopes(input: LegacyValue): CommitAuthorityScopes {
  const claim = parseTaskClaim(input.taskDocument.claim);
  if (!claim) {
    // Preserve pre-claim and legacy bundle inspection. Mutation admission is
    // still enforced by the later session/ticket boundary.
    return { enforced: false, claimScopes: [], ticketScopes: [] };
  }
  const rawClaim = input.taskDocument.claim;
  const claimScopes = rawClaim && typeof rawClaim === 'object' && !Array.isArray(rawClaim)
    ? stringScopes(rawClaim.files)
    : [];
  const ticket = input.taskDocument.workAdmissionTicket;
  const ticketForTaskActor = ticket && typeof ticket === 'object' && !Array.isArray(ticket)
    && ticket.schemaId === 'atm.workAdmissionTicket.v1'
    && ticket.taskId === input.taskId
    && ticket.actorId === claim.actorId
      ? ticket
      : null;
  const activeClaimTicket = ticketForTaskActor && ticketForTaskActor.claimGeneration === claim.leaseId
    ? ticketForTaskActor
    : null;
  const terminalClosebackTicket = claim.state === 'released'
    && ticketForTaskActor?.origin === 'repair-closure'
      ? ticketForTaskActor
      : null;
  const matchingTicket = activeClaimTicket ?? terminalClosebackTicket;
  const fileGrant = matchingTicket && Array.isArray(matchingTicket.grants)
    ? matchingTicket.grants.find((grant: LegacyValue) => grant?.kind === 'file-write')
    : null;
  const ticketScopes = fileGrant ? stringScopes(fileGrant.values) : [];
  if (terminalClosebackTicket) {
    // A reconcile/repair closeback intentionally releases the normal claim
    // before its ledger, event and closure packet are committed. Its persisted
    // ticket is the sole, actor-bound authority for that final narrow bundle.
    return { enforced: true, claimScopes, ticketScopes };
  }
  if (claim.state !== 'active') {
    return { enforced: true, claimScopes: [], ticketScopes: [] };
  }
  return {
    enforced: true,
    claimScopes,
    ticketScopes,
  };
}

function evaluatePath(
  filePath: string,
  authority: CommitAuthorityScopes,
): CommitPathAuthorityDecision {
  const decision = (ok: boolean, code: CommitPathAuthorityDecision['code'], reason: string): CommitPathAuthorityDecision =>
    ({ schemaId: 'atm.commitPathAuthorityDecision.v1', ok, code, reason });
  if (!authority.enforced) return decision(true, 'legacy-inspection', 'No claim exists; later mutation admission remains authoritative.');
  if (authority.claimScopes.length === 0) return decision(false, 'claim-not-active', 'No active claim scope authorizes source bytes.');
  if (!authority.claimScopes.some((scope) => pathMatchesTaskScope(filePath, scope))) {
    return decision(false, 'outside-active-claim', 'Path is outside the active claim.');
  }
  if (authority.ticketScopes.length > 0 && !authority.ticketScopes.some((scope) => pathMatchesTaskScope(filePath, scope))) {
    return decision(false, 'outside-ticket-grant', 'Path is outside the matching file-write grant.');
  }
  return decision(true, 'claim-and-ticket-covered', 'Path is covered by current commit authority.');
}

export function createCommitAuthorityPolicy(input: LegacyValue): CommitAuthorityPolicy {
  const authority = resolveCommitAuthorityScopes(input);
  return { evaluate: (filePath) => evaluatePath(filePath, authority) };
}
