import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditTasks,
  createClosurePacket,
  createFrameworkModeStatus,
  runFrameworkDevelopmentGuard,
  runFrameworkMode,
  validateClosurePacket
} from '../packages/cli/src/commands/framework-development.ts';
import { runIntegrationHookInvocation } from '../packages/cli/src/commands/integration-hooks.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string): never {
  console.error(`[framework-development-governance:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeHostRepo(parent: string, name: string) {
  const repo = path.join(parent, name);
  mkdirSync(repo, { recursive: true });
  writeJson(path.join(repo, 'package.json'), {
    name: name,
    type: 'module'
  });
  return repo;
}

function makeFrameworkRepo(parent: string, name = 'ai-atomic-framework') {
  const repo = path.join(parent, name);
  mkdirSync(path.join(repo, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'packages', 'cli', 'src'), { recursive: true });
  writeJson(path.join(repo, 'package.json'), {
    name: 'ai-atomic-framework',
    workspaces: ['packages/*']
  });
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const core = true;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'cli', 'src', 'atm.ts'), 'export const cli = true;\n', 'utf8');
  writeJson(path.join(repo, 'atomic-registry.json'), { entries: [] });
  writeJson(path.join(repo, '.atm', 'runtime', 'pinned-runner.json'), {
    schemaVersion: 'atm.pinnedRunner.v0.1',
    runnerPath: 'atm.mjs',
    sourcePath: 'release/atm-onefile/atm.mjs'
  });
  mkdirSync(path.join(repo, 'release', 'atm-onefile'), { recursive: true });
  writeFileSync(path.join(repo, 'release', 'atm-onefile', 'atm.mjs'), '#!/usr/bin/env node\n', 'utf8');
  return repo;
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-governance-'));

try {
  const hostRepo = makeHostRepo(tempRoot, 'ordinary-adopter');
  const inactive = createFrameworkModeStatus({ cwd: hostRepo, files: ['src/index.ts'] });
  assert(inactive.repoRole === 'host', 'ordinary repo must be identified as host');
  assert(inactive.mode === 'inactive', 'ordinary repo must not activate framework-development mode');

  const frameworkRepo = makeFrameworkRepo(tempRoot);
  const docsOnly = createFrameworkModeStatus({ cwd: frameworkRepo, files: ['docs/plan.md'] });
  assert(docsOnly.repoRole === 'framework', 'framework fixture must be identified as framework repo');
  assert(docsOnly.mode === 'suspected', 'framework docs-only change should be suspected, not required');
  assert(docsOnly.criticalChangedFiles.length === 0, 'docs-only change must not be critical');

  const critical = createFrameworkModeStatus({ cwd: frameworkRepo, files: ['packages/core/src/index.ts'] });
  assert(critical.mode === 'required', 'packages/core change must require framework-development mode');
  assert(critical.criticalChangedFiles.includes('packages/core/src/index.ts'), 'critical file must be listed');
  assert(critical.pinnedRunner.status === 'available', 'framework fixture should have an available pinned runner');
  assert(critical.blockers.includes('active-framework-claim-required'), 'critical framework work must require an active framework task claim');

  writeJson(path.join(frameworkRepo, '.atm', 'runtime', 'locks', 'RELEASED-0001.lock.json'), {
    workItemId: 'RELEASED-0001',
    status: 'released',
    released: true,
    heartbeatAt: new Date().toISOString(),
    ttlSeconds: 1800
  });
  const criticalWithReleasedLock = createFrameworkModeStatus({ cwd: frameworkRepo, files: ['packages/core/src/index.ts'] });
  assert(criticalWithReleasedLock.activeLocks.length === 0, 'released runtime locks must not satisfy framework-development claim requirements');
  assert(criticalWithReleasedLock.blockers.includes('active-framework-claim-required'), 'released locks must not clear active framework claim blockers');

  const frameworkGuard = runFrameworkDevelopmentGuard(frameworkRepo, ['packages/core/src/index.ts']);
  assert(frameworkGuard.ok === false, 'framework-development guard must fail without an active framework claim');

  const preToolBlock = runIntegrationHookInvocation(['pre-tool', '--cwd', frameworkRepo, '--editor', 'copilot', '--files', 'packages/core/src/index.ts']);
  assert(preToolBlock.ok === false, 'pre-tool hook must block critical framework edits without an active claim');
  assert(preToolBlock.messages.some((entry) => entry.code === 'ATM_INTEGRATION_PRE_TOOL_FRAMEWORK_CLAIM_REQUIRED'), 'pre-tool block must report the framework claim requirement');

  const preToolDocsOnly = runIntegrationHookInvocation(['pre-tool', '--cwd', frameworkRepo, '--editor', 'copilot', '--files', 'docs/plan.md']);
  assert(preToolDocsOnly.ok === true, 'pre-tool hook must allow framework docs-only edits without hard framework claim');

  const promptScopedRepo = makeHostRepo(tempRoot, 'prompt-scope-repo');
  mkdirSync(path.join(promptScopedRepo, 'docs', 'plan', 'tasks'), { recursive: true });
  mkdirSync(path.join(promptScopedRepo, 'src'), { recursive: true });
  writeFileSync(path.join(promptScopedRepo, 'src', 'scope.ts'), 'export const scope = true;\n', 'utf8');
  writeFileSync(path.join(promptScopedRepo, 'src', 'other.ts'), 'export const other = true;\n', 'utf8');
  writeFileSync(path.join(promptScopedRepo, 'docs', 'plan', 'tasks', 'TASK-SCOPE-0001.task.md'), [
    '---',
    'task_id: TASK-SCOPE-0001',
    'title: Prompt scoped task',
    'status: open',
    'files: src/scope.ts',
    '---',
    '',
    '# TASK-SCOPE-0001'
  ].join('\n'), 'utf8');
  const preToolPromptScopedOk = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', promptScopedRepo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', '請實作 TASK-SCOPE-0001',
    '--files', 'src/scope.ts'
  ]);
  assert(preToolPromptScopedOk.ok === true, 'pre-tool hook must allow prompt-scoped in-scope edits');
  const preToolPromptScopedDrift = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', promptScopedRepo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', '請實作 TASK-SCOPE-0001',
    '--files', 'src/other.ts'
  ]);
  assert(preToolPromptScopedDrift.ok === false, 'pre-tool hook must block prompt-scoped out-of-scope edits');
  assert(preToolPromptScopedDrift.messages.some((entry) => entry.code === 'ATM_TOOL_SCOPE_DRIFT_BLOCKED'), 'prompt-scoped drift block must report ATM_TOOL_SCOPE_DRIFT_BLOCKED');

  const planningRepo = makeHostRepo(tempRoot, 'planning-repo');
  const crossRepo = createFrameworkModeStatus({ cwd: planningRepo, targetRepo: frameworkRepo });
  assert(crossRepo.mode === 'cross-repo-target-required', 'planning repo targeting framework repo must require target closure authority');
  assert(crossRepo.closureAuthority === 'target_repo', 'cross-repo framework work must set target_repo closure authority');

  mkdirSync(path.join(planningRepo, 'docs', 'framework-plan'), { recursive: true });
  writeFileSync(path.join(planningRepo, 'docs', 'framework-plan', 'TASK-FRAMEWORK-0001.task.md'), [
    '---',
    'task_id: TASK-FRAMEWORK-0001',
    'status: planned',
    'upstream_repo: ai-atomic-framework',
    '---',
    '',
    '# Framework target task'
  ].join('\n'), 'utf8');
  const inferredCrossRepo = createFrameworkModeStatus({ cwd: planningRepo });
  assert(inferredCrossRepo.mode === 'cross-repo-target-required', 'planning repo task metadata must infer framework target repo');
  assert(inferredCrossRepo.targetRepo === frameworkRepo, 'inferred framework target repo must resolve sibling repository names');

  const preToolCrossRepo = runIntegrationHookInvocation(['pre-tool', '--cwd', planningRepo, '--editor', 'copilot', '--files', path.join(frameworkRepo, 'packages', 'core', 'src', 'index.ts')]);
  assert(preToolCrossRepo.ok === false, 'pre-tool hook must block cross-repo critical framework edits without target claim');

  const preToolCrossRepoTaskCard = runIntegrationHookInvocation(['pre-tool', '--cwd', planningRepo, '--editor', 'copilot', '--files', path.join(planningRepo, 'docs', 'framework-plan', 'TASK-FRAMEWORK-0001.task.md')]);
  assert(preToolCrossRepoTaskCard.ok === false, 'pre-tool hook must block planning repo task-card edits when framework closure authority belongs to the target repo');
  assert(preToolCrossRepoTaskCard.messages.some((entry) => entry.code === 'ATM_INTEGRATION_PRE_TOOL_TARGET_REPO_CLOSURE_REQUIRED'), 'planning task-card block must report target repo closure requirement');

  const preToolCrossRepoTaskCardRead = runIntegrationHookInvocation(['pre-tool', '--cwd', planningRepo, '--editor', 'copilot', '--tool-name', 'Read', '--files', path.join(planningRepo, 'docs', 'framework-plan', 'TASK-FRAMEWORK-0001.task.md')]);
  assert(preToolCrossRepoTaskCardRead.ok === true, 'pre-tool hook must allow read-only inspection of planning task cards');

  const preToolCrossRepoCommit = runIntegrationHookInvocation(['pre-tool', '--cwd', planningRepo, '--editor', 'copilot', '--command', 'git commit -m "close tasks"']);
  assert(preToolCrossRepoCommit.ok === false, 'pre-tool hook must block planning repo commits while framework closure authority belongs to the target repo');
  assert(preToolCrossRepoCommit.messages.some((entry) => entry.code === 'ATM_INTEGRATION_PRE_TOOL_TARGET_REPO_COMMIT_BLOCKED'), 'planning repo commit block must report target repo closure requirement');

  mkdirSync(path.join(planningRepo, 'docs', 'tasks'), { recursive: true });
  writeFileSync(path.join(planningRepo, 'docs', 'tasks', 'TASK-X-0001.task.md'), [
    '---',
    'task_id: TASK-X-0001',
    'status: done',
    '---',
    '',
    '# Task X'
  ].join('\n'), 'utf8');
  const manualAudit = auditTasks(planningRepo);
  assert(manualAudit.ok === false, 'manual Markdown done task must fail tasks audit');
  assert(manualAudit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_MANUAL_DONE'), 'manual done finding must be reported');

  const staticRepo = makeHostRepo(tempRoot, 'static-evidence');
  writeJson(path.join(staticRepo, 'atomic_workbench', 'evidence', 'dogfood-score.json'), {
    status: 'complete',
    score: 72
  });
  const staticAudit = auditTasks(staticRepo);
  assert(staticAudit.ok === true, 'static draft evidence alone should warn but not fail');
  assert(staticAudit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_DRAFT_STATIC_EVIDENCE' && finding.level === 'warning'), 'static evidence warning must be reported');

  writeJson(path.join(planningRepo, '.atm', 'history', 'tasks', 'TASK-X-0002.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-X-0002',
    title: 'Cross repo target task',
    status: 'open',
    owner: 'test-agent',
    closure_authority: 'target_repo',
    target_repo: frameworkRepo
  });
  writeJson(path.join(planningRepo, '.atm', 'history', 'evidence', 'TASK-X-0002.json'), {
    taskId: 'TASK-X-0002',
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'placeholder',
        details: { kind: 'test' }
      }
    ]
  });
  try {
    await runTasks(['close', '--cwd', planningRepo, '--task', 'TASK-X-0002', '--actor', 'test-agent', '--status', 'done']);
    fail('cross-repo target task close should fail in planning repo');
  } catch (error) {
    assert((error as any).code === 'ATM_TASK_CLOSE_TARGET_REPO_REQUIRED', 'cross-repo close must fail with target repo closure error');
  }

  const frameworkWithoutRunner = makeFrameworkRepo(tempRoot, 'framework-without-runner');
  rmSync(path.join(frameworkWithoutRunner, '.atm', 'runtime', 'pinned-runner.json'), { force: true });
  writeJson(path.join(frameworkWithoutRunner, '.atm', 'history', 'tasks', 'TASK-X-0004.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-X-0004',
    title: 'Critical framework task',
    status: 'open',
    owner: 'test-agent',
    scope: ['packages/core/src/index.ts']
  });
  writeJson(path.join(frameworkWithoutRunner, '.atm', 'history', 'evidence', 'TASK-X-0004.json'), {
    taskId: 'TASK-X-0004',
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'placeholder',
        details: { kind: 'test' }
      }
    ]
  });
  try {
    await runTasks(['close', '--cwd', frameworkWithoutRunner, '--task', 'TASK-X-0004', '--actor', 'test-agent', '--status', 'done']);
    fail('critical framework task close should fail without a pinned runner');
  } catch (error) {
    assert((error as any).code === 'ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED', 'framework close must use task scope and fail on framework-development blockers');
  }

  const packet = createClosurePacket({
    cwd: frameworkRepo,
    taskId: 'TASK-X-0003',
    actorId: 'test-agent',
    evidencePath: '.atm/history/evidence/TASK-X-0003.json'
  });
  assert(validateClosurePacket(packet).ok === true, 'generated closure packet must validate');

  const commandStatus = await runFrameworkMode(['status', '--cwd', root, '--files', 'packages/core/src/index.ts', '--json']);
  assert(commandStatus.ok === true, 'framework-mode status command must report ok=true');
  const commandEvidence = commandStatus.evidence as { report?: { mode?: string } };
  assert(commandEvidence.report?.mode === 'required', 'framework-mode command must report required for packages/core file scope');

  if (!process.exitCode) {
    console.log(`[framework-development-governance:${mode}] ok (framework mode detector, task audit, cross-repo closure, and closure packet verified)`);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
