// ATM-GOV-0348 regression test.
//
// caseId: test_commit_admission_ticket_scoped_selection_0348
// semanticKey: commit_admission_reads_the_ticket_bundle_not_the_whole_staged_index
// coversAcceptance: ACC-1, ACC-2, ACC-3
// coversImpactEdges: foreign-staged-path-to-commit-admission-denial, admission-denial-to-coerced-foreign-index-mutation
// contractEdge: commit-work-admission-file-selection
//
// caseId: test_foreign_staged_bytes_survive_scoped_admission_0348
// semanticKey: foreign_staged_bytes_are_unchanged_across_an_unflagged_admitted_commit
// coversAcceptance: ACC-4
// coversImpactEdges: admission-denial-to-coerced-foreign-index-mutation
// contractEdge: commit-work-admission-file-selection
//
// A governed commit must be admitted on the paths it will actually write. When
// in-scope work is staged the commit resolves a task-scoped bundle, and the
// sealed candidate index keeps everything else out of the commit — so judging
// that commit against unrelated entries in the shared index denies it for
// something it cannot do. The denial is not merely noisy: the only documented
// way past it unstages another lane's paths, which is the exact mutation this
// governance forbids.
//
// Runnable directly via:
//   node --strip-types tests/cli/commit-admission-ticket-scoped-selection.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { selectTicketValidatedCommitFiles } from '../../packages/cli/src/commands/git-governance.ts';
import { evaluateTaskWorkAdmissionGate } from '../../packages/cli/src/commands/git-governance/work-admission-check.ts';

const TASK_ID = 'TASK-GOV-0348-FIXTURE';
const OWNED = 'packages/cli/src/commands/git-governance.ts';
const FOREIGN = [
  '.atm/history/evidence/ATM-GOV-0346.closure-packet.json',
  '.atm/history/tasks/ATM-GOV-0346.json'
];

function ticketWithGrant(values: readonly string[]): any {
  return {
    schemaId: 'atm.workAdmissionTicket.v1',
    taskId: TASK_ID,
    grants: [
      { kind: 'file-write', values: [...values] },
      { kind: 'lifecycle-operation', values: ['commit'] }
    ]
  };
}

// --- ACC-1 / ACC-3: in-scope staged work is admitted on its own bundle, with
// no flag, no matter what else is sitting in the shared index.

{
  const ticket = ticketWithGrant([OWNED]);
  const staged = [OWNED, ...FOREIGN];

  const selected = selectTicketValidatedCommitFiles(staged, ticket, false, false);
  assert.deepEqual(
    [...selected],
    [OWNED],
    'admission must see the task-scoped bundle, not every path that happens to be staged'
  );
  for (const foreign of FOREIGN) {
    assert.equal(
      selected.includes(foreign),
      false,
      `${foreign} belongs to another task and will not be committed, so it must not be judged here`
    );
  }
}

// The deferral flag must no longer be what decides scoping. It governs whether
// foreign entries get snapshotted and unstaged, and nothing else.
{
  const ticket = ticketWithGrant([OWNED]);
  const staged = [OWNED, ...FOREIGN];
  assert.deepEqual(
    [...selectTicketValidatedCommitFiles(staged, ticket, false, false)],
    [...selectTicketValidatedCommitFiles(staged, ticket, true, false)],
    'scoping must not depend on --defer-foreign-staged'
  );
}

// --- ACC-2: scoping must not become a way past the gate.
//
// With no in-scope staged work there is no task-scoped bundle, so the governed
// commit falls back to the whole staged surface. Admission must then see that
// whole surface, or an out-of-scope path would be committed unjudged.

{
  const ticket = ticketWithGrant([OWNED]);
  const staged = [...FOREIGN];
  const selected = selectTicketValidatedCommitFiles(staged, ticket, false, false);
  assert.deepEqual(
    [...selected].sort(),
    [...FOREIGN].sort(),
    'with nothing in scope staged, admission must still judge the full staged surface'
  );
}

// An absent ticket is never a licence to narrow the admission surface.
{
  const staged = [OWNED, ...FOREIGN];
  assert.deepEqual(
    [...selectTicketValidatedCommitFiles(staged, null as any, false, false)].sort(),
    [...staged].sort()
  );
}

