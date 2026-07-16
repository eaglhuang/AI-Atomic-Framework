import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runGit } from './assertions.ts';
import { writeTaskCard } from './writers.ts';

export function setupPromptScopedFixture() {
  const tempRoot = mkdtempSync(path.join(process.cwd(), '.atm-temp', 'prompt-scoped-next-'));
  const previousGitCeilingDirectories = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = [process.cwd(), previousGitCeilingDirectories]
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .join(path.delimiter);
  try {
    const planDir = path.join(tempRoot, 'docs', 'plan');
    const taskDir = path.join(planDir, 'tasks');
    const otherTaskDir = path.join(tempRoot, 'docs', 'other', 'tasks');
    const ignoredTmpTaskDir = path.join(tempRoot, 'local', 'tmp', 'sanguo-rag-smoke', 'tasks');
    const externalPlanDir = path.join(path.dirname(tempRoot), '3KLife', 'docs', 'ai_atomic_framework', 'atm-agent-first-operability');
    const externalTaskDir = path.join(externalPlanDir, 'tasks');
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(otherTaskDir, { recursive: true });
    mkdirSync(ignoredTmpTaskDir, { recursive: true });
    mkdirSync(externalTaskDir, { recursive: true });

    writeFileSync(path.join(planDir, 'PlanAlpha.md'), '# Plan Alpha\n', 'utf8');
    writeFileSync(path.join(tempRoot, 'docs', 'other', 'OtherPlan.md'), '# Other Plan\n', 'utf8');
    writeFileSync(path.join(externalPlanDir, 'ATM Agent-First 可操作性優化計畫書.md'), '# ATM Agent-First 可操作性優化計畫書\n\n| 任務 | 狀態 |\n|---|---|\n| TASK-AAO-0001 | open |\n| TASK-AAO-0002 | open |\n', 'utf8');
    writeTaskCard(path.join(taskDir, 'TASK-ALPHA-0001.task.md'), 'TASK-ALPHA-0001', 'Alpha first task');
    writeTaskCard(path.join(taskDir, 'TASK-ALPHA-0002.task.md'), 'TASK-ALPHA-0002', 'Alpha second task');
    writeTaskCard(path.join(otherTaskDir, 'TASK-OTHER-0001.task.md'), 'TASK-OTHER-0001', 'Other task');
    writeTaskCard(path.join(otherTaskDir, 'SANGUO-BOOTSTRAP-0001.task.md'), 'SANGUO-BOOTSTRAP-0001', 'Sanguo bootstrap task');
    writeTaskCard(path.join(ignoredTmpTaskDir, 'TASK-TMP-0001.task.md'), 'TASK-TMP-0001', 'Temporary task that discovery must ignore');
    writeTaskCard(path.join(tempRoot, 'TASK-APO-0030-python-language-adapter-plugin.task.md'), 'TASK-APO-0030-python-language-adapter-plugin', 'Unrelated root task');
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0000-doc-finalize-bridge-index.task.md'), 'TASK-AAO-0000', 'AAO docs baseline', { status: 'done' });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0001-report-overlap-matrix-routing.task.md'), 'TASK-AAO-0001', 'AAO overlap routing', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md',
      files: 'packages/cli/src/commands/next.ts, docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0001-report-overlap-matrix-routing.task.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0002-cli-spec-runner-ssot-drift-guard.task.md'), 'TASK-AAO-0002', 'AAO CLI spec drift guard', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0011-untracked-file-scope-warnings.task.md'), 'TASK-AAO-0011', 'AAO untracked file scope warnings', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0030-crlf-policy.task.md'), 'TASK-AAO-0030', 'AAO CRLF policy', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-0046-validator-baseline-noise-diagnostics.task.md'), 'TASK-AAO-0046', 'AAO validator noise diagnostics', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-FABLE-004-backlog-continuation-prompt-routing.task.md'), 'TASK-AAO-FABLE-004', 'Fable backlog continuation routing', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });
    writeTaskCard(path.join(externalTaskDir, 'TASK-AAO-FABLE-005-claim-conflict-closeout.task.md'), 'TASK-AAO-FABLE-005', 'Fable claim conflict closeout', {
      relatedPlan: 'docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
    });

    mkdirSync(path.join(tempRoot, 'release'), { recursive: true });
    mkdirSync(path.join(tempRoot, 'notes'), { recursive: true });
    writeFileSync(path.join(tempRoot, 'release', 'fixture.txt'), 'baseline release mirror\n', 'utf8');
    writeFileSync(path.join(tempRoot, 'notes', 'unrelated.txt'), 'baseline unrelated file\n', 'utf8');
    writeFileSync(path.join(tempRoot, '.gitignore'), 'artifacts/\n', 'utf8');
    runGit(tempRoot, ['init']);
    runGit(tempRoot, ['config', 'user.name', 'prompt-scope-validator']);
    runGit(tempRoot, ['config', 'user.email', 'prompt-scope-validator@example.com']);
    runGit(tempRoot, ['add', '.']);
    runGit(tempRoot, ['commit', '-m', 'validator fixture baseline']);

    return { tempRoot, previousGitCeilingDirectories, planDir, taskDir, otherTaskDir, ignoredTmpTaskDir, externalPlanDir, externalTaskDir };
  } catch (error) {
    process.env.GIT_CEILING_DIRECTORIES = previousGitCeilingDirectories ?? '';
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupPromptScopedFixture(ctx: { tempRoot: string; previousGitCeilingDirectories?: string }) {
  if (ctx.previousGitCeilingDirectories === undefined) {
    delete process.env.GIT_CEILING_DIRECTORIES;
  } else {
    process.env.GIT_CEILING_DIRECTORIES = ctx.previousGitCeilingDirectories;
  }
  rmSync(ctx.tempRoot, { recursive: true, force: true });
  rmSync(path.join(path.dirname(ctx.tempRoot), '3KLife'), { recursive: true, force: true });
}
