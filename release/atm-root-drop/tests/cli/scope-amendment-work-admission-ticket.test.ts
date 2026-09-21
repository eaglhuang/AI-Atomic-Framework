import assert from 'node:assert/strict';
import { selectTicketValidatedCommitFiles } from '../../packages/cli/src/commands/git-governance.ts';
import { resealWorkAdmissionTicketForRenewal } from '../../packages/cli/src/commands/tasks/claim-work-admission.ts';
import {
  applyAtomicScopeAmendment,
  readTicketWriteGrant,
  syncScopeAmendmentState
} from '../../packages/cli/src/commands/tasks/scope-amendment/implementation.ts';
import { checkWorkAdmissionTicket, type WorkAdmissionTicket } from '../../packages/core/src/broker/work-admission-ticket.ts';
import type { TaskClaimRecord } from '@ai-atomic-framework/core';

const TASK_ID = 'TASK-SCOPE-0393-SEQ';
const ACTOR_ID = 'actor-scope-seq';
const ORIGINAL = 'packages/cli/src/example.ts';
const ADDED = 'packages/cli/src/added.ts';
const LIFECYCLE = `.atm/history/tasks/${TASK_ID}.json`;

function claimedDocument(): Record<string, unknown> {
  const claim = {
    leaseId: 'lease-seq',
    actorId: ACTOR_ID,
    files: [ORIGINAL, LIFECYCLE],
    ttlSeconds: 3600,
    state: 'active',
    claimedAt: '2026-08-14T12:00:00.000Z',
    heartbeatAt: '2026-08-14T12:00:00.000Z'
  } as unknown as TaskClaimRecord;
  const taskDocument: Record<string, unknown> = {
    workItemId: TASK_ID,
    taskId: TASK_ID,
    status: 'running',
    owner: ACTOR_ID,
    scopePaths: [ORIGINAL],
    claim,
    taskDirectionLock: { allowedFiles: [ORIGINAL, LIFECYCLE] }
  };
  resealWorkAdmissionTicketForRenewal({
    cwd: process.cwd(),
    taskId: TASK_ID,
    actorId: ACTOR_ID,
    taskDocument,
    claim,
    nowIso: '2026-08-14T12:00:00.000Z'
  });
  return taskDocument;
}

{
  const caseId = 'scope_amendment_reseals_ticket_atomically_0393';
  const afterClaim = claimedDocument();
  const historicalLock: Record<string, unknown> = {
    files: [ORIGINAL, LIFECYCLE],
    taskDirectionLock: { allowedFiles: [ORIGINAL, LIFECYCLE] }
  };
  const mergedAllowed = [ORIGINAL, LIFECYCLE, ADDED];

  syncScopeAmendmentState({
    taskDocument: afterClaim,
    outerLock: historicalLock,
    embeddedLockRecord: historicalLock.taskDirectionLock as Record<string, unknown>,
    mergedAllowed
  });
  const staleTicket = afterClaim.workAdmissionTicket as WorkAdmissionTicket;
  const staleCandidates = selectTicketValidatedCommitFiles(
    [ORIGINAL, ADDED, LIFECYCLE],
    staleTicket,
    false,
    true
  );
  assert.equal(
    staleCandidates.includes(ADDED),
    false,
    `${caseId} red: added delivery path remains absent from the ticket-scoped bundle`
  );
  assert.equal(
    checkWorkAdmissionTicket({
      ticket: staleTicket,
      taskId: TASK_ID,
      actorId: ACTOR_ID,
      claimGeneration: 'lease-seq',
      files: [ADDED],
      operation: 'commit',
      now: '2026-08-14T12:00:01.000Z'
    }).code,
    'ATM_WRITE_TICKET_SCOPE_VIOLATION'
  );

  const repaired = claimedDocument();
  const repairedLock: Record<string, unknown> = {
    files: [ORIGINAL, LIFECYCLE],
    taskDirectionLock: { allowedFiles: [ORIGINAL, LIFECYCLE] }
  };
  const result = applyAtomicScopeAmendment({
    taskDocument: repaired,
    outerLock: repairedLock,
    embeddedLockRecord: repairedLock.taskDirectionLock as Record<string, unknown>,
    mergedAllowed,
    taskId: TASK_ID,
    actorId: ACTOR_ID,
    ports: {
      resealTicket: (document) => {
        resealWorkAdmissionTicketForRenewal({
          cwd: process.cwd(),
          taskId: TASK_ID,
          actorId: ACTOR_ID,
          taskDocument: document,
          claim: document.claim as TaskClaimRecord,
          nowIso: '2026-08-14T12:00:02.000Z'
        });
      },
      writeLock: () => {},
      persistLedger: () => {}
    }
  });
  const grant = readTicketWriteGrant(result.ticket);
  assert.ok(grant.includes(ADDED), `${caseId} green: ticket grant includes the added path`);
  const ledgerFiles = result.taskDocument.scopePaths as string[];
  const lockFiles = (result.outerLock.taskDirectionLock as { allowedFiles: string[] }).allowedFiles;
  const claimFiles = (result.taskDocument.claim as { files: string[] }).files;
  assert.ok(ledgerFiles.includes(ADDED) && lockFiles.includes(ADDED) && claimFiles.includes(ADDED));
  const candidates = selectTicketValidatedCommitFiles(
    [ORIGINAL, ADDED, LIFECYCLE],
    result.ticket,
    false,
    true
  );
  assert.ok(candidates.includes(ADDED), `${caseId} green: governed candidate bundle includes the added file`);
  assert.equal(
    checkWorkAdmissionTicket({
      ticket: result.ticket,
      taskId: TASK_ID,
      actorId: ACTOR_ID,
      claimGeneration: 'lease-seq',
      files: [ADDED],
      operation: 'commit',
      now: '2026-08-14T12:00:03.000Z'
    }).ok,
    true
  );
  console.log(JSON.stringify({
    marker: '[scope-amendment-work-admission-ticket.test] ok',
    caseId,
    ticketDigest: result.ticket?.ticketDigest ?? null,
    ticketGrant: grant,
    ledger: ledgerFiles,
    claim: claimFiles,
    directionLock: lockFiles,
    candidates
  }));
}
