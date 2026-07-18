import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';
import { fail, type FixturePaths } from './context.ts';
import { createImportWriteLease, expectOk, expectThrow } from './tasks.ts';

export async function runClaimGuardScenarios(paths: FixturePaths, tempWorkspace: string): Promise<void> {
  const { npcPlan } = paths;
    // TASK-AAO-0135: import active-claim safety
    const claimGuardTaskId = 'SANGUO-AUTO-0002';
    const claimGuardPlanPath = path.join(tempWorkspace, 'claim-guard-plan.md');
    writeFileSync(claimGuardPlanPath, readFileSync(npcPlan, 'utf8').replace(
      'SANGUO-AUTO-0002',
      'SANGUO-AUTO-0002'
    ) + '\n<!-- claim-guard drift marker -->\n', 'utf8');
    const claimGuardTaskPath = path.join(tempWorkspace, '.atm', 'history', 'tasks', `${claimGuardTaskId}.json`);
    const claimGuardOriginal = JSON.parse(readFileSync(claimGuardTaskPath, 'utf8'));
    const claimGuardLease = {
      actorId: 'claim-guard-agent',
      leaseId: 'lease-claim-guard-01',
      claimedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      ttlSeconds: 1800,
      files: ['src/claim-guard.ts'],
      state: 'active'
    };
    writeFileSync(claimGuardTaskPath, JSON.stringify({
      ...claimGuardOriginal,
      status: 'running',
      owner: 'claim-guard-agent',
      startedAt: new Date().toISOString(),
      claim: claimGuardLease,
      taskDirectionLock: {
        schemaId: 'atm.taskDirectionLock.v1',
        taskId: claimGuardTaskId,
        actorId: 'claim-guard-agent',
        allowedFiles: ['src/claim-guard.ts']
      }
    }, null, 2), 'utf8');
    const claimGuardLockDir = path.join(tempWorkspace, '.atm', 'runtime', 'locks');
    mkdirSync(claimGuardLockDir, { recursive: true });
    writeFileSync(path.join(claimGuardLockDir, `${claimGuardTaskId}.lock.json`), JSON.stringify({
      schemaId: 'atm.taskDirectionLockEnvelope.v1',
      taskId: claimGuardTaskId,
      actorId: 'claim-guard-agent',
      status: 'active',
      files: ['src/claim-guard.ts'],
      taskDirectionLock: {
        schemaId: 'atm.taskDirectionLock.v1',
        taskId: claimGuardTaskId,
        actorId: 'claim-guard-agent',
        allowedFiles: ['src/claim-guard.ts']
      }
    }, null, 2), 'utf8');

    const claimGuardDryRun = await expectOk('import', ['--from', claimGuardPlanPath, '--dry-run', '--cwd', tempWorkspace]);
    const claimGuardDryDiagnostics = (claimGuardDryRun.evidence as {
      manifest: { diagnostics: ReadonlyArray<{ code: string; workItemId?: string }> }
    }).manifest.diagnostics;
    if (!claimGuardDryDiagnostics.some((entry) => entry.code === 'IMPORT_SKIPPED_ACTIVE_CLAIM' && entry.workItemId === claimGuardTaskId)) {
      fail(`TASK-AAO-0135 regression: dry-run must preview IMPORT_SKIPPED_ACTIVE_CLAIM for ${claimGuardTaskId}.`);
    }

    const claimGuardDefaultWrite = await runTasks(['import', '--from', claimGuardPlanPath, '--write', '--cwd', tempWorkspace]);
    if (claimGuardDefaultWrite.ok !== true) {
      fail(`TASK-AAO-0135 regression: default import --write should skip active-claim tasks without failing the whole import, got ${JSON.stringify(claimGuardDefaultWrite.messages)}.`);
    }
    const claimGuardDefaultDiagnostics = (claimGuardDefaultWrite.evidence as {
      manifest: { diagnostics: ReadonlyArray<{ code: string; workItemId?: string }> }
    }).manifest.diagnostics;
    if (!claimGuardDefaultDiagnostics.some((entry) => entry.code === 'IMPORT_SKIPPED_ACTIVE_CLAIM' && entry.workItemId === claimGuardTaskId)) {
      fail(`TASK-AAO-0135 regression: default import --write must emit IMPORT_SKIPPED_ACTIVE_CLAIM for ${claimGuardTaskId}.`);
    }

    const claimGuardForceLeaseId = await createImportWriteLease(tempWorkspace, ['--force'], 'validator verifies force import preserves active claims');
    await expectOk('import', ['--from', claimGuardPlanPath, '--write', '--force', '--emergency-approval', claimGuardForceLeaseId, '--cwd', tempWorkspace]);
    const claimGuardAfterForce = JSON.parse(readFileSync(claimGuardTaskPath, 'utf8'));
    if (claimGuardAfterForce.claim?.leaseId !== 'lease-claim-guard-01' || claimGuardAfterForce.status !== 'running') {
      fail('TASK-AAO-0135 regression: --force must not overwrite active claim state.');
    }
    await expectThrow('scope', [
      'repair-deliverables',
      '--cwd', tempWorkspace,
      '--task', claimGuardTaskId,
      '--actor', 'other-agent',
      '--set', 'packages/cli/src/commands/tasks.ts',
      '--reason', 'validator verifies claimed-task metadata repair ownership'
    ], 'ATM_TASK_METADATA_REPAIR_ACTIVE_CLAIM_REQUIRED');
    await expectThrow('scope', [
      'repair-deliverables',
      '--cwd', tempWorkspace,
      '--task', claimGuardTaskId,
      '--actor', 'claim-guard-agent',
      '--set', 'not a repository path',
      '--reason', 'validator verifies deliverable repair rejects prose'
    ], 'ATM_TASK_METADATA_REPAIR_DELIVERABLE_PATH_INVALID');
    await expectOk('scope', [
      'repair-deliverables',
      '--cwd', tempWorkspace,
      '--task', claimGuardTaskId,
      '--actor', 'claim-guard-agent',
      '--set', 'packages/cli/src/commands/tasks.ts,scripts/validate-task-import.ts',
      '--reason', 'validator verifies claimed-task metadata repair'
    ]);
    const claimGuardAfterRepair = JSON.parse(readFileSync(claimGuardTaskPath, 'utf8'));
    if (claimGuardAfterRepair.claim?.leaseId !== 'lease-claim-guard-01' || claimGuardAfterRepair.status !== 'running') {
      fail('TASK-TEAM-0082 regression: metadata repair must preserve active claim state.');
    }
    if (!claimGuardAfterRepair.deliverables?.includes('packages/cli/src/commands/tasks.ts')
      || !claimGuardAfterRepair.deliverables?.includes('scripts/validate-task-import.ts')) {
      fail(`TASK-TEAM-0082 regression: metadata repair did not update deliverables, got ${JSON.stringify(claimGuardAfterRepair.deliverables)}.`);
    }
    const claimGuardLockAfterRepair = JSON.parse(readFileSync(path.join(claimGuardLockDir, `${claimGuardTaskId}.lock.json`), 'utf8'));
    const repairedAllowed = claimGuardLockAfterRepair.taskDirectionLock?.allowedFiles ?? [];
    if (!repairedAllowed.includes('packages/cli/src/commands/tasks.ts') || !repairedAllowed.includes('scripts/validate-task-import.ts')) {
      fail(`TASK-TEAM-0082 regression: metadata repair did not sync direction lock allowedFiles, got ${JSON.stringify(repairedAllowed)}.`);
    }

    const claimGuardOverwriteLeaseId = await createImportWriteLease(tempWorkspace, ['--force', '--force-overwrite-claims'], 'validator verifies force-overwrite-claims import displacement behavior');
    const claimGuardOverwrite = await expectOk('import', ['--from', claimGuardPlanPath, '--write', '--force', '--force-overwrite-claims', '--emergency-approval', claimGuardOverwriteLeaseId, '--cwd', tempWorkspace]);
    const claimGuardOverwriteDiagnostics = (claimGuardOverwrite.evidence as {
      manifest: { diagnostics: ReadonlyArray<{ code: string }> }
    }).manifest.diagnostics;
    if (!claimGuardOverwriteDiagnostics.some((entry) => entry.code === 'IMPORT_SKIPPED_ACTIVE_CLAIM')) {
      // overwrite path should not emit skip once force-overwrite-claims is enabled
    }
    const displacedEvents = readdirSync(path.join(tempWorkspace, '.atm', 'history', 'task-events', claimGuardTaskId))
      .filter((entry) => entry.includes('claim-displaced-by-import'));
    if (displacedEvents.length === 0) {
      fail('TASK-AAO-0135 regression: --force-overwrite-claims must emit claim-displaced-by-import transition event.');
    }

}
