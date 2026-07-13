import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { classifyGuidanceIntent } from '../packages/core/src/guidance/intent-classifier.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';
import { runEmergency } from '../packages/cli/src/commands/emergency.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(text: string): void {
  console.error(`[task-import:${mode}] ${text}`);
  process.exitCode = 1;
}

function findDuplicateAtmBacklogIds(markdown: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const match of markdown.matchAll(/\|\s*(ATM-BUG-\d{4}-\d{2}-\d{2}-\d{3})\s*\|/g)) {
    const id = match[1];
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }
  return [...duplicates].sort();
}

function assertNoDuplicateAtmBacklogIds(markdown: string, label: string): void {
  const duplicates = findDuplicateAtmBacklogIds(markdown);
  if (duplicates.length > 0) {
    fail(`${label} contains duplicate ATM backlog ID(s): ${duplicates.join(', ')}`);
  }
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

async function createImportWriteLease(cwd: string, allowedFlags: readonly string[], reason: string): Promise<string> {
  const approval = await runEmergency([
    'approve',
    '--cwd', cwd,
    '--actor', 'validator',
    '--permission', 'backend.tasks.import.write',
    ...allowedFlags.flatMap((flag) => ['--allowed-flag', flag]),
    '--approval-text', 'Human approved validator import write test',
    '--reason', reason
  ]);
  const leaseId = (approval.evidence as { lease?: { leaseId?: string } })?.lease?.leaseId;
  if (!approval.ok || !leaseId) {
    fail(`emergency approve for import write failed: ${JSON.stringify(approval)}`);
    throw new Error('unreachable');
  }
  return leaseId;
}

async function main() {
  const samplePlan = path.join(root, 'fixtures/task-plan-import/sample-plan.md');
  const npcPlan = path.join(root, 'fixtures/task-plan-import/low-automation-plan.md');
  const singleCard = path.join(root, 'fixtures/task-plan-import/single-card.md');
  const duplicatePlan = path.join(root, 'fixtures/task-plan-import/duplicate-plan.md');
  const governanceTablePlan = path.join(root, 'fixtures/task-plan-import/governance-table-plan.md');
  const chineseBootstrapPlan = path.join(root, 'fixtures/task-plan-import/chinese-bootstrap-plan.md');
  const dispatchMetadataCard = path.join(root, 'fixtures/task-plan-import/dispatch-metadata-card.md');
  const canonicalAtmBacklog = path.join(root, 'docs/governance/atm-bug-and-optimization-backlog.md');

  for (const fixturePath of [samplePlan, npcPlan, singleCard, duplicatePlan, governanceTablePlan, chineseBootstrapPlan, dispatchMetadataCard, canonicalAtmBacklog]) {
    if (!existsSync(fixturePath)) {
      fail(`missing fixture: ${path.relative(root, fixturePath)}`);
      return;
    }
  }

  assertNoDuplicateAtmBacklogIds(readFileSync(canonicalAtmBacklog, 'utf8'), 'canonical ATM bug backlog');
  const duplicateBacklogFixture = [
    '| ID | Date | Repo | Type | Severity | Status | Area | Finding | Expected behavior | Evidence / Repro | Follow-up |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| ATM-BUG-2099-01-01-001 | 2099-01-01 | AI-Atomic-Framework | Bug | Medium | Open | Fixture | First | Expected | Evidence | Follow-up |',
    '| ATM-BUG-2099-01-01-001 | 2099-01-01 | AI-Atomic-Framework | Bug | Medium | Open | Fixture | Duplicate | Expected | Evidence | Follow-up |'
  ].join('\n');
  const duplicateFixtureIds = findDuplicateAtmBacklogIds(duplicateBacklogFixture);
  if (duplicateFixtureIds.join(',') !== 'ATM-BUG-2099-01-01-001') {
    fail(`duplicate backlog fixture must report its duplicate ID, got ${duplicateFixtureIds.join(',') || '<none>'}.`);
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
    manifest: { tasks: ReadonlyArray<{ workItemId: string; deliverables: readonly string[] }> };
  }).manifest.tasks;
  const chinese0101 = chineseTasks.find((task) => task.workItemId === 'SANGUO-BOOTSTRAP-0101');
  if (!chinese0101 || !chinese0101.deliverables.includes('scripts/wave-001-job-builder.ts')) {
    fail(`Chinese bootstrap plan must preserve CJK-safe path deliverables: ${JSON.stringify(chinese0101)}.`);
  }

  const proseDeliverableCard = path.join(tmpdir(), `atm-task-import-prose-deliverable-${process.pid}.md`);
  writeFileSync(proseDeliverableCard, [
    '---',
    'task_id: TASK-PROSE-DELIVERABLE-0001',
    'title: Reject prose deliverable declarations',
    'deliverables:',
    '  - 完成 Broker 驗證',
    '---',
    '',
    '# TASK-PROSE-DELIVERABLE-0001',
    ''
  ].join('\n'), 'utf8');
  await expectThrow('import', ['--from', proseDeliverableCard, '--dry-run', '--cwd', root], 'ATM_TASK_IMPORT_DELIVERABLE_PATH_INVALID');
  rmSync(proseDeliverableCard, { force: true });

  const cjkPathCard = path.join(tmpdir(), `atm-task-import-cjk-path-${process.pid}.md`);
  writeFileSync(cjkPathCard, [
    '---',
    'task_id: TASK-CJK-PATH-0001',
    'title: Accept CJK path declarations',
    'deliverables:',
    '  - docs/治理/交接.md',
    '---',
    '',
    '# TASK-CJK-PATH-0001',
    ''
  ].join('\n'), 'utf8');
  await expectOk('import', ['--from', cjkPathCard, '--dry-run', '--cwd', root]);
  rmSync(cjkPathCard, { force: true });

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

  const legacyScopeOnlyCard = path.join(tmpdir(), `atm-task-import-legacy-${process.pid}.md`);
  writeFileSync(legacyScopeOnlyCard, [
    '---',
    'task_id: TASK-LEGACY-DELIVERABLE-0001',
    'title: Legacy allowed_files closeback fixture',
    'status: planned',
    'allowed_files:',
    '  - packages/cli/src/commands/evidence.ts',
    '  - packages/cli/src/commands/taskflow.ts',
    'validators:',
    '  - npm run typecheck',
    '---',
    '',
    '# TASK-LEGACY-DELIVERABLE-0001',
    ''
  ].join('\n'), 'utf8');
  const legacyScopeOnlyResult = await expectOk('import', ['--from', legacyScopeOnlyCard, '--dry-run', '--cwd', root]);
  const legacyScopeOnlyTask = (legacyScopeOnlyResult.evidence as {
    manifest: { tasks: ReadonlyArray<{ workItemId: string; deliverables: readonly string[]; importDiagnostics?: readonly { code: string }[] }> };
  }).manifest.tasks[0];
  if (!legacyScopeOnlyTask
    || legacyScopeOnlyTask.workItemId !== 'TASK-LEGACY-DELIVERABLE-0001'
    || !legacyScopeOnlyTask.deliverables.includes('packages/cli/src/commands/evidence.ts')
    || !legacyScopeOnlyTask.deliverables.includes('packages/cli/src/commands/taskflow.ts')) {
    fail(`legacy allowed_files card must infer canonical deliverables from file-shaped scope paths, got ${JSON.stringify(legacyScopeOnlyTask)}.`);
  }
  if (!legacyScopeOnlyTask.importDiagnostics?.some((entry) => entry.code === 'ATM_TASK_IMPORT_LEGACY_SCOPE_DELIVERABLES_INFERRED')) {
    fail(`legacy allowed_files card must record inferred deliverable diagnostic, got ${JSON.stringify(legacyScopeOnlyTask.importDiagnostics)}.`);
  }

  const legacyMixedScopeCard = path.join(tmpdir(), `atm-task-import-legacy-mixed-${process.pid}.md`);
  writeFileSync(legacyMixedScopeCard, [
    '---',
    'task_id: TASK-LEGACY-DELIVERABLE-0002',
    'title: Legacy allowed_files mixed governance scope fixture',
    'status: planned',
    'allowed_files:',
    '  - packages/cli/src/commands/evidence.ts',
    '  - .atm/history/evidence/historical-batches/',
    '  - .atm/history/evidence/TASK-LEGACY-DELIVERABLE-0002.json',
    'validators:',
    '  - npm run typecheck',
    '---',
    '',
    '# TASK-LEGACY-DELIVERABLE-0002',
    ''
  ].join('\n'), 'utf8');
  const legacyMixedScopeResult = await expectOk('import', ['--from', legacyMixedScopeCard, '--dry-run', '--cwd', root]);
  const legacyMixedScopeTask = (legacyMixedScopeResult.evidence as {
    manifest: { tasks: ReadonlyArray<{ workItemId: string; deliverables: readonly string[]; importDiagnostics?: readonly { code: string }[] }> };
  }).manifest.tasks[0];
  if (!legacyMixedScopeTask
    || legacyMixedScopeTask.workItemId !== 'TASK-LEGACY-DELIVERABLE-0002'
    || !legacyMixedScopeTask.deliverables.includes('packages/cli/src/commands/evidence.ts')
    || legacyMixedScopeTask.deliverables.some((entry) => entry.startsWith('.atm/'))) {
    fail(`legacy mixed governance scope must infer only canonical source deliverables, got ${JSON.stringify(legacyMixedScopeTask)}.`);
  }

  const dispatchMetadataResult = await expectOk('import', ['--from', dispatchMetadataCard, '--dry-run', '--cwd', root]);
  const dispatchMetadataTask = (dispatchMetadataResult.evidence as {
    manifest: {
      tasks: ReadonlyArray<{
        workItemId: string;
        dispatchPattern?: {
          shape?: string;
          phase0?: { lane?: string; allowedFiles?: readonly string[]; commitBudget?: number };
          phase1?: { lane?: string; forbiddenFiles?: readonly string[]; commitBudget?: number; allowedFilesStrict?: boolean };
        };
        conditionReview?: readonly string[];
        mailboxAssignee?: string | null;
      }>;
    };
  }).manifest.tasks[0];
  if (!dispatchMetadataTask || dispatchMetadataTask.workItemId !== 'TASK-FIXTURE-DISPATCH-0001') {
    fail(`dispatch-metadata fixture expected TASK-FIXTURE-DISPATCH-0001, got ${JSON.stringify(dispatchMetadataTask)}.`);
  }
  if (!dispatchMetadataTask.dispatchPattern?.shape?.includes('dual-agent')) {
    fail(`dispatch-metadata fixture must preserve dispatchPattern.shape, got ${JSON.stringify(dispatchMetadataTask.dispatchPattern)}.`);
  }
  if (dispatchMetadataTask.dispatchPattern?.phase0?.lane !== 'helper (read-only sidecar)') {
    fail(`dispatch-metadata fixture must preserve phase0 lane, got ${JSON.stringify(dispatchMetadataTask.dispatchPattern?.phase0)}.`);
  }
  if (!dispatchMetadataTask.dispatchPattern?.phase0?.allowedFiles?.includes('docs/ai_atomic_framework/team-agents/tasks/TASK-FIXTURE-DISPATCH-0001.task.md')) {
    fail(`dispatch-metadata fixture must preserve phase0 allowedFiles, got ${JSON.stringify(dispatchMetadataTask.dispatchPattern?.phase0)}.`);
  }
  if (dispatchMetadataTask.dispatchPattern?.phase1?.lane !== 'external builder 008') {
    fail(`dispatch-metadata fixture must preserve phase1 lane, got ${JSON.stringify(dispatchMetadataTask.dispatchPattern?.phase1)}.`);
  }
  if (!dispatchMetadataTask.dispatchPattern?.phase1?.forbiddenFiles?.includes('C:/Users/User/3KLife/**')) {
    fail(`dispatch-metadata fixture must preserve phase1 forbiddenFiles, got ${JSON.stringify(dispatchMetadataTask.dispatchPattern?.phase1)}.`);
  }
  if (dispatchMetadataTask.dispatchPattern?.phase1?.allowedFilesStrict !== true) {
    fail(`dispatch-metadata fixture must preserve phase1 allowedFilesStrict=true, got ${JSON.stringify(dispatchMetadataTask.dispatchPattern?.phase1)}.`);
  }
  if (!dispatchMetadataTask.conditionReview?.some((entry) => entry.includes('dry-run manifest preserves dispatchPattern'))) {
    fail(`dispatch-metadata fixture must preserve conditionReview, got ${JSON.stringify(dispatchMetadataTask.conditionReview)}.`);
  }
  if (dispatchMetadataTask.mailboxAssignee !== '008') {
    fail(`dispatch-metadata fixture must resolve mailboxAssignee=008, got ${JSON.stringify(dispatchMetadataTask.mailboxAssignee)}.`);
  }

  const team0025Card = path.resolve(root, '../3KLife/docs/ai_atomic_framework/team-agents/tasks/TASK-TEAM-0025-task-import-dispatch-metadata-preservation.task.md');
  if (existsSync(team0025Card)) {
    const team0025Result = await expectOk('import', ['--from', team0025Card, '--dry-run', '--cwd', root]);
    const team0025Task = (team0025Result.evidence as {
      manifest: { tasks: ReadonlyArray<{ workItemId: string; dispatchPattern?: { shape?: string; phase1?: { forbiddenFiles?: readonly string[] } }; conditionReview?: readonly string[] }> };
    }).manifest.tasks.find((task) => task.workItemId === 'TASK-TEAM-0025');
    if (!team0025Task?.dispatchPattern?.shape?.includes('dual-agent')) {
      fail(`TASK-TEAM-0025 dry-run must preserve dispatchPattern.shape, got ${JSON.stringify(team0025Task?.dispatchPattern)}.`);
    }
    if (!team0025Task?.dispatchPattern?.phase1?.forbiddenFiles?.includes('C:/Users/User/3KLife/**')) {
      fail(`TASK-TEAM-0025 dry-run must preserve phase1 forbidden_files fence, got ${JSON.stringify(team0025Task?.dispatchPattern?.phase1)}.`);
    }
    if (!team0025Task?.conditionReview || team0025Task.conditionReview.length < 2) {
      fail(`TASK-TEAM-0025 dry-run must preserve conditionReview checklist, got ${JSON.stringify(team0025Task?.conditionReview)}.`);
    }
  }

  // Duplicate plan should throw.
  await expectThrow('import', ['--from', duplicatePlan, '--dry-run', '--cwd', root], 'ATM_TASKS_PLAN_PARSE_FAILED');

  // Write mode against a temp workspace. The fixture intentionally uses
  // host-local IDs without a TASK- prefix to prove import preserves them.
  const tempWorkspace = mkdtempSync(path.join(tmpdir(), 'atm-task-import-'));
  try {
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

    // TASK-AAO-0131: TEAM-0026 must keep planning/prose artifacts out of target work.
    const routeHygieneTeamPlanPath = path.join(tempWorkspace, 'route-hygiene-team-0026.md');
    writeFileSync(routeHygieneTeamPlanPath, `---
task_id: TASK-TEAM-0026
title: TEAM safe mirror/import ledger reconciliation lane
status: planned
planning_repo: 3KLife
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - ".atm/history/tasks/TASK-TEAM-000[1-9].json"
  - ".atm/history/tasks/TASK-TEAM-001[0-9].json"
  - ".atm/history/tasks/TASK-TEAM-0025.json"
  - ".atm/history/task-events/TASK-TEAM-000[1-9]/**"
  - ".atm/history/task-events/TASK-TEAM-001[0-9]/**"
  - ".atm/history/task-events/TASK-TEAM-0025/**"
outOfScope:
  - "docs/tasks/**"
  - "packages/cli/src/commands/**"
---

## Goal
Use TEAM-0026 as a safe mirror/import lane.

## Planning notes that must stay out of targetAllowedFiles
- docs/tasks/tasks-team.json
- packages/cli/src/commands/tasks.ts
- packages/cli/src/commands/next.ts
`, 'utf8');

    const teamHygieneLeaseId = await createImportWriteLease(tempWorkspace, ['--force'], 'validator verifies TEAM-0026 route hygiene force import behavior');
    await expectOk('import', ['--from', routeHygieneTeamPlanPath, '--write', '--force', '--emergency-approval', teamHygieneLeaseId, '--cwd', tempWorkspace]);
    const teamHygieneNextResult = await runNext(['--cwd', tempWorkspace, '--prompt', 'TASK-TEAM-0026']);
    const teamHygieneTask = (teamHygieneNextResult.evidence as {
      importedTaskQueue?: {
        selectedTask?: {
          workItemId: string;
          targetAllowedFiles: readonly string[];
        } | null
      }
    }).importedTaskQueue?.selectedTask;

    if (!teamHygieneTask || teamHygieneTask.workItemId !== 'TASK-TEAM-0026') {
      fail(`TASK-AAO-0131 regression: failed to route TEAM-0026 hygiene fixture, got ${JSON.stringify(teamHygieneTask)}.`);
    }
    const teamAllowed = teamHygieneTask?.targetAllowedFiles ?? [];
    if (teamAllowed.some((file) => file === 'docs/tasks' || file.startsWith('docs/tasks/'))) {
      fail(`TASK-AAO-0131 regression: TEAM-0026 targetAllowedFiles must not contain docs/tasks artifacts, got ${JSON.stringify(teamAllowed)}.`);
    }
    if (teamAllowed.some((file) => file === 'packages/cli/src/commands' || file.startsWith('packages/cli/src/commands/'))) {
      fail(`TASK-AAO-0131 regression: TEAM-0026 targetAllowedFiles must not contain command surfaces, got ${JSON.stringify(teamAllowed)}.`);
    }

    // TASK-AAO-0131: planning_repo-only CID cards must remain mirror-sync only.
    const routeHygieneCidPlanPath = path.join(tempWorkspace, 'route-hygiene-cid-0005.md');
    writeFileSync(routeHygieneCidPlanPath, `---
task_id: TASK-CID-0005
title: P0 CID-first parallel conflict advisor CLI contract
status: planned
planning_repo: 3KLife
target_repo: 3KLife
closure_authority: planning_repo
scopePaths:
  - "docs/ai_atomic_framework/cid-hardening/CID-hardening-plan.md"
  - "docs/ai_atomic_framework/cid-hardening/tasks/TASK-CID-0005.task.md"
---

## Goal
This is a planning-repo contract. The CID word here must not synthesize a target alias.
`, 'utf8');

    const cidHygieneLeaseId = await createImportWriteLease(tempWorkspace, ['--force'], 'validator verifies planning_repo-only CID route hygiene force import behavior');
    await expectOk('import', ['--from', routeHygieneCidPlanPath, '--write', '--force', '--emergency-approval', cidHygieneLeaseId, '--cwd', tempWorkspace]);
    const cidHygieneNextResult = await runNext(['--cwd', tempWorkspace, '--prompt', 'TASK-CID-0005']);
    const cidEvidence = cidHygieneNextResult.evidence as {
      nextAction?: { status?: string; recommendedChannel?: string };
      importedTaskQueue?: {
        selectedTask?: {
          workItemId: string;
          targetAllowedFiles: readonly string[];
          planningReadOnlyPaths: readonly string[];
        } | null
      }
    };
    const cidTask = cidEvidence.importedTaskQueue?.selectedTask;
    if (cidEvidence.nextAction?.status !== 'task-mirror-sync-required' || cidEvidence.nextAction?.recommendedChannel !== 'mirror-sync') {
      fail(`TASK-AAO-0131 regression: CID-0005 must route as mirror-sync-only, got ${JSON.stringify(cidEvidence.nextAction)}.`);
    }
    if (!cidTask || cidTask.workItemId !== 'TASK-CID-0005') {
      fail(`TASK-AAO-0131 regression: failed to route CID-0005 hygiene fixture, got ${JSON.stringify(cidTask)}.`);
    }
    if ((cidTask?.targetAllowedFiles ?? []).length > 0) {
      fail(`TASK-AAO-0131 regression: planning_repo-only CID-0005 must not expose targetAllowedFiles, got ${JSON.stringify(cidTask?.targetAllowedFiles)}.`);
    }
    if ((cidTask?.targetAllowedFiles ?? []).some((file) => file.includes('/CID') || file.includes('\\CID'))) {
      fail(`TASK-AAO-0131 regression: CID-0005 targetAllowedFiles must not contain synthetic CID aliases, got ${JSON.stringify(cidTask?.targetAllowedFiles)}.`);
    }

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
    fail(`${label} must preserve atomizationImpact metadata from camelCase or snake_case frontmatter.`);
  }
}