// --auto-stage reaches admission before it has staged anything, so nothing in
// scope is staged yet even though the commit is provably task-scoped. It must
// be judged on the bundle it declares, whether or not deferral is also asked
// for — otherwise the identical defect survives in the other branch, which is
// exactly what a real `git commit --auto-stage` hits.
{
  const ticket = ticketWithGrant([OWNED]);
  for (const deferred of [false, true]) {
    assert.deepEqual(
      [...selectTicketValidatedCommitFiles(FOREIGN, ticket, deferred, true)],
      [OWNED],
      `auto-stage must be admitted on its declared bundle (deferForeignStaged=${deferred})`
    );
  }
  assert.deepEqual(
    [...selectTicketValidatedCommitFiles([], ticket, true, true)],
    [OWNED],
    'a deferred commit with an empty index must still resolve its own scope for auto-staging'
  );
}

// --- ACC-1 end to end: the real gate admits the scoped selection.

{
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-admission-scope-'));
  try {
    const taskPath = path.join(root, '.atm', 'history', 'tasks', `${TASK_ID}.json`);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    const ticket = {
      schemaId: 'atm.workAdmissionTicket.v1',
      specVersion: '0.1.0',
      ticketId: 'wat-0348fixture',
      ticketDigest: 'sha256:0348fixture',
      taskId: TASK_ID,
      origin: 'claim',
      actorId: 'claude-008-gov-0348',
      laneSessionId: 'lane-0348',
      claimGeneration: 'lease-0348',
      issuedAt: '2026-08-11T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      scopeDigest: 'sha256:scope0348',
      runnerSelection: null,
      grants: [
        { kind: 'file-write', values: [OWNED] },
        { kind: 'lifecycle-operation', values: ['commit'] }
      ]
    };
    writeFileSync(
      taskPath,
      JSON.stringify({
        workItemId: TASK_ID,
        status: 'running',
        claim: {
          state: 'active',
          actorId: 'claude-008-gov-0348',
          laneSession: { laneSessionId: 'lane-0348' },
          leaseId: 'lease-0348'
        },
        deliverables: [OWNED],
        workAdmissionTicket: ticket
      }),
      'utf8'
    );

    const staged = [OWNED, ...FOREIGN];
    const selected = selectTicketValidatedCommitFiles(staged, ticket as any, false, false);
    const decision = evaluateTaskWorkAdmissionGate({
      cwd: root,
      taskId: TASK_ID,
      operation: 'commit',
      files: selected,
      producingAtmCommand: 'node atm.mjs git commit',
      now: '2026-08-11T00:01:00.000Z'
    }).decision;
    assert.equal(
      decision.ok,
      true,
      `an in-scope governed commit must be admitted beside foreign staged paths, got ${decision.code}: ${decision.reason}`
    );

    // ACC-2 again, through the real gate: an out-of-scope path in the admission
    // list must still be refused.
    const unscoped = evaluateTaskWorkAdmissionGate({
      cwd: root,
      taskId: TASK_ID,
      operation: 'commit',
      files: [OWNED, 'packages/core/src/broker/work-admission-ticket.ts'],
      producingAtmCommand: 'node atm.mjs git commit',
      now: '2026-08-11T00:01:00.000Z'
    }).decision;
    assert.equal(unscoped.ok, false, 'a path outside the grant must still be denied');
    assert.equal(unscoped.code, 'ATM_WRITE_TICKET_SCOPE_VIOLATION');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- ACC-4: foreign staged bytes are untouched across a scoped admission.
//
// Selection is a pure decision, so the proof here is that deciding admission
// never reaches the index at all: the staged blob ids are identical before and
// after, with no deferral flag involved.

{
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-admission-bytes-'));
  const git = (args: readonly string[]) =>
    execFileSync('git', [...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git(['init', '--quiet']);
    git(['config', 'user.name', 'fixture']);
    git(['config', 'user.email', 'fixture@example.com']);
    for (const relative of [OWNED, ...FOREIGN]) {
      const absolute = path.join(root, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, `content of ${relative}\n`, 'utf8');
    }
    git(['add', '--', OWNED, ...FOREIGN]);
    const before = git(['ls-files', '-s', '--', ...FOREIGN]);

    selectTicketValidatedCommitFiles([OWNED, ...FOREIGN], ticketWithGrant([OWNED]), false, false);

    assert.equal(
      git(['ls-files', '-s', '--', ...FOREIGN]),
      before,
      'resolving admission scope must never touch another lane index bytes'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('[commit-admission-ticket-scoped-selection] ok');
