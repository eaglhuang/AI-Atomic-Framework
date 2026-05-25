import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
  const singleManifest = (singleResult.evidence as { manifest: { tasks: ReadonlyArray<{ workItemId: string; dependencies: readonly string[] }> } }).manifest;
  if (singleManifest.tasks.length !== 1 || singleManifest.tasks[0].workItemId !== 'TASK-FIXTURE-0001') {
    fail('single-card fixture should produce a single TASK-FIXTURE-0001 entry.');
  }
  if (!singleManifest.tasks[0].dependencies.includes('TASK-FIXTURE-0000')) {
    fail('single-card fixture should record dependency TASK-FIXTURE-0000.');
  }

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

    // verify should pass.
    const verifyResult = await expectOk('verify', ['--cwd', tempWorkspace]);
    const verifyReport = (verifyResult.evidence as { report: { inspectedTasks: number; ok: boolean } }).report;
    if (!verifyReport.ok || verifyReport.inspectedTasks !== 2) {
      fail(`verify expected ok=true with 2 tasks, got ${JSON.stringify(verifyReport)}.`);
    }
    const nextResult = await runNext(['--cwd', tempWorkspace, '--prompt', 'SANGUO-AUTO-0001']);
    const nextQueue = (nextResult.evidence as { importedTaskQueue?: { openTaskCount: number; selectedTask?: { workItemId: string } | null } }).importedTaskQueue;
    if (!nextQueue || nextQueue.openTaskCount !== 2 || nextQueue.selectedTask?.workItemId !== 'SANGUO-AUTO-0001') {
      fail(`next --prompt must surface the matching imported task without global fallback, got ${JSON.stringify(nextQueue)}.`);
    }
    const nextClaimResult = await runNext(['--cwd', tempWorkspace, '--claim', '--actor', 'fixture-agent', '--prompt', 'SANGUO-AUTO-0001']);
    if (nextClaimResult.ok !== true || nextClaimResult.messages?.[0]?.code !== 'ATM_NEXT_CLAIMED') {
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
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true });
  }

  if (!process.exitCode) {
    console.log(`[task-import:${mode}] ok (sample-plan + low-automation-plan + single-card + duplicate detection)`);
  }
}

await main();
