import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { classifyGuidanceIntent } from '../packages/core/src/guidance/intent-classifier.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(text: string): void {
  console.error(`[task-import:${mode}] ${text}`);
  process.exitCode = 1;
}

async function expectOk(action: string, argv: string[]) {
  const result = await runTasks([action, ...argv]);
  if (!result.ok) {
    fail(`tasks ${action} ${argv.join(' ')} failed: ${result.messages.map((m) => `${m.code} ${m.text}`).join(' | ')}`);
  }
  return result;
}

async function expectThrow(action: string, argv: string[], expectedCode: string) {
  try {
    await runTasks([action, ...argv]);
    fail(`tasks ${action} ${argv.join(' ')} expected to throw ${expectedCode} but succeeded.`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== expectedCode) {
      fail(`tasks ${action} ${argv.join(' ')} expected ${expectedCode} but threw ${code ?? 'unknown'}: ${(error as Error).message}`);
    }
  }
}

async function main() {
  const samplePlan = path.join(root, 'fixtures/task-plan-import/sample-plan.md');
  const npcPlan = path.join(root, 'fixtures/task-plan-import/low-automation-plan.md');
  const singleCard = path.join(root, 'fixtures/task-plan-import/single-card.md');
  const duplicatePlan = path.join(root, 'fixtures/task-plan-import/duplicate-plan.md');
  const governanceTablePlan = path.join(root, 'fixtures/task-plan-import/governance-table-plan.md');
  const chineseBootstrapPlan = path.join(root, 'fixtures/task-plan-import/chinese-bootstrap-plan.md');

  for (const fixturePath of [samplePlan, npcPlan, singleCard, duplicatePlan, governanceTablePlan, chineseBootstrapPlan]) {
    if (!existsSync(fixturePath)) {
      fail(`missing fixture: ${path.relative(root, fixturePath)}`);
      return;
    }
  }

  // Dry-run on sample plan should succeed and detect both tasks.
  const guideIntent = classifyGuidanceIntent('open task cards from this plan', { adapterStatus: 'available' });
  if (guideIntent.matchedIntent !== 'task-plan-import' || !guideIntent.nextCommand.includes('tasks import')) {
    fail(`guide intent must route task-plan-import to tasks import, got ${JSON.stringify(guideIntent)}.`);
  }

  // Dry-run on sample plan should succeed and detect both tasks.
  const dryRunResult = await expectOk('import', ['--from', samplePlan, '--dry-run', '--cwd', root]);
  const manifest = (dryRunResult.evidence as { manifest: { tasks: ReadonlyArray<{ workItemId: string }> } }).manifest;
  if (manifest.tasks.length !== 2) {
    fail(`sample-plan dry-run expected 2 tasks, got ${manifest.tasks.length}.`);
  }
  if (manifest.tasks.find((task) => task.workItemId === 'TASK-EXAMPLE-0002')?.['workItemId' as never] !== 'TASK-EXAMPLE-0002') {
    fail('sample-plan dry-run did not record TASK-EXAMPLE-0002.');
  }

  // Table-based plans should preserve title, milestone, status, and dependencies.
  const governanceTableResult = await expectOk('import', ['--from', governanceTablePlan, '--dry-run', '--cwd', root]);
  const governanceTasks = (governanceTableResult.evidence as {
    manifest: {
      tasks: ReadonlyArray<{
        workItemId: string;
        title: string;
        milestone: string | null;
        status: string;
        dependencies: readonly string[];
      }>;
    };
  }).manifest.tasks;
  const gov0101 = governanceTasks.find((task) => task.workItemId === 'ATM-GOV-0101');
  if (!gov0101 || gov0101.title !== 'Actor Identity Registry and Git Identity Contract' || gov0101.milestone !== 'M1' || gov0101.status !== 'open') {
    fail(`governance-table plan parsed ATM-GOV-0101 incorrectly: ${JSON.stringify(gov0101)}.`);
  }
  const gov0105 = governanceTasks.find((task) => task.workItemId === 'ATM-GOV-0105');
  if (!gov0105 || gov0105.dependencies.join(',') !== 'ATM-GOV-0101,ATM-GOV-0102') {
    fail(`governance-table plan parsed ATM-GOV-0105 dependencies incorrectly: ${JSON.stringify(gov0105)}.`);
  }
  const gov0111 = governanceTasks.find((task) => task.workItemId === 'ATM-GOV-0111');
  if (!gov0111 || gov0111.status !== 'done') {
    fail(`governance-table plan should preserve done status for ATM-GOV-0111: ${JSON.stringify(gov0111)}.`);
  }

  const chineseResult = await expectOk('import', ['--from', chineseBootstrapPlan, '--dry-run', '--cwd', root]);
  const chineseTasks = (chineseResult.evidence as {
    manifest: { tasks: ReadonlyArray<{ workItemId: string; title: string; dependencies: readonly string[]; deliverables: readonly string[] }> };
  }).manifest.tasks;
  if (chineseTasks.length !== 2 || !chineseTasks.some((task) => task.workItemId === 'SANGUO-BOOTSTRAP-0001')) {
    fail(`Chinese bootstrap plan expected 2 SANGUO tasks, got ${JSON.stringify(chineseTasks)}.`);
  }
  const chinese0101 = chineseTasks.find((task) => task.workItemId === 'SANGUO-BOOTSTRAP-0101');
  if (!chinese0101 || chinese0101.dependencies.join(',') !== 'SANGUO-BOOTSTRAP-0001' || !chinese0101.deliverables.includes('wave-001 job builder runner')) {
    fail(`Chinese bootstrap plan parsed 0101 incorrectly: ${JSON.stringify(chinese0101)}.`);
  }

  // Single-card import via YAML front matter should yield one task.
  const singleResult = await expectOk('import', ['--from', singleCard, '--dry-run', '--cwd', root]);
  const singleManifest = (singleResult.evidence as {
    manifest: {
      tasks: ReadonlyArray<{
        workItemId: string;
        dependencies: readonly string[];
        deliverables: readonly string[];
        scopePaths?: readonly string[];
        validators?: readonly string[];
        planningRepo?: string | null;
        targetRepo?: string | null;
        closureAuthority?: string | null;
        planningReadOnlyPaths?: readonly string[];
        planningMirrorPaths?: readonly string[];
        outOfScope?: readonly string[];
        nonGoals?: readonly string[];
        evidenceRequired?: string | null;
        rollbackStrategy?: string | null;
        atomizationImpact?: { ownerAtomOrMap?: string | null; mapUpdates?: readonly string[] };
      }>
    }
  }).manifest;
  if (singleManifest.tasks.length !== 1 || singleManifest.tasks[0].workItemId !== 'TASK-FIXTURE-0001') {
    fail('single-card fixture should produce a single TASK-FIXTURE-0001 entry.');
  }
  const singleTask = singleManifest.tasks[0];
  if (!singleTask.dependencies.includes('TASK-FIXTURE-0000')) {
    fail('single-card fixture should record dependency TASK-FIXTURE-0000.');
  }
  assertImportedTaskContract(singleTask, 'single-card dry-run');

  // Duplicate plan should throw.
  await expectThrow('import', ['--from', duplicatePlan, '--dry-run', '--cwd', root], 'ATM_TASKS_PLAN_PARSE_FAILED');

  // Write mode against a temp workspace. The fixture intentionally uses
  // host-local IDs without a TASK- prefix to prove import preserves them.
  const tempWorkspace = mkdtempSync(path.join(tmpdir(), 'atm-task-import-'));
  try {
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

    const resetImport = await expectOk('import', ['--from', npcPlan, '--write', '--force', '--reset-open', '--cwd', tempWorkspace]);
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

    if (importedTask.deliverables.length !== 2 || !importedTask.deliverables.includes('contaminated path containing the word')) {
      fail(`Strict test card: expected deliverables to come only from frontmatter, got ${JSON.stringify(importedTask.deliverables)}.`);
    }

    // 2. 驗證預設模式下，嚴格路徑違規應只呈報為 warning
    const hasStrictPathWarning = defaultManifest.diagnostics.some((d: any) => d.code === 'STRICT_PATH_VIOLATION');
    if (!hasStrictPathWarning) {
      fail('Strict test card: expected STRICT_PATH_VIOLATION warning in default mode but none found.');
    }

    // 3. 驗證啟用 --strict-paths 模式下，應直接拋出 STRICT_PATH_VIOLATION 錯誤 (ok=false)
    await expectThrow('import', ['--from', strictTestPath, '--dry-run', '--strict-paths', '--cwd', tempWorkspace], 'STRICT_PATH_VIOLATION');

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

    await expectOk('import', ['--from', npcPlan, '--write', '--force', '--cwd', tempWorkspace]);

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

    // TASK-AAO-0128: 驗證 TASK-TEAM-0026 類型的 route pollution guard
    const pollutionTestPlanPath = path.join(tempWorkspace, 'pollution-test-plan.md');
    writeFileSync(pollutionTestPlanPath, `---
task_id: TASK-TEAM-0026
title: TEAM safe mirror/import ledger reconciliation lane
status: planned
scopePaths:
  - "packages/cli/src/commands/next.ts"
  - "packages/cli/src/commands/tasks.ts"
outOfScope:
  - "packages/cli/src/commands/team.ts"
  - "scripts/validate-team-agents.ts"
  - "docs/tasks/**"
---

## Goal
Avoid route scope pollution from prose text.
Here are some forbidden paths in text:
- packages/cli/src/commands/team.ts
- scripts/validate-team-agents.ts
- docs/tasks/tasks-team.json
`, 'utf8');

    await expectOk('import', ['--from', pollutionTestPlanPath, '--write', '--cwd', tempWorkspace]);

    const pollutionNextResult = await runNext(['--cwd', tempWorkspace, '--prompt', 'TASK-TEAM-0026']);
    const pollutionQueue = (pollutionNextResult.evidence as {
      importedTaskQueue?: {
        selectedTask?: {
          workItemId: string;
          targetAllowedFiles: readonly string[];
          scopePaths: readonly string[];
        } | null
      }
    }).importedTaskQueue;

    const selectedTask = pollutionQueue?.selectedTask;
    if (!selectedTask || selectedTask.workItemId !== 'TASK-TEAM-0026') {
      fail(`TASK-AAO-0128 regression: failed to route TASK-TEAM-0026`);
    }

    const allowed = selectedTask?.targetAllowedFiles ?? [];
    const forbiddenPatterns = [
      'packages/cli/src/commands/team.ts',
      'scripts/validate-team-agents.ts',
      'docs/tasks',
      'packages/cli/src/commands'
    ];

    for (const pat of forbiddenPatterns) {
      if (allowed.some((f) => f === pat || f.startsWith(pat + '/'))) {
        // packages/cli/src/commands/next.ts and tasks.ts are explicitly allowed, so bypass them
        if (pat === 'packages/cli/src/commands' && (allowed.every((f) => f === 'packages/cli/src/commands/next.ts' || f === 'packages/cli/src/commands/tasks.ts' || f.startsWith('.atm/')))) {
          continue;
        }
        fail(`TASK-AAO-0128 regression: TASK-TEAM-0026 targetAllowedFiles contains polluted path: ${pat}. Allowed files: ${JSON.stringify(allowed)}`);
      }
    }

  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true });
  }

  if (!process.exitCode) {
    console.log(`[task-import:${mode}] ok (sample-plan + low-automation-plan + single-card + duplicate detection)`);
  }
}

