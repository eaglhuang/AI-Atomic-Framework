/**
 * ATM-GOV-0364. Guards the two defects that made every in-flight scope change
 * expensive, and guards the two findings that verification withdrew so they are
 * not re-reported as bugs by the next person who reads a truncated response.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasPreservableClaimState,
  syncScopeAmendmentScopePaths
} from '../../packages/cli/src/commands/tasks/legacy/implementation.ts';
import { scopeOptionsToSubcommand } from '../../packages/cli/src/commands/shared/command-spec-output.ts';
import tasksCommandSpec from '../../packages/cli/src/commands/command-specs/tasks.spec.ts';

// test_atm_gov_0364_scope_amendment_reaches_the_delivery_bundle
// The delivery bundle resolves from scopePaths. An amendment that reaches only
// the direction lock authorises an edit that can never be committed.
{
  const taskDocument: Record<string, unknown> = {
    scopePaths: ['packages/core/src/a.ts', 'tests/cli/a.test.ts']
  };
  syncScopeAmendmentScopePaths({
    taskDocument,
    mergedAllowed: ['packages/core/src/a.ts', 'tests/cli/a.test.ts', 'docs/reports/amended.json']
  });
  assert.deepEqual(
    taskDocument.scopePaths,
    ['packages/core/src/a.ts', 'tests/cli/a.test.ts', 'docs/reports/amended.json'],
    'an amended path must reach scopePaths, or the governed commit bundle will silently exclude it'
  );
}

// Union, never replace. An amendment adds reach; it does not redefine the card.
{
  const taskDocument: Record<string, unknown> = {
    scopePaths: ['packages/core/src/a.ts', 'packages/core/src/b.ts']
  };
  syncScopeAmendmentScopePaths({ taskDocument, mergedAllowed: ['docs/reports/only-this.json'] });
  assert.deepEqual(taskDocument.scopePaths, [
    'packages/core/src/a.ts',
    'packages/core/src/b.ts',
    'docs/reports/only-this.json'
  ]);
}

// Idempotent: re-applying the same amendment does not duplicate or reorder.
{
  const taskDocument: Record<string, unknown> = { scopePaths: ['packages/core/src/a.ts'] };
  const allowed = ['packages/core/src/a.ts', 'docs/reports/amended.json'];
  syncScopeAmendmentScopePaths({ taskDocument, mergedAllowed: allowed });
  const first = [...(taskDocument.scopePaths as string[])];
  syncScopeAmendmentScopePaths({ taskDocument, mergedAllowed: allowed });
  assert.deepEqual(taskDocument.scopePaths, first);
}

// Windows separators must not create a second entry for the same file.
{
  const taskDocument: Record<string, unknown> = { scopePaths: ['packages/core/src/a.ts'] };
  syncScopeAmendmentScopePaths({ taskDocument, mergedAllowed: ['packages\\core\\src\\a.ts'] });
  assert.deepEqual(taskDocument.scopePaths, ['packages/core/src/a.ts']);
}

// A task with no declared scope still receives the amendment.
{
  const taskDocument: Record<string, unknown> = {};
  syncScopeAmendmentScopePaths({ taskDocument, mergedAllowed: ['docs/reports/amended.json'] });
  assert.deepEqual(taskDocument.scopePaths, ['docs/reports/amended.json']);
}

// test_atm_gov_0364_import_refresh_preserves_its_own_claim
// Whether a claim record parses cleanly is a question about its shape; whether
// it is someone's live hold is a question about its state. Only the second may
// decide whether --force discards it.
{
  const fullyFormed = {
    claim: { actorId: 'a', leaseId: 'lease-1', state: 'active', claimedAt: '2026-08-13T00:00:00.000Z' }
  };
  assert.equal(hasPreservableClaimState(fullyFormed), true);

  const liveButUnparseable = { claim: { actorId: 'a', state: 'active' } };
  assert.equal(
    hasPreservableClaimState(liveButUnparseable),
    true,
    'a live claim missing an optional field is still someone holding the task'
  );

  const handoff = { claim: { actorId: 'a', state: 'handoff' } };
  assert.equal(hasPreservableClaimState(handoff), true);

  assert.equal(hasPreservableClaimState({ claim: { actorId: 'a', state: 'released' } }), false);
  assert.equal(hasPreservableClaimState({ claim: { actorId: 'a', state: '' } }), false);
  assert.equal(hasPreservableClaimState({}), false);
  assert.equal(hasPreservableClaimState(null), false);
  assert.equal(hasPreservableClaimState({ claim: 'active' }), false, 'a non-object claim is not a claim');
  assert.equal(hasPreservableClaimState({ claim: [] }), false);
}

// test_atm_gov_0364_withdrawn_findings_stay_withdrawn
// Two findings this card originally asserted were withdrawn after verification.
// If either is ever reopened, it must be on fresh evidence rather than by
// quietly flipping the record back.
{
  const readItem = (id: string) =>
    JSON.parse(readFileSync(`docs/governance/atm-bug-and-optimization-backlog.items/${id}.json`, 'utf8'));

  for (const id of ['ATM-BUG-2026-08-13-009', 'ATM-BUG-2026-08-13-010']) {
    const item = readItem(id);
    assert.match(
      String(item.status),
      /^(Resolved|Closed — .*withdrawn)/,
      `${id} was withdrawn after verification and must stay withdrawn`
    );
    assert.match(
      String(item.area),
      /^Withdrawn: /,
      `${id} must say plainly in its area that it is withdrawn, not merely be marked resolved`
    );
    assert.match(
      String(item.followUp),
      /No product change/,
      `${id} must record that nothing was changed in the product, so it is never mistaken for a fix`
    );
  }

  // The defects that survived verification must still be open, or resolved with
  // a real fix — never quietly withdrawn alongside the two that were not real.
  for (const id of ['ATM-BUG-2026-08-13-007', 'ATM-BUG-2026-08-13-008']) {
    const item = readItem(id);
    assert.doesNotMatch(
      String(item.area),
      /^Withdrawn: /,
      `${id} was reproduced with command-backed evidence and cannot be withdrawn`
    );
  }
}

// test_atm_gov_0364_help_is_scoped_to_the_subcommand
// A flag that belongs only to a sibling subcommand must not be offered.
{
  const options = [
    { flag: '--from', subcommands: ['import'] },
    { flag: '--map', subcommands: ['realign-plan-source'] },
    { flag: '--wip-commit', subcommands: ['release'] },
    { flag: '--cwd' },
    { flag: '--json' }
  ];
  const scoped = scopeOptionsToSubcommand(options, 'import');
  assert.deepEqual(scoped.options.map((entry) => entry.flag), ['--from', '--cwd', '--json']);
  assert.equal(scoped.declared, 1);
  assert.equal(scoped.undeclared, 2, 'flags with no declared owner are listed, and counted so the gap is visible');

  // An undeclared subcommand is not silently treated as "everything matches".
  const unknown = scopeOptionsToSubcommand(options, 'audit');
  assert.deepEqual(unknown.options.map((entry) => entry.flag), ['--cwd', '--json']);
  assert.equal(unknown.declared, 0);

  // An empty subcommand means no question was asked; nothing is filtered.
  assert.equal(scopeOptionsToSubcommand(options, '').options.length, options.length);
}

// The real tasks spec must actually narrow, or the seam is decoration.
{
  const all = tasksCommandSpec.options ?? [];
  const scoped = scopeOptionsToSubcommand(all, 'import');
  assert.ok(all.length > 0, 'the tasks spec must declare options');
  assert.ok(
    scoped.options.length < all.length,
    `tasks import --help must be narrower than the tasks namespace; got ${scoped.options.length} of ${all.length}`
  );
  const flags = new Set(scoped.options.map((entry) => entry.flag));
  assert.ok(flags.has('--from'), 'tasks import must still offer the flag it actually requires');
  for (const foreign of ['--map', '--wip-commit', '--discard-wip', '--reserved-ok', '--all-stale', '--apply']) {
    assert.equal(flags.has(foreign), false, `${foreign} belongs to another subcommand and must not appear under import`);
  }
}

console.log('governance-round-trip-cost.test.ts: ok');
