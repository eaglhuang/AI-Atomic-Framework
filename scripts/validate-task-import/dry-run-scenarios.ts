import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { classifyGuidanceIntent } from '../../packages/core/src/guidance/intent-classifier.ts';
import { assertImportedTaskContract } from './assertions.ts';
import { fail, root, type FixturePaths } from './context.ts';
import { expectOk, expectThrow } from './tasks.ts';

export async function runDryRunAndMetadataScenarios(paths: FixturePaths): Promise<void> {
  const { samplePlan, singleCard, duplicatePlan, governanceTablePlan, chineseBootstrapPlan, dispatchMetadataCard } = paths;
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

}