await main();

function assertImportedTaskContract(task: {
  readonly deliverables?: readonly string[];
  readonly scopePaths?: readonly string[];
  readonly validators?: readonly string[];
  readonly planningRepo?: string | null;
  readonly targetRepo?: string | null;
  readonly closureAuthority?: string | null;
  readonly planningReadOnlyPaths?: readonly string[];
  readonly planningMirrorPaths?: readonly string[];
  readonly outOfScope?: readonly string[];
  readonly nonGoals?: readonly string[];
  readonly evidenceRequired?: string | null;
  readonly rollbackStrategy?: string | null;
  readonly atomizationImpact?: { ownerAtomOrMap?: string | null; mapUpdates?: readonly string[] };
}, label: string) {
  const scopePaths = task.scopePaths ?? [];
  const deliverables = task.deliverables ?? [];
  if (!scopePaths.includes('packages/cli/src/commands/tasks.ts') || !scopePaths.includes('packages/cli/src/commands/next.ts')) {
    fail(`${label} must preserve frontmatter scopePaths, got ${JSON.stringify(scopePaths)}.`);
  }
  if (!deliverables.includes('packages/cli/src/commands/tasks.ts') || !deliverables.includes('scripts/validate-task-import.ts')) {
    fail(`${label} must preserve deliverable file paths, got ${JSON.stringify(deliverables)}.`);
  }
  if (task.planningRepo !== '3KLife' || task.targetRepo !== 'AI-Atomic-Framework' || task.closureAuthority !== 'target_repo') {
    fail(`${label} must preserve planning/target/closure authority, got ${JSON.stringify({
      planningRepo: task.planningRepo,
      targetRepo: task.targetRepo,
      closureAuthority: task.closureAuthority
    })}.`);
  }
  if (!(task.planningReadOnlyPaths ?? []).some((entry) => entry.includes('../3KLife/docs/ai_atomic_framework/example/tasks/TASK-FIXTURE-0001.task.md'))) {
    fail(`${label} must preserve planningReadOnlyPaths.`);
  }
  if (!(task.planningMirrorPaths ?? []).includes('docs/ai_atomic_framework/example/tasks/TASK-FIXTURE-0001.task.md')) {
    fail(`${label} must preserve planningMirrorPaths.`);
  }
  if (!(task.outOfScope ?? []).includes('.atm/runtime/**') || !(task.nonGoals ?? []).includes('Rewrite the task lifecycle engine.')) {
    fail(`${label} must preserve outOfScope and nonGoals.`);
  }
  if (!(task.validators ?? []).includes('npm run validate:task-import')) {
    fail(`${label} must preserve validators.`);
  }
  if (task.evidenceRequired !== 'command-backed' || task.rollbackStrategy !== 'revert-commit') {
    fail(`${label} must preserve evidence and rollback metadata.`);
  }
  if (task.atomizationImpact?.ownerAtomOrMap !== 'atm.task-ledger-governance-map'
    || !(task.atomizationImpact?.mapUpdates ?? []).includes('atomic_workbench/atomization-coverage/path-to-atom-map.json')) {
    fail(`${label} must preserve atomizationImpact metadata.`);
  }
}
