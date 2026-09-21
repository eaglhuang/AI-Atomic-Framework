import assert from 'node:assert/strict';
import { CliError } from '../../shared.ts';
import { resealWorkAdmissionTicketForRenewal } from '../claim-work-admission.ts';
import {
  applyAtomicScopeAmendment,
  cloneAuthorityRecord,
  readTicketWriteGrant,
  syncScopeAmendmentState
} from '../scope-amendment/implementation.ts';
import type { TaskClaimRecord } from '@ai-atomic-framework/core';

const TASK_ID = 'TASK-SCOPE-0393-FIXTURE';
const ACTOR_ID = 'actor-scope-0393';
const ORIGINAL = 'packages/cli/src/commands/tasks/scope-amendment/implementation.ts';
const ADDED = 'packages/cli/src/commands/tasks/claim-work-admission.ts';

function fixtureDocument(files: readonly string[], ticketFiles: readonly string[]) {
  const claim = {
    leaseId: 'lease-scope-0393',
    actorId: ACTOR_ID,
    files: [...files],
    ttlSeconds: 3600,
    state: 'active',
    claimedAt: '2026-08-14T00:00:00.000Z',
    heartbeatAt: '2026-08-14T00:00:00.000Z'
  } as unknown as TaskClaimRecord;
  const taskDocument: Record<string, unknown> = {
    workItemId: TASK_ID,
    taskId: TASK_ID,
    status: 'running',
    owner: ACTOR_ID,
    scopePaths: [...files],
    claim,
    taskDirectionLock: { allowedFiles: [...files] }
  };
  resealWorkAdmissionTicketForRenewal({
    cwd: process.cwd(),
    taskId: TASK_ID,
    actorId: ACTOR_ID,
    taskDocument,
    claim,
    nowIso: '2026-08-14T00:00:00.000Z'
  });
  if (ticketFiles.join('\0') !== files.join('\0')) {
    const ticket = cloneAuthorityRecord(taskDocument.workAdmissionTicket as Record<string, unknown>);
    const grants = Array.isArray(ticket.grants) ? [...ticket.grants] : [];
    const fileGrantIndex = grants.findIndex((grant) => (grant as { kind?: string }).kind === 'file-write');
    if (fileGrantIndex >= 0) {
      grants[fileGrantIndex] = { ...(grants[fileGrantIndex] as object), values: [...ticketFiles] };
    }
    ticket.grants = grants;
    taskDocument.workAdmissionTicket = ticket;
  }
  return taskDocument;
}

function fixtureLock(files: readonly string[]): Record<string, unknown> {
  return {
    files: [...files],
    taskDirectionLock: { allowedFiles: [...files] }
  };
}

{
  const caseId = 'scope_amendment_partial_projection_fails_closed_0393';
  const mergedAllowed = [ORIGINAL, ADDED];
  const taskDocument = fixtureDocument([ORIGINAL], [ORIGINAL]);
  const outerLock = fixtureLock([ORIGINAL]);
  const priorDocument = cloneAuthorityRecord(taskDocument);
  const priorLock = cloneAuthorityRecord(outerLock);
  const writes: string[] = [];
  let caught: unknown;
  try {
    applyAtomicScopeAmendment({
      taskDocument,
      outerLock,
      embeddedLockRecord: outerLock.taskDirectionLock as Record<string, unknown>,
      mergedAllowed,
      taskId: TASK_ID,
      actorId: ACTOR_ID,
      ports: {
        resealTicket: () => {
          throw new Error('injected-reseal-failure');
        },
        writeLock: () => { writes.push('lock'); },
        persistLedger: () => { writes.push('ledger'); }
      }
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, `${caseId}: reseal failure must throw`);
  assert.equal(writes.length, 0, `${caseId}: no persist after reseal failure`);
  assert.deepEqual(taskDocument, priorDocument, `${caseId}: ledger/claim/ticket stay at prior generation`);
  assert.deepEqual(outerLock, priorLock, `${caseId}: direction lock stays at prior generation`);

  const persistWrites: string[] = [];
  try {
    applyAtomicScopeAmendment({
      taskDocument,
      outerLock,
      embeddedLockRecord: outerLock.taskDirectionLock as Record<string, unknown>,
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
            nowIso: '2026-08-14T00:00:01.000Z'
          });
        },
        writeLock: () => { persistWrites.push('lock'); },
        persistLedger: () => {
          persistWrites.push('ledger-attempt');
          throw new CliError('ATM_TASK_TRANSITION_WRITE_FAILED', 'injected-transition-failure', { exitCode: 1 });
        }
      }
    });
    assert.fail(`${caseId}: transition failure must not succeed`);
  } catch (error) {
    assert.ok(error instanceof CliError, `${caseId}: transition failure stays a CliError`);
  }
  assert.deepEqual(persistWrites, ['lock', 'ledger-attempt', 'lock'], `${caseId}: lock restore after transition failure`);
  assert.deepEqual(taskDocument, priorDocument, `${caseId}: caller ledger unchanged after transition failure`);
  assert.deepEqual(outerLock, priorLock, `${caseId}: caller lock unchanged after transition failure`);
  console.log(`[${caseId}] ok`);
}

{
  const caseId = 'scope_amendment_reseals_ticket_atomically_0393';
  const mergedAllowed = [ORIGINAL, ADDED];
  const historical = fixtureDocument([ORIGINAL], [ORIGINAL]);
  const historicalLock = fixtureLock([ORIGINAL]);
  syncScopeAmendmentState({
    taskDocument: historical,
    outerLock: historicalLock,
    embeddedLockRecord: historicalLock.taskDirectionLock as Record<string, unknown>,
    mergedAllowed
  });
  assert.ok((historical.scopePaths as string[]).includes(ADDED));
  assert.ok(((historicalLock.taskDirectionLock as { allowedFiles: string[] }).allowedFiles).includes(ADDED));
  assert.equal(
    readTicketWriteGrant(historical.workAdmissionTicket).includes(ADDED),
    false,
    `${caseId}: historical projection leaves the added path out of the ticket`
  );

  const taskDocument = fixtureDocument([ORIGINAL], [ORIGINAL]);
  const outerLock = fixtureLock([ORIGINAL]);
  const result = applyAtomicScopeAmendment({
    taskDocument,
    outerLock,
    embeddedLockRecord: outerLock.taskDirectionLock as Record<string, unknown>,
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
          nowIso: '2026-08-14T00:00:02.000Z'
        });
      },
      writeLock: () => {},
      persistLedger: () => {}
    }
  });
  assert.ok(readTicketWriteGrant(result.ticket).includes(ADDED), `${caseId}: resealed ticket includes the added path`);
  assert.ok((result.taskDocument.scopePaths as string[]).includes(ADDED));
  assert.ok(((result.outerLock.taskDirectionLock as { allowedFiles: string[] }).allowedFiles).includes(ADDED));
  assert.ok(((result.taskDocument.claim as { files: string[] }).files).includes(ADDED));
  console.log(`[${caseId}] ok`);
}
