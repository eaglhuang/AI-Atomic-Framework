import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CliError } from '../../../packages/cli/src/commands/shared.ts';
import { runTeam } from '../../../packages/cli/src/commands/team.ts';
import { assertRejectsCliError } from './assertions.ts';

export async function runTeamLifecycleVerbsValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'team-lifecycle-verbs') return false;

    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-lifecycle-verbs');
    const taskId = 'TASK-TEAM-LIFECYCLE-0001';
    const teamRunId = 'team-lifecycle-fixture';
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId,
      actorId: 'coordinator',
      status: 'active',
      executionMode: 'manual-team',
      agentsSpawned: false,
      leases: [],
      permissionLeases: [],
      teamSummary: {
        decision: 'fixture',
        closeReady: false
      },
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');

    try {
      const lease = await runTeam([
        'lease',
        '--team',
        teamRunId,
        '--actor',
        'implementer-typescript',
        '--permission',
        'file.write',
        '--paths',
        'packages/cli/src/commands/team.ts,scripts/validate-team-agents.ts',
        '--reason',
        'validator fixture lease',
        '--cwd',
        cwd,
        '--json'
      ]);
      assert.equal(lease.ok, true);
      assert.equal((lease.evidence as any)?.status, 'active');
      assert.equal((lease.evidence as any)?.leaseCount, 1);

      const afterLease = JSON.parse(readFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), 'utf8'));
      assert.equal(afterLease.permissionLeases.length, 1);
      assert.equal(afterLease.permissionLeases[0].permission, 'file.write');
      assert.equal(afterLease.permissionLeases[0].agentId, 'implementer-typescript');
      assert.deepEqual(afterLease.permissionLeases[0].paths, [
        'packages/cli/src/commands/team.ts',
        'scripts/validate-team-agents.ts'
      ]);
      assert.equal(afterLease.lifecycleEvents[0].type, 'lease.granted');

      await assert.rejects(
        () => runTeam([
          'lease',
          '--team',
          teamRunId,
          '--actor',
          'implementer',
          '--permission',
          'file.write',
          '--paths',
          'packages/cli/src/commands/team.ts',
          '--reason',
          'conflicting lease fixture',
          '--cwd',
          cwd,
          '--json'
        ]),
        (error: unknown) => {
          assert.ok(error instanceof CliError);
          assert.equal(error.code, 'ATM_TEAM_LEASE_CONFLICT');
          const details = error.details as any;
          assert.equal(details.currentOwner, 'implementer-typescript');
          assert.deepEqual(details.currentOwnerPaths, [
            'packages/cli/src/commands/team.ts',
            'scripts/validate-team-agents.ts'
          ]);
          assert.equal(
            details.currentOwnerReleaseCommand,
            `node atm.mjs team release --team ${teamRunId} --actor implementer-typescript --permission file.write --json`
          );
          assert.equal(details.activeLeases[0].agentId, 'implementer-typescript');
          assert.equal(details.requiredCommand, details.currentOwnerReleaseCommand);
          return true;
        }
      );

      await assert.rejects(
        () => runTeam([
          'release',
          '--team',
          teamRunId,
          '--actor',
          'implementer',
          '--permission',
          'file.write',
          '--reason',
          'wrong holder release fixture',
          '--cwd',
          cwd,
          '--json'
        ]),
        (error: unknown) => {
          assert.ok(error instanceof CliError);
          assert.equal(error.code, 'ATM_TEAM_LEASE_NOT_FOUND');
          const details = error.details as any;
          assert.equal(details.actorId, 'implementer');
          assert.equal(details.holderCount, 1);
          assert.equal(details.activeLeases[0].agentId, 'implementer-typescript');
          assert.equal(
            details.requiredCommand,
            `node atm.mjs team release --team ${teamRunId} --actor implementer-typescript --permission file.write --json`
          );
          return true;
        }
      );

      const release = await runTeam([
        'release',
        '--team',
        teamRunId,
        '--actor',
        'implementer-typescript',
        '--permission',
        'file.write',
        '--reason',
        'validator fixture release',
        '--cwd',
        cwd,
        '--json'
      ]);
      assert.equal(release.ok, true);
      assert.equal((release.evidence as any)?.leaseCount, 0);

      const complete = await runTeam([
        'complete',
        '--team',
        teamRunId,
        '--actor',
        'coordinator',
        '--reason',
        'validator fixture complete',
        '--cwd',
        cwd,
        '--json'
      ]);
      assert.equal(complete.ok, true);
      assert.equal((complete.evidence as any)?.status, 'completed');
      assert.equal((complete.evidence as any)?.teamRun?.status, 'completed');
      assert.equal(typeof (complete.evidence as any)?.teamRun?.completedAt, 'string');

      const finalRun = JSON.parse(readFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), 'utf8'));
      assert.equal(finalRun.status, 'completed');
      assert.equal(finalRun.completedBy, 'coordinator');
      assert.equal(finalRun.teamSummary.closeReady, true);
      assert.deepEqual(finalRun.lifecycleEvents.map((event: any) => event.type), [
        'lease.granted',
        'lease.released',
        'team.completed'
      ]);

      const postCompleteBlocked = await assertRejectsCliError(
        () => runTeam(['abandon', '--team', teamRunId, '--actor', 'coordinator', '--cwd', cwd, '--json']),
        'ATM_TEAM_RUN_NOT_ACTIVE'
      );
      assert.equal(postCompleteBlocked.details?.status, 'completed');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (team-lifecycle-verbs)');
    return true;
}
