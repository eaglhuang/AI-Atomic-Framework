import assert from 'node:assert/strict';

import {
  buildTeamReworkRouteStateMachine,
  transitionTeamReworkRoute
} from '../../../packages/cli/src/commands/team.ts';

export async function runReworkRouteStateMachineValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'rework-route-state-machine') return false;

  const needsRework = buildTeamReworkRouteStateMachine({
    findings: [
      {
        source: 'reviewer',
        id: 'reviewer-blocking-finding',
        blocking: true,
        severity: 'blocker',
        summary: 'Reviewer found an implementation gap.'
      },
      {
        source: 'validator',
        id: 'validator-failure',
        passed: false,
        severity: 'error',
        summary: 'Focused validator failed.'
      }
    ],
    requiredChecksPassed: false,
    retryBudgetMax: 2,
    retryBudgetUsed: 0
  });
  assert.equal(needsRework.schemaId, 'atm.teamReworkRoute.v1');
  assert.equal(needsRework.status, 'needs-rework');
  assert.equal(needsRework.retryBudget.escalationTarget, null);
  assert.equal(needsRework.transitions[0].from, 'work-in-progress');
  assert.equal(needsRework.transitions[0].to, 'needs-rework');
  assert.deepEqual(needsRework.transitions[0].findingIds, ['reviewer-blocking-finding', 'validator-failure']);

  const readyForClose = transitionTeamReworkRoute(needsRework, {
    findings: [
      {
        source: 'validator',
        id: 'validator-revalidation-pass',
        passed: true,
        severity: 'info',
        summary: 'Focused validators passed after rework.'
      }
    ],
    requiredChecksPassed: true,
    retryBudgetUsed: 1
  });
  assert.equal(readyForClose.status, 'ready-for-close');
  assert.equal(readyForClose.retryBudget.escalationTarget, null);
  assert.ok(
    readyForClose.transitions.some((entry: any) => entry.from === 'needs-rework' && entry.to === 'revalidate-pending'),
    'rework completion must route through revalidate-pending'
  );
  assert.ok(
    readyForClose.transitions.some((entry: any) => entry.to === 'ready-for-close'),
    'required checks passing must formally route to ready-for-close'
  );

  const blocked = buildTeamReworkRouteStateMachine({
    findings: [
      {
        source: 'validator',
        id: 'retry-exhausted-validator-failure',
        passed: false,
        severity: 'error'
      }
    ],
    retryBudgetMax: 1,
    retryBudgetUsed: 1
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.retryBudget.remaining, 0);
  assert.equal(blocked.retryBudget.escalationTarget, 'captain');
  assert.ok(
    blocked.transitions.some((entry: any) => entry.to === 'blocked'),
    'retry exhaustion must route to blocked instead of looping'
  );

  const reviewerTextOnly = buildTeamReworkRouteStateMachine({
    findings: [
      {
        source: 'reviewer',
        id: 'advisory-review-note',
        blocking: false,
        severity: 'info'
      }
    ],
    requiredChecksPassed: false
  });
  assert.notEqual(reviewerTextOnly.status, 'ready-for-close');

  console.log('[validate-team-agents] ok (rework-route-state-machine)');
  return true;
}
