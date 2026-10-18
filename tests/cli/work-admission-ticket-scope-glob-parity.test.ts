import assert from 'node:assert/strict';
import { pathMatchesWriteScope } from '../../packages/core/src/broker/write-scope-policy.ts';
import { checkWorkAdmissionTicket, issueWorkAdmissionTicket, type WorkAdmissionOperation } from '../../packages/core/src/broker/work-admission-ticket.ts';
import { resolveTaskWorkAdmissionFiles } from '../../packages/cli/src/commands/tasks/claim-work-admission.ts';

const ticket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0025',
  actorId: 'fixture-actor',
  laneSessionId: 'lane-fixture',
  claimGeneration: 'claim-fixture',
  allowedFiles: [
    '.atm/history/evidence/TASK-GIT-0025.*',
    'packages/cli/src/commands/**/*.ts'
  ],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});

for (const operation of ['write', 'stage', 'commit', 'close', 'push'] as const satisfies readonly WorkAdmissionOperation[]) {
  const decision = checkWorkAdmissionTicket({
    ticket,
    taskId: 'TASK-GIT-0025',
    actorId: 'fixture-actor',
    laneSessionId: 'lane-fixture',
    claimGeneration: 'claim-fixture',
    files: ['.atm/history/evidence/TASK-GIT-0025.runner-sync-receipt.json', 'packages/cli/src/commands/next/route-resolution/pending-worktree.ts'],
    operation,
    now: '2026-07-29T00:01:00.000Z'
  });
  assert.equal(decision.ok, true, `${operation} must use the canonical glob matcher for ticket scope`);
}

const denied = checkWorkAdmissionTicket({
  ticket,
  taskId: 'TASK-GIT-0025',
  actorId: 'fixture-actor',
  laneSessionId: 'lane-fixture',
  claimGeneration: 'claim-fixture',
  files: ['docs/governance/error-code-registry.json'],
  operation: 'commit',
  now: '2026-07-29T00:01:00.000Z'
});
assert.equal(denied.code, 'ATM_WRITE_TICKET_SCOPE_VIOLATION');

