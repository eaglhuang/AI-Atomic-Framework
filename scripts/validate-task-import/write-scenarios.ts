import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';
import { assertImportedTaskContract } from './assertions.ts';
import { fail, root, type FixturePaths } from './context.ts';
import { createImportWriteLease, expectOk, expectThrow } from './tasks.ts';

export async function runWriteScenarios(paths: FixturePaths, workspace: string): Promise<void> {
  const { npcPlan, singleCard, dispatchMetadataCard } = paths;
  // Write mode against a temp workspace. The fixture intentionally uses
  // host-local IDs without a TASK- prefix to prove import preserves them.
  const tempWorkspace = workspace;

    execFileSync('git', ['init'], { cwd: tempWorkspace, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'ATM fixture'], { cwd: tempWorkspace, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'fixture@atm.local'], { cwd: tempWorkspace, stdio: 'ignore' });
    writeFileSync(path.join(tempWorkspace, '.gitkeep'), '', 'utf8');
    execFileSync('git', ['add', '.gitkeep'], { cwd: tempWorkspace, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture bootstrap'], { cwd: tempWorkspace, stdio: 'ignore' });
    const writeResult = await expectOk('import', ['--from', npcPlan, '--write', '--cwd', tempWorkspace]);
    const written = (writeResult.evidence as { writtenPaths: readonly string[] }).writtenPaths;
    if (written.length !== 2) {
      fail(`write mode expected 2 task files, got ${written.length}.`);
    }
    const taskStoreEntries = readdirSync(path.join(tempWorkspace, '.atm', 'history', 'tasks'));
    if (!taskStoreEntries.includes('SANGUO-AUTO-0001.json') || !taskStoreEntries.includes('SANGUO-AUTO-0002.json')) {
      fail(`write mode missing expected task files: ${taskStoreEntries.join(', ')}`);
    }
    const reportDir = path.join(tempWorkspace, '.atm', 'history', 'reports', 'task-import');
    if (!existsSync(reportDir) || readdirSync(reportDir).length === 0) {
      fail('write mode did not produce task-import evidence.');
    }
    const locksDir = path.join(tempWorkspace, '.atm', 'runtime', 'locks');
    if (existsSync(locksDir) && readdirSync(locksDir).length > 0) {
      fail('tasks import must not create runtime locks.');
    }

    const dispatchWriteResult = await expectOk('import', ['--from', dispatchMetadataCard, '--write', '--cwd', tempWorkspace]);
    const dispatchWritten = (dispatchWriteResult.evidence as { writtenPaths: readonly string[] }).writtenPaths;
    if (dispatchWritten.length !== 1 || !dispatchWritten[0].endsWith('TASK-FIXTURE-DISPATCH-0001.json')) {
      fail(`dispatch-metadata write expected TASK-FIXTURE-DISPATCH-0001.json, got ${JSON.stringify(dispatchWritten)}.`);
    }
    const dispatchWrittenTask = JSON.parse(readFileSync(path.join(tempWorkspace, '.atm', 'history', 'tasks', 'TASK-FIXTURE-DISPATCH-0001.json'), 'utf8'));
    if (!dispatchWrittenTask.dispatchPattern?.phase1?.lane || !dispatchWrittenTask.conditionReview?.length) {
      fail(`dispatch-metadata write must persist dispatchPattern and conditionReview, got ${JSON.stringify(dispatchWrittenTask)}.`);
    }

    const singleWriteResult = await expectOk('import', ['--from', singleCard, '--write', '--cwd', tempWorkspace]);
    const singleWritten = (singleWriteResult.evidence as { writtenPaths: readonly string[] }).writtenPaths;
    if (singleWritten.length !== 1 || !singleWritten[0].endsWith('TASK-FIXTURE-0001.json')) {
      fail(`single-card write expected TASK-FIXTURE-0001.json, got ${JSON.stringify(singleWritten)}.`);
    }
    const singleWrittenTask = JSON.parse(readFileSync(path.join(tempWorkspace, '.atm', 'history', 'tasks', 'TASK-FIXTURE-0001.json'), 'utf8'));
    assertImportedTaskContract(singleWrittenTask, 'single-card write');

    // verify should pass.
    const verifyResult = await expectOk('verify', ['--cwd', tempWorkspace]);
    const verifyReport = (verifyResult.evidence as { report: { inspectedTasks: number; ok: boolean } }).report;
    if (!verifyReport.ok || verifyReport.inspectedTasks < 2) {
      fail(`verify expected ok=true with at least 2 tasks, got ${JSON.stringify(verifyReport)}.`);
    }
    const nextResult = await runNext(['--cwd', tempWorkspace, '--prompt', 'SANGUO-AUTO-0001']);
    const nextQueue = (nextResult.evidence as { importedTaskQueue?: { openTaskCount: number; selectedTask?: { workItemId: string } | null } }).importedTaskQueue;
    if (!nextQueue || nextQueue.openTaskCount < 2 || nextQueue.selectedTask?.workItemId !== 'SANGUO-AUTO-0001') {
      fail(`next --prompt must surface the matching imported task without global fallback, got ${JSON.stringify(nextQueue)}.`);
    }
    const nextClaimResult = await runNext(['--cwd', tempWorkspace, '--claim', '--actor', 'fixture-agent', '--prompt', 'SANGUO-AUTO-0001']);
    if (nextClaimResult.ok !== true || !nextClaimResult.messages?.some((entry) => entry.code === 'ATM_NEXT_CLAIMED')) {
      fail(`next --claim must prepare and claim the prompt-scoped imported task, got ${JSON.stringify(nextClaimResult)}.`);
    }

    // Re-importing without --force is idempotent (no errors emitted).
    const secondImport = await expectOk('import', ['--from', npcPlan, '--write', '--cwd', tempWorkspace]);
    const secondManifest = (secondImport.evidence as { manifest: { diagnostics: ReadonlyArray<{ code: string }> } }).manifest;
    if (!secondManifest.diagnostics.some((entry) => entry.code === 'ATM_TASKS_IMPORT_UNCHANGED')) {
      fail('rerunning import without source changes should emit ATM_TASKS_IMPORT_UNCHANGED diagnostics.');
    }

    const resetLeaseId = await createImportWriteLease(tempWorkspace, ['--force', '--reset-open'], 'validator verifies protected reset-open import behavior');
    const resetImport = await expectOk('import', ['--from', npcPlan, '--write', '--force', '--reset-open', '--emergency-approval', resetLeaseId, '--cwd', tempWorkspace]);
    const resetWritten = (resetImport.evidence as { writtenPaths: readonly string[] }).writtenPaths;
    if (resetWritten.length !== 2) {
      fail(`--reset-open import expected to rewrite 2 task files, got ${resetWritten.length}.`);
    }

    // Sanity check that the verify report flags missing dependencies for tasks that point at unknown ids.
    const fakePath = path.join(tempWorkspace, '.atm', 'history', 'tasks', 'SANGUO-AUTO-0001.json');
    const original = readFileSync(fakePath, 'utf8');
    const mutated = original.replace('"dependencies": []', '"dependencies": ["SANGUO-AUTO-9999"]');
    if (mutated !== original) {
      const fs = await import('node:fs');
      fs.writeFileSync(fakePath, mutated, 'utf8');
      const verifyMissing = await runTasks(['verify', '--cwd', tempWorkspace]);
      const missingFindings = (verifyMissing.evidence as { report: { findings: ReadonlyArray<{ code: string }> } }).report.findings;
      if (!missingFindings.some((finding) => finding.code === 'ATM_TASKS_VERIFY_DEPENDENCY_MISSING')) {
        fail('verify must report ATM_TASKS_VERIFY_DEPENDENCY_MISSING when a task references an unknown id.');
      }
    }

    // TASK-AAO-0064 單元測試：驗證 --strict-paths 與 deliverables 優先級 (L1 & L2)
    const strictTestPath = path.join(tempWorkspace, 'strict-test-plan.md');
    const fs = await import('node:fs');
    fs.writeFileSync(strictTestPath, `---
task_id: TASK-STRICT-0001
title: Strict Path Verification Test
status: planned
scopePaths:
  - "packages/cli/src/commands/tasks.ts"
deliverables:
  - "packages/cli/src/commands/tasks.ts"
  - "contaminated path containing the word"
---

## Deliverables
- Some valid path packages/cli/src/commands/tasks.ts
- Some other body path.
`, 'utf8');

    // 1. 驗證預設模式 (dry-run) 下應產生 IMPORT_BODY_SECTION_IGNORED 警告，且 deliverables 僅採用 frontmatter
    const defaultImportResult = await expectOk('import', ['--from', strictTestPath, '--dry-run', '--cwd', tempWorkspace]);
    const defaultManifest = (defaultImportResult.evidence as any).manifest;

    const importedTask = defaultManifest.tasks[0];
    const hasBodyIgnoredWarning = importedTask.importDiagnostics.some((d: any) => d.code === 'IMPORT_BODY_SECTION_IGNORED');
    if (!hasBodyIgnoredWarning) {
      fail('Strict test card: expected IMPORT_BODY_SECTION_IGNORED diagnostic warning but none found.');
    }

    if (importedTask.deliverables.length !== 1 || !importedTask.deliverables.includes('packages/cli/src/commands/tasks.ts')) {
      fail(`Strict test card: expected prose deliverables to normalize to scope paths, got ${JSON.stringify(importedTask.deliverables)}.`);
    }

    // 2. Default mode must record the deterministic normalization.
    const hasNormalizationWarning = defaultManifest.diagnostics.some((d: any) => d.code === 'ATM_TASK_IMPORT_DELIVERABLES_NORMALIZED');
    if (!hasNormalizationWarning) {
      fail('Strict test card: expected ATM_TASK_IMPORT_DELIVERABLES_NORMALIZED diagnostic warning in default mode.');
    }

    // 3. Strict mode preserves the fail-closed error rather than normalizing.
    await expectThrow('import', ['--from', strictTestPath, '--dry-run', '--strict-paths', '--cwd', tempWorkspace], 'ATM_TASK_IMPORT_DELIVERABLE_PATH_INVALID');

    // TASK-AAO-0123: 驗證 import refresh 時保護 active claim 與 taskDirectionLock
    const activeTaskId = 'SANGUO-AUTO-0001';
    const activeTaskPath = path.join(tempWorkspace, '.atm', 'history', 'tasks', `${activeTaskId}.json`);
    const originalTaskJson = JSON.parse(readFileSync(activeTaskPath, 'utf8'));
    const mockClaim = {
      schemaId: 'atm.claimLeaseRecord.v1',
      claimLeaseId: 'lease-test-1234',
      leaseId: 'lease-test-1234',
      taskId: activeTaskId,
      actorId: 'test-agent',
      sessionId: 'session-test-5678',
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      files: ['src/dummy.ts'],
      state: 'active'
    };
    const mockLock = {
      schemaId: 'atm.taskDirectionLock.v1',
      taskId: activeTaskId,
      actorId: 'test-agent',
      allowedFiles: ['src/dummy.ts'],
      planningReadOnlyPaths: [],
      planningMirrorPaths: []
    };
    const claimedTaskJson = {
      ...originalTaskJson,
      status: 'running',
      owner: 'test-agent',
      startedAt: new Date().toISOString(),
      startedBySessionId: 'session-test-5678',
      claim: mockClaim,
      taskDirectionLock: mockLock
    };
    writeFileSync(activeTaskPath, JSON.stringify(claimedTaskJson, null, 2), 'utf8');

    const forceLeaseId = await createImportWriteLease(tempWorkspace, ['--force'], 'validator verifies protected force import active claim refresh behavior');
    await expectOk('import', ['--from', npcPlan, '--write', '--force', '--emergency-approval', forceLeaseId, '--cwd', tempWorkspace]);

    const refreshedTaskJson = JSON.parse(readFileSync(activeTaskPath, 'utf8'));
    if (refreshedTaskJson.status !== 'running') {
      fail(`TASK-AAO-0123 regression: status running was overwritten to ${refreshedTaskJson.status}`);
    }
    if (!refreshedTaskJson.claim || refreshedTaskJson.claim.claimLeaseId !== 'lease-test-1234') {
      fail(`TASK-AAO-0123 regression: active claim was removed or overwritten during refresh.`);
    }
    if (!refreshedTaskJson.taskDirectionLock || refreshedTaskJson.taskDirectionLock.taskId !== activeTaskId) {
      fail(`TASK-AAO-0123 regression: taskDirectionLock was removed or overwritten during refresh.`);
    }
    if (refreshedTaskJson.owner !== 'test-agent' || refreshedTaskJson.startedBySessionId !== 'session-test-5678') {
      fail(`TASK-AAO-0123 regression: active actor/session fields were removed or overwritten.`);
    }

}