const claimScope = resolveTaskWorkAdmissionFiles({
  workItemId: 'TASK-GIT-0025',
  taskDirectionLock: { allowedFiles: ['packages/cli/src/commands/next/playbook-projection/task-reservation-projection.ts'] }
}, []);
const claimTicket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  allowedFiles: claimScope,
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});
const lifecycleDecision = checkWorkAdmissionTicket({
  ticket: claimTicket, taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  files: ['.atm/history/evidence/TASK-GIT-0025.closure-packet.json', '.atm/history/task-events/TASK-GIT-0025/close.json', '.atm/history/tasks/TASK-GIT-0025.json'],
  operation: 'commit', now: '2026-07-29T00:01:00.000Z'
});
assert.equal(lifecycleDecision.ok, true, 'a claim ticket must authorize its own lifecycle close bundle');
const legacyTicket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  allowedFiles: ['packages/cli/src/commands/next/playbook-projection/task-reservation-projection.ts'],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});
assert.equal(checkWorkAdmissionTicket({
  ticket: legacyTicket, taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  files: ['.atm/history/evidence/TASK-GIT-0025.closure-packet.json'], operation: 'commit', now: '2026-07-29T00:01:00.000Z'
}).ok, true, 'legacy tickets must retain authority over their own lifecycle records');
assert.equal(checkWorkAdmissionTicket({
  ticket: legacyTicket, taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  files: ['.atm/history/evidence/git-head.jsonl'], operation: 'commit', now: '2026-07-29T00:01:00.000Z'
}).ok, true, 'every ticket must authorize the shared governed commit provenance record');
const directoryCases = [
  ['packages/*/dist/**', 'packages/cli/dist/index.js', true],
  ['packages/*/dist/**', 'packages/core/dist/nested/index.js', true],
  ['packages/*/dist/**', 'packages/cli/dist', true],
  ['packages/*/dist/**', 'packages/cli/src/index.ts', false],
  ['packages/*/dist/**', 'packages/cli/dist-private/index.js', false],
  ['packages/*/dist/**', 'other/packages/cli/dist/index.js', false],
  ['packages/*/dist/**', 'packages/group/cli/dist/index.js', false],
  ['packages/*/dist/**', 'packages/cli/dist/../dist-other/index.js', false],
  ['packages/*/dist/**', 'packages/cli/dist/../../src/secret.ts', false],
  ['packages/*/dist/**', 'packages/cli/dist/./index.js', false],
  ['packages/*/dist/**', 'packages//dist/index.js', false],
  ['packages/*/dist/**', 'packages\\cli\\dist\\..\\dist-other\\index.js', false],
  ['packages/../*/dist/**', 'packages/../cli/dist/index.js', false],
  ['packages/**/dist/**', 'packages/../outside/dist/index.js', false],
  ['**/dist/**', '../outside/dist/index.js', false],
  ['**/dist/**', 'C:/outside/dist/index.js', false],
  ['**/dist/**', 'D:\\foreign\\dist\\index.js', false],
  ['**/dist/**', 'C:outside/dist/index.js', false],
  ['**/dist/**', '/outside/dist/index.js', false],
  ['**/dist/**', '\\outside\\dist\\index.js', false],
  ['**/dist/**', '\\\\server\\share\\dist\\index.js', false],
  ['C:/outside/*/dist/**', 'C:/outside/cli/dist/index.js', false],
  ['packages/**/dist/**', 'packages/group/cli/dist/index.js', true],
  ['packages/**/dist/**', 'packages/dist/index.js', true],
  ['packages/**/dist/**', 'packages/dist', true],
  ['packages/**/dist/**', 'packages/group/cli/distribution/index.js', false],
  ['**/dist/**', 'dist/index.js', true],
  ['**/dist/**', 'dist', true],
  ['**/dist/**', 'other/dist/nested/index.js', true],
  ['packages/cli/dist/**', 'packages/cli/dist', true],
  ['packages/cli/dist/**', 'packages/cli/dist/index.js', true],
  ['packages/cli/dist/**', 'packages/cli/dist-other/index.js', false],
  ['packages/cli/dist/index.js', 'packages/cli/dist/index.js', true],
  ['packages/cli/dist/index.js', 'packages/cli/dist/other.js', false],
  ['packages/*/dist/**/*.js', 'packages/cli/dist/index.js', true],
  ['packages/*/dist/**/*.js', 'packages/cli/dist/nested/index.js', true],
  ['packages/*/dist/**/*.js', 'packages/cli/dist/nested/index.ts', false],
  ['packages/*/dist/**', '.\\packages\\cli\\dist\\index.js', true],
  ['packages\\*\\dist\\**', 'packages/cli/dist/index.js', true],
] as const;
for (const [grant, file, allowed] of directoryCases) {
  assert.equal(pathMatchesWriteScope(file, grant), allowed, grant + ' -> ' + file);
  const directoryTicket = issueWorkAdmissionTicket({
    taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture',
    claimGeneration: 'claim-fixture', allowedFiles: [grant],
    runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: '2026-07-29T00:00:00.000Z' },
    now: '2026-07-29T00:00:00.000Z'
  });
  for (const operation of ['write', 'stage', 'commit', 'close', 'push'] as const) {
    const request = {
      ticket: directoryTicket, taskId: 'TASK-GIT-0025', actorId: 'fixture-actor',
      laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
      files: [file], operation, now: '2026-07-29T00:01:00.000Z'
    };
    assert.equal(checkWorkAdmissionTicket(request).ok, allowed, operation + ': ' + grant + ' -> ' + file);
    if (allowed) {
      assert.equal(checkWorkAdmissionTicket({ ...request, actorId: 'foreign-actor' }).ok, false);
      assert.equal(checkWorkAdmissionTicket({ ...request, laneSessionId: 'foreign-lane' }).ok, false);
      assert.equal(checkWorkAdmissionTicket({ ...request, claimGeneration: 'foreign-claim' }).ok, false);
      assert.equal(checkWorkAdmissionTicket({ ...request, taskId: 'TASK-GIT-9999' }).ok, false);
      assert.equal(checkWorkAdmissionTicket({ ...request, now: '2026-08-01T00:00:00.000Z' }).ok, false);
      assert.equal(checkWorkAdmissionTicket({ ...request, ticket: null }).ok, false);
      if (operation === 'close' || operation === 'commit' || operation === 'push') {
        assert.equal(checkWorkAdmissionTicket({ ...request, ticket: { ...directoryTicket, origin: 'task-import' } }).ok, false);
      }
    }
  }
}
console.log('[work-admission-ticket-scope-glob-parity.test] ok');
