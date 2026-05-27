import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditTasks, classifyFrameworkStaleLock, createFrameworkModeStatus, runFrameworkTempClaim } from '../packages/cli/src/commands/framework-development.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';
import { createValidatorFailureEnvelope } from './lib/validator-envelope.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string): never {
  console.error(`[task-ledger-governance:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string): Record<string, any> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, any>;
}

function sha256File(filePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function assertLastTransitionHashMatchesDisk(repo: string, taskId: string) {
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  const task = readJson(taskPath);
  const transitionId = task.lastTransitionId;
  assert(typeof transitionId === 'string' && transitionId.length > 0, `${taskId} must record lastTransitionId`);
  const eventPath = path.join(repo, '.atm', 'history', 'task-events', taskId, `${transitionId}.json`);
  assert(existsSync(eventPath), `${taskId} transition event must exist`);
  const event = readJson(eventPath);
  assert(event.taskSha256 === sha256File(taskPath), `${taskId} transition event taskSha256 must match persisted task document`);
}

function assertSandboxDiagnosticsAreActionable() {
  const command = 'npm run validate:cli';
  const sandboxEnvelope = createValidatorFailureEnvelope({
    validatorName: 'synthetic-cli',
    command,
    entry: 'scripts/validate-cli.ts',
    mode: 'validate',
    ok: false,
    exitCode: 1,
    stderr: 'Error: spawnSync git EPERM'
  });
  const sandboxFinding = sandboxEnvelope.blockingFindings.find((finding) => finding.code === 'ATM_ENV_SANDBOX_GIT_EPERM');
  assert(sandboxFinding?.classification === 'environment', 'sandbox git EPERM must be an environment finding');
  assert((sandboxFinding?.data as any)?.notTaskEvidenceFailure === true, 'sandbox git EPERM must not be treated as task evidence failure');
  assert(Array.isArray((sandboxFinding?.data as any)?.suggestedCommands), 'sandbox git EPERM must include suggested commands');
  assert(sandboxEnvelope.repairHints.some((hint) => hint.includes('ATM_TEMP_ROOT')), 'sandbox git EPERM repair hint must include ATM_TEMP_ROOT');

  const indexPermissionEnvelope = createValidatorFailureEnvelope({
    validatorName: 'synthetic-git-index',
    command,
    entry: 'scripts/validate-cli.ts',
    mode: 'validate',
    ok: false,
    exitCode: 1,
    stderr: 'fatal: Unable to create C:/repo/.git/index.lock: Permission denied.'
  });
  const indexFinding = indexPermissionEnvelope.blockingFindings.find((finding) => finding.code === 'ATM_GIT_INDEX_PERMISSION_DENIED');
  assert(indexFinding?.classification === 'environment', '.git/index.lock permission denied must be an environment finding');
  assert((indexFinding?.data as any)?.notTaskEvidenceFailure === true, '.git/index.lock permission denied must not be treated as task evidence failure');
}

function initGitRepo(repo: string) {
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
}

function evidenceReport(result: Awaited<ReturnType<typeof runTasks>>): Record<string, any> {
  return (result.evidence as Record<string, any> | undefined)?.report as Record<string, any>;
}

function makeHostRepo(parent: string, name: string, config: Record<string, unknown> = {}) {
  const repo = path.join(parent, name);
  mkdirSync(repo, { recursive: true });
  writeJson(path.join(repo, 'package.json'), { name, type: 'module' });
  writeJson(path.join(repo, '.atm', 'config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: {
      tasks: '.atm/history/tasks',
      taskEvents: '.atm/history/task-events'
    },
    taskLedger: {
      enabled: true,
      mode: 'auto',
      mirrorExternalTasks: true,
      requireCliTransitions: true,
      provider: 'atm-local',
      ...(config.taskLedger as Record<string, unknown> | undefined ?? {})
    }
  });
  return repo;
}

function makeFrameworkRepo(parent: string) {
  const repo = path.join(parent, 'ai-atomic-framework');
  mkdirSync(path.join(repo, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'packages', 'cli', 'src'), { recursive: true });
  writeJson(path.join(repo, 'package.json'), {
    name: 'ai-atomic-framework',
    type: 'module',
    workspaces: ['packages/*']
  });
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const core = true;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'cli', 'src', 'atm.ts'), 'export const cli = true;\n', 'utf8');
  writeJson(path.join(repo, 'atomic-registry.json'), { entries: [] });
  writeJson(path.join(repo, '.atm', 'config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: {
      tasks: '.atm/history/tasks',
      taskEvents: '.atm/history/task-events'
    },
    taskLedger: {
      enabled: true,
      mode: 'auto',
      mirrorExternalTasks: true,
      requireCliTransitions: true,
      provider: 'atm-local'
    }
  });
  writeJson(path.join(repo, '.atm', 'runtime', 'pinned-runner.json'), {
    schemaVersion: 'atm.pinnedRunner.v0.1',
    runnerPath: 'atm.mjs'
  });
  writeFileSync(path.join(repo, 'atm.mjs'), '#!/usr/bin/env node\n', 'utf8');
  return repo;
}

async function expectTaskError(argv: string[], code: string) {
  try {
    await runTasks(argv);
    fail(`tasks ${argv.join(' ')} expected ${code} but succeeded.`);
  } catch (error) {
    assert((error as { code?: string }).code === code, `tasks ${argv.join(' ')} expected ${code}, got ${(error as { code?: string }).code ?? 'unknown'}.`);
  }
}

async function expectTaskErrorDetails(argv: string[], code: string): Promise<Record<string, any>> {
  try {
    await runTasks(argv);
    fail(`tasks ${argv.join(' ')} expected ${code} but succeeded.`);
  } catch (error) {
    assert((error as { code?: string }).code === code, `tasks ${argv.join(' ')} expected ${code}, got ${(error as { code?: string }).code ?? 'unknown'}.`);
    return ((error as { details?: Record<string, any> }).details ?? {}) as Record<string, any>;
  }
}

const sandboxFriendlyTempRoot = existsSync(path.join(root, '.atm-temp'))
  ? path.join(root, '.atm-temp')
  : os.tmpdir();
const tempRoot = mkdtempSync(path.join(sandboxFriendlyTempRoot, 'atm-task-ledger-'));

// Prevent inner git lookups inside the temp scratch repos from walking up into
// the framework repo's working tree. Without this, edits to
// validate-task-ledger-governance.ts itself can be mis-detected as
// TASK-LEDGER-0001 deliverables because the token "ledger" matches both the
// file name and the task id.
const previousGitCeilingDirectories = process.env.GIT_CEILING_DIRECTORIES;
process.env.GIT_CEILING_DIRECTORIES = [process.cwd(), previousGitCeilingDirectories]
  .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  .join(path.delimiter);

try {
  assertSandboxDiagnosticsAreActionable();

  const hostRepo = makeHostRepo(tempRoot, 'ordinary-adopter');
  const hostStatus = createFrameworkModeStatus({ cwd: hostRepo, files: ['src/index.ts'] });
  assert(hostStatus.taskLedgerMode === 'adopter-governed', 'ordinary adopter repo must use adopter-governed task ledger mode');

  const createResult = await runTasks(['create', '--cwd', hostRepo, '--task', 'TASK-LEDGER-0001', '--actor', 'validator', '--title', 'Ledger task']);
  assert(createResult.ok === true, 'tasks create must succeed in adopter-governed mode');
  const createdTaskPath = path.join(hostRepo, '.atm', 'history', 'tasks', 'TASK-LEDGER-0001.json');
  const createdTask = readJson(createdTaskPath);
  assert(typeof createdTask.lastTransitionId === 'string', 'created task must record lastTransitionId');
  assert(existsSync(path.join(hostRepo, '.atm', 'history', 'task-events', 'TASK-LEDGER-0001', `${createdTask.lastTransitionId}.json`)), 'created task transition event must exist');
  assertLastTransitionHashMatchesDisk(hostRepo, 'TASK-LEDGER-0001');

  writeJson(path.join(hostRepo, '.atm', 'history', 'evidence', 'TASK-LEDGER-0001.json'), {
    taskId: 'TASK-LEDGER-0001',
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'validator evidence',
        producedBy: 'validator',
        artifactPaths: [],
        createdAt: new Date().toISOString()
      }
    ]
  });
  const ledgerClaim = await runNext(['--cwd', hostRepo, '--claim', '--actor', 'validator', '--prompt', 'TASK-LEDGER-0001']);
  assert(ledgerClaim.ok === true, 'next --claim must create the direction lock before close');
  const closeResult = await runTasks(['close', '--cwd', hostRepo, '--task', 'TASK-LEDGER-0001', '--actor', 'validator', '--status', 'done']);
  assert(closeResult.ok === true, 'tasks close must succeed with evidence');
  assertLastTransitionHashMatchesDisk(hostRepo, 'TASK-LEDGER-0001');
  assert(auditTasks(hostRepo).ok === true, 'closed task with CLI transition evidence must pass audit');

  const disabledRepo = makeHostRepo(tempRoot, 'disabled-ledger', {
    taskLedger: { enabled: false }
  });
  await expectTaskError(['create', '--cwd', disabledRepo, '--task', 'TASK-LEDGER-0002', '--actor', 'validator'], 'ATM_TASK_LEDGER_DISABLED');
  assert(!existsSync(path.join(disabledRepo, '.atm', 'history', 'tasks', 'TASK-LEDGER-0002.json')), 'disabled task ledger must not create local task files');

  const frameworkRepo = makeFrameworkRepo(tempRoot);
  const frameworkStatus = createFrameworkModeStatus({ cwd: frameworkRepo, files: ['packages/core/src/index.ts'] });
  assert(frameworkStatus.taskLedgerMode === 'framework-development', 'ATM critical source changes must use framework-development task ledger mode');

  const mirrorRepo = makeHostRepo(tempRoot, 'external-mirror', {
    taskLedger: {
      externalTasks: [
        { provider: 'github', taskId: '123', url: 'https://github.com/example/repo/issues/123' }
      ]
    }
  });
  const missingMirrorAudit = auditTasks(mirrorRepo);
  assert(missingMirrorAudit.ok === false, 'declared external task must fail audit until mirrored');
  assert(missingMirrorAudit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_EXTERNAL_TASK_NOT_MIRRORED'), 'missing external mirror finding must be reported');

  const aiManualRepo = makeHostRepo(tempRoot, 'ai-manual-ledger');
  writeJson(path.join(aiManualRepo, '.atm', 'history', 'tasks', 'ATM-GOV-9999.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'ATM-GOV-9999',
    title: 'AI manual task should not persist',
    status: 'open',
    source: {
      planPath: 'manual',
      sectionTitle: 'ATM-GOV-9999',
      headingLine: 1,
      hash: 'manual-ai'
    },
    owner: 'codex-main'
  });
  const aiManualAudit = auditTasks(aiManualRepo);
  assert(aiManualAudit.ok === false, 'AI-issued manual tasks must fail audit');
  assert(aiManualAudit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_AI_MANUAL_TASK_IN_LEDGER'), 'AI-issued manual task finding must be reported');

  const planningOnlyRepo = makeFrameworkRepo(tempRoot);
  writeJson(path.join(planningOnlyRepo, '.atm', 'history', 'tasks', 'TASK-PLAN-0001.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-PLAN-0001',
    title: 'Planning-only done task',
    status: 'done',
    planning_repo: '3KLife',
    target_repo: '3KLife',
    closure_authority: 'planning_repo',
    source: {
      planPath: '../3KLife/docs/plan.md',
      sectionTitle: 'TASK-PLAN-0001',
      headingLine: 1,
      hash: 'planning-only'
    }
  });
  const planningOnlyAudit = auditTasks(planningOnlyRepo);
  assert(planningOnlyAudit.ok === true, 'planning-only done tasks must not block target framework audit');
  assert(planningOnlyAudit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_PLANNING_ONLY_DONE'), 'planning-only done task must be reported as warning');

  const mirrorResult = await runTasks([
    'mirror',
    '--cwd',
    mirrorRepo,
    '--provider',
    'github',
    '--origin-task',
    '123',
    '--origin-url',
    'https://github.com/example/repo/issues/123',
    '--actor',
    'validator',
    '--title',
    'External issue mirror'
  ]);
  assert(mirrorResult.ok === true, 'tasks mirror must succeed');
  assert(auditTasks(mirrorRepo).ok === true, 'mirrored external task must pass audit');

  const mirrorPath = path.join(mirrorRepo, '.atm', 'history', 'tasks', 'MIRROR-GITHUB-123.json');
  const mirrorTask = readJson(mirrorPath);
  delete mirrorTask.lastTransitionId;
  mirrorTask.status = 'done';
  writeJson(mirrorPath, mirrorTask);
  const manualMirrorAudit = auditTasks(mirrorRepo);
  assert(manualMirrorAudit.ok === false, 'hand-edited mirror done task must fail audit');
  assert(manualMirrorAudit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_TRANSITION_EVIDENCE_MISSING'), 'missing transition evidence must be reported');

  const deliverableRepo = makeHostRepo(tempRoot, 'deliverable-gate');
  initGitRepo(deliverableRepo);
  const pipelineTask = await runTasks(['create', '--cwd', deliverableRepo, '--task', 'TASK-PIPE-0001', '--actor', 'validator', '--title', 'Build pipeline runner']);
  assert(pipelineTask.ok === true, 'pipeline task create must succeed');
  const pipelineTaskPath = path.join(deliverableRepo, '.atm', 'history', 'tasks', 'TASK-PIPE-0001.json');
  const pipelineTaskDoc = readJson(pipelineTaskPath);
  pipelineTaskDoc.deliverables = ['pipelines/sanguo-rag/run_bootstrap.py'];
  writeJson(pipelineTaskPath, pipelineTaskDoc);
  const pipelineClaim = await runNext(['--cwd', deliverableRepo, '--claim', '--actor', 'validator', '--prompt', 'TASK-PIPE-0001']);
  assert(pipelineClaim.ok === true, 'next --claim must create a direction lock for the pipeline task');
  writeJson(path.join(deliverableRepo, '.atm', 'history', 'evidence', 'TASK-PIPE-0001.json'), {
    taskId: 'TASK-PIPE-0001',
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'runnable evidence exists, but no deliverable file has changed yet',
      producedBy: 'validator',
      artifactPaths: [],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate pipeline fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  const deliverableError = await expectTaskErrorDetails(['close', '--cwd', deliverableRepo, '--task', 'TASK-PIPE-0001', '--actor', 'validator', '--status', 'done'], 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED');
  assert(typeof deliverableError.deliveryPrinciple === 'string' && deliverableError.deliveryPrinciple.includes('deliver'), 'deliverable gate error must explain that delivery comes before closure');
  assert(Array.isArray(deliverableError.notAllowedAsCompletion) && deliverableError.notAllowedAsCompletion.some((entry: string) => entry.includes('.atm/history')), 'deliverable gate error must reject ledger-only completion');
  mkdirSync(path.join(deliverableRepo, 'pipelines', 'sanguo-rag'), { recursive: true });
  writeFileSync(path.join(deliverableRepo, 'pipelines', 'sanguo-rag', 'run_bootstrap.py'), 'print("bootstrap")\n', 'utf8');
  const pipelineClose = await runTasks(['close', '--cwd', deliverableRepo, '--task', 'TASK-PIPE-0001', '--actor', 'validator', '--status', 'done']);
  assert(pipelineClose.ok === true, 'pipeline task close must pass after a real deliverable diff exists');

  const committedTask = await runTasks(['create', '--cwd', deliverableRepo, '--task', 'TASK-PIPE-0002', '--actor', 'validator', '--title', 'Committed pipeline runner']);
  assert(committedTask.ok === true, 'committed deliverable fixture task create must succeed');
  const committedTaskPath = path.join(deliverableRepo, '.atm', 'history', 'tasks', 'TASK-PIPE-0002.json');
  const committedTaskDoc = readJson(committedTaskPath);
  committedTaskDoc.deliverables = ['pipelines/sanguo-rag/committed_bootstrap.py'];
  writeJson(committedTaskPath, committedTaskDoc);
  const committedClaim = await runNext(['--cwd', deliverableRepo, '--claim', '--actor', 'validator', '--prompt', 'TASK-PIPE-0002']);
  assert(committedClaim.ok === true, 'next --claim must create a direction lock for the committed deliverable task');
  writeJson(path.join(deliverableRepo, '.atm', 'history', 'evidence', 'TASK-PIPE-0002.json'), {
    taskId: 'TASK-PIPE-0002',
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'committed deliverable evidence exists',
      producedBy: 'validator',
      artifactPaths: ['pipelines/sanguo-rag/committed_bootstrap.py'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate committed pipeline fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  writeFileSync(path.join(deliverableRepo, 'pipelines', 'sanguo-rag', 'committed_bootstrap.py'), 'print("committed bootstrap")\n', 'utf8');
  execFileSync('git', ['add', 'pipelines/sanguo-rag/committed_bootstrap.py'], { cwd: deliverableRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add committed bootstrap deliverable'], { cwd: deliverableRepo, stdio: 'ignore' });
  const committedClose = await runTasks(['close', '--cwd', deliverableRepo, '--task', 'TASK-PIPE-0002', '--actor', 'validator', '--status', 'done', '--historical-delivery', 'HEAD']);
  assert(committedClose.ok === true, 'deliverable gate must accept a scoped historical delivery commit');

  const frameworkBatchRepo = makeFrameworkRepo(tempRoot);
  initGitRepo(frameworkBatchRepo);
  execFileSync('git', ['add', '.'], { cwd: frameworkBatchRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial framework fixture'], { cwd: frameworkBatchRepo, stdio: 'ignore' });
  const frameworkBatchTaskId = 'TEST-TASK-BATCH-0052';
  const frameworkBatchTask = await runTasks(['create', '--cwd', frameworkBatchRepo, '--task', frameworkBatchTaskId, '--actor', 'validator', '--title', 'Framework batch delivery runner']);
  assert(frameworkBatchTask.ok === true, 'framework batch dogfood task create must succeed');
  const frameworkBatchTaskPath = path.join(frameworkBatchRepo, '.atm', 'history', 'tasks', `${frameworkBatchTaskId}.json`);
  const frameworkBatchTaskDoc = readJson(frameworkBatchTaskPath);
  frameworkBatchTaskDoc.status = 'ready';
  frameworkBatchTaskDoc.deliverables = ['packages/cli/src/commands/batch.ts'];
  writeJson(frameworkBatchTaskPath, frameworkBatchTaskDoc);
  const frameworkBatchClaim = await runNext(['--cwd', frameworkBatchRepo, '--claim', '--actor', 'validator', '--task', frameworkBatchTaskId]);
  assert(frameworkBatchClaim.ok === true, 'framework batch dogfood task must be claimable before critical diff');
  writeJson(path.join(frameworkBatchRepo, '.atm', 'history', 'evidence', `${frameworkBatchTaskId}.json`), {
    taskId: frameworkBatchTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'framework batch checkpoint dogfood evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
      artifactPaths: ['packages/cli/src/commands/batch.ts'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate framework batch checkpoint fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  mkdirSync(path.join(frameworkBatchRepo, 'packages', 'cli', 'src', 'commands'), { recursive: true });
  writeFileSync(path.join(frameworkBatchRepo, 'packages', 'cli', 'src', 'commands', 'batch.ts'), 'export const cli = "batch delivery";\n', 'utf8');
  const directFrameworkClose = await expectTaskErrorDetails(['close', '--cwd', frameworkBatchRepo, '--task', frameworkBatchTaskId, '--actor', 'validator', '--status', 'done'], 'ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE');
  assert(directFrameworkClose.frameworkDeliveryWindow?.requiredCommand?.includes('git commit'), 'normal active framework diff error must point to governed delivery commit');
  assert(String(directFrameworkClose.frameworkDeliveryWindow?.remediation ?? '').includes(`tasks close --task ${frameworkBatchTaskId}`) && String(directFrameworkClose.frameworkDeliveryWindow?.remediation ?? '').includes('--historical-delivery'), 'normal active framework diff remediation must point to historical-delivery close');
  const checkpointFrameworkClose = await runTasks(['close', '--cwd', frameworkBatchRepo, '--task', frameworkBatchTaskId, '--actor', 'validator', '--status', 'done', '--from-batch-checkpoint', '--batch', 'batch-dogfood']);
  assert(checkpointFrameworkClose.ok === true, 'batch checkpoint must close scoped framework critical diff without requiring a pre-checkpoint commit');
  assertLastTransitionHashMatchesDisk(frameworkBatchRepo, frameworkBatchTaskId);

  const resetRepo = makeHostRepo(tempRoot, 'reset-release');
  const resetCreate = await runTasks(['create', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator', '--title', 'Resettable task']);
  assert(resetCreate.ok === true, 'reset fixture task create must succeed');
  await runTasks(['reserve', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator']);
  await expectTaskError(['release', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator'], 'ATM_TASK_CLAIM_MISSING');
  const reservedRelease = await runTasks(['release', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator', '--reserved-ok', '--reason', 'rollback cleanup']);
  assert(reservedRelease.ok === true, 'reserved task without claim must release with --reserved-ok');
  await runTasks(['reserve', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator']);
  const resetOpen = await runTasks(['reset', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator', '--to', 'open', '--reason', 'rollback cleanup']);
  assert(resetOpen.ok === true, 'reserved task must reset back to open');

  const legacyRepo = makeHostRepo(tempRoot, 'legacy-ledger');
  writeJson(path.join(legacyRepo, '.atm', 'history', 'tasks', 'TASK-LEGACY-0001.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-LEGACY-0001',
    title: 'Legacy JSON done task',
    status: 'done'
  });
  const legacyMarkdownPath = path.join(legacyRepo, 'docs', 'tasks', 'TASK-LEGACY-0002.task.md');
  mkdirSync(path.dirname(legacyMarkdownPath), { recursive: true });
  writeFileSync(legacyMarkdownPath, [
    '---',
    'task_id: TASK-LEGACY-0002',
    'title: Legacy Markdown done task',
    'status: done',
    '---',
    '',
    '# Legacy Markdown done task',
    ''
  ].join('\n'), 'utf8');
  const legacyAuditBefore = auditTasks(legacyRepo);
  assert(legacyAuditBefore.ok === false, 'legacy done tasks without transition evidence must fail audit before migration');
  assert(legacyAuditBefore.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_MANUAL_DONE'), 'legacy done tasks must be reported as manual done before migration');
  const legacyDryRun = await runTasks(['migrate-legacy-ledger', '--cwd', legacyRepo, '--actor', 'validator', '--dry-run']);
  assert(legacyDryRun.ok === true, 'legacy ledger dry-run must succeed');
  assert(evidenceReport(legacyDryRun).migratableTaskCount === 2, 'legacy ledger dry-run must find both JSON and Markdown legacy tasks');
  const legacyApply = await runTasks(['migrate-legacy-ledger', '--cwd', legacyRepo, '--actor', 'validator', '--apply']);
  assert(legacyApply.ok === true, 'legacy ledger apply must succeed');
  const migratedJsonTask = readJson(path.join(legacyRepo, '.atm', 'history', 'tasks', 'TASK-LEGACY-0001.json'));
  assert(migratedJsonTask.ledgerBaselineKind === 'legacy-transition-backfill', 'JSON task must record legacy baseline kind');
  assert(typeof migratedJsonTask.lastTransitionId === 'string', 'JSON task must record migrated lastTransitionId');
  assertLastTransitionHashMatchesDisk(legacyRepo, 'TASK-LEGACY-0001');
  const migratedMarkdownText = readFileSync(legacyMarkdownPath, 'utf8');
  assert(migratedMarkdownText.includes('ledgerBaselineKind: legacy-transition-backfill'), 'Markdown task must record legacy baseline kind');
  assert(migratedMarkdownText.includes('lastTransitionId:'), 'Markdown task must record migrated lastTransitionId');
  const legacyAuditAfter = auditTasks(legacyRepo);
  assert(legacyAuditAfter.ok === true, 'legacy tasks with baseline transition evidence must pass audit');
  assert(legacyAuditAfter.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_LEGACY_BASELINE_DONE'), 'legacy baseline done warning must remain visible');

  // Regression: TASK-AAO-0038 import contract fidelity — nested evidence/rollback, legacy alias diagnostics, planning_repo-authority ledger snapshot.
  const fidelityRepo = makeHostRepo(tempRoot, 'import-fidelity');
  const fidelityPlanDir = path.join(fidelityRepo, 'docs', 'plan', 'tasks');
  mkdirSync(fidelityPlanDir, { recursive: true });
  writeFileSync(path.join(fidelityPlanDir, 'TASK-IMPORT-0001.task.md'), [
    '---',
    'task_id: TASK-IMPORT-0001',
    'title: "Nested machine fields card"',
    'status: planned',
    'target_repo: ImportFidelityRepo',
    'planning_repo: PlanningRepoExample',
    'closure_authority: target_repo',
    'scopePaths:',
    '  - "packages/cli/src/commands/tasks.ts"',
    'deliverables:',
    '  - "packages/cli/src/commands/tasks.ts"',
    'validators:',
    '  - "npm run typecheck"',
    'evidence:',
    '  required: command-backed',
    'rollback:',
    '  strategy: revert-commit',
    '  notes: "Restore previous projection on regression."',
    'atomizationImpact:',
    '  ownerAtomOrMap: "atm.task-ledger-governance-map"',
    '  mapUpdates:',
    '    - "atomic_workbench/atomization-coverage/path-to-atom-map.json"',
    'outOfScope:',
    '  - "Changing task-card authoring format"',
    '---',
    '# TASK-IMPORT-0001',
    ''
  ].join('\n'), 'utf8');
  const importDryRun = await runTasks(['import', '--cwd', fidelityRepo, '--from', path.join('docs', 'plan', 'tasks', 'TASK-IMPORT-0001.task.md'), '--dry-run', '--json']);
  const importManifest = (importDryRun.evidence as any).manifest ?? {};
  const importedTask = Array.isArray(importManifest.tasks) ? importManifest.tasks[0] : null;
  assert(importedTask, 'tasks import --dry-run must yield a parsed task');
  assert(importedTask.evidenceRequired === 'command-backed', 'import must unpack nested evidence.required into evidenceRequired');
  assert(importedTask.rollbackStrategy === 'revert-commit', 'import must unpack nested rollback.strategy into rollbackStrategy');
  assert(typeof importedTask.rollbackNotes === 'string' && importedTask.rollbackNotes.includes('Restore previous projection'), 'import must unpack nested rollback.notes into rollbackNotes');
  assert(importedTask.targetRepo === 'ImportFidelityRepo', 'import must preserve target_repo as targetRepo');
  assert(importedTask.planningRepo === 'PlanningRepoExample', 'import must preserve planning_repo as planningRepo');
  assert(importedTask.closureAuthority === 'target_repo', 'import must preserve closure_authority as closureAuthority');
  assert(Array.isArray(importedTask.outOfScope) && importedTask.outOfScope[0]?.includes('task-card authoring format'), 'import must preserve outOfScope as machine field');
  assert(importedTask.atomizationImpact?.ownerAtomOrMap === 'atm.task-ledger-governance-map', 'import must preserve nested atomizationImpact.ownerAtomOrMap');
  assert(Array.isArray(importedTask.atomizationImpact?.mapUpdates) && importedTask.atomizationImpact.mapUpdates.includes('atomic_workbench/atomization-coverage/path-to-atom-map.json'), 'import must preserve nested atomizationImpact.mapUpdates');

  const writeImport = await runTasks(['import', '--cwd', fidelityRepo, '--from', path.join('docs', 'plan', 'tasks', 'TASK-IMPORT-0001.task.md'), '--write', '--json']);
  assert(writeImport.ok === true, 'tasks import --write must succeed for fidelity card');
  const fidelityLedger = readJson(path.join(fidelityRepo, '.atm', 'history', 'tasks', 'TASK-IMPORT-0001.json'));
  assert(fidelityLedger.evidenceRequired === 'command-backed', 'ledger JSON must persist nested evidence.required after --write');
  assert(fidelityLedger.rollbackStrategy === 'revert-commit', 'ledger JSON must persist nested rollback.strategy after --write');
  assert(typeof fidelityLedger.rollbackNotes === 'string' && fidelityLedger.rollbackNotes.includes('Restore previous projection'), 'ledger JSON must persist nested rollback.notes after --write');
  assert(fidelityLedger.targetRepo === 'ImportFidelityRepo', 'ledger JSON must persist targetRepo after --write');
  assert(fidelityLedger.planningRepo === 'PlanningRepoExample', 'ledger JSON must persist planningRepo after --write');
  assert(fidelityLedger.closureAuthority === 'target_repo', 'ledger JSON must persist closureAuthority after --write');

  // Regression: legacy allowed_files alias must downgrade with a diagnostic, not silently drop scope.
  writeFileSync(path.join(fidelityPlanDir, 'TASK-IMPORT-0002.task.md'), [
    '---',
    'task_id: TASK-IMPORT-0002',
    'title: "Legacy allowed_files card"',
    'status: planned',
    'target_repo: ImportFidelityRepo',
    'allowed_files:',
    '  - "packages/cli/src/commands/tasks.ts"',
    '  - "packages/cli/src/commands/next.ts"',
    'blocked_by:',
    '  - "TASK-OTHER-0099"',
    '---',
    '# TASK-IMPORT-0002',
    ''
  ].join('\n'), 'utf8');
  const legacyAliasImport = await runTasks(['import', '--cwd', fidelityRepo, '--from', path.join('docs', 'plan', 'tasks', 'TASK-IMPORT-0002.task.md'), '--dry-run', '--json']);
  const legacyAliasManifest = (legacyAliasImport.evidence as any).manifest ?? {};
  const legacyAliasTask = Array.isArray(legacyAliasManifest.tasks) ? legacyAliasManifest.tasks[0] : null;
  assert(legacyAliasTask, 'tasks import --dry-run must yield a legacy alias task');
  assert(Array.isArray(legacyAliasTask.scopePaths) && legacyAliasTask.scopePaths.includes('packages/cli/src/commands/tasks.ts'), 'legacy allowed_files must project into scopePaths');
  assert(Array.isArray(legacyAliasTask.dependencies) && legacyAliasTask.dependencies.includes('TASK-OTHER-0099'), 'legacy blocked_by must project into dependencies');
  const aliasDiagnostics = Array.isArray(legacyAliasTask.importDiagnostics) ? legacyAliasTask.importDiagnostics : [];
  assert(aliasDiagnostics.some((entry: any) => entry?.code === 'ATM_TASK_IMPORT_LEGACY_ALIAS' && entry?.alias === 'allowed_files' && entry?.canonical === 'scopePaths'), 'legacy allowed_files must emit ATM_TASK_IMPORT_LEGACY_ALIAS diagnostic');
  assert(aliasDiagnostics.some((entry: any) => entry?.code === 'ATM_TASK_IMPORT_LEGACY_ALIAS' && entry?.alias === 'blocked_by' && entry?.canonical === 'depends_on'), 'legacy blocked_by must emit ATM_TASK_IMPORT_LEGACY_ALIAS diagnostic');
  assert(legacyAliasTask.legacyImportAliases?.allowed_files, 'legacy alias lineage must be preserved on the import record');

  // TASK-AAO-0050: stale framework lock classification.
  const staleLockActorId = 'stale-lock-test-actor';
  const staleLockTaskId = `ATM-FRAMEWORK-TEMP-${staleLockActorId}`;
  const staleLockPath = path.join(fidelityRepo, '.atm', 'runtime', 'locks', `${staleLockTaskId}.lock.json`);
  const staleLockLinkedTask = 'TASK-STALE-DEMO-0001';
  const staleLockCurrentTask = 'TASK-STALE-DEMO-0002';
  writeJson(path.join(fidelityRepo, '.atm', 'history', 'tasks', `${staleLockLinkedTask}.json`), {
    schemaId: 'atm.workItem.v0.2',
    workItemId: staleLockLinkedTask,
    title: 'Stale lock regression demo task',
    status: 'done',
    closedAt: new Date().toISOString()
  });
  writeJson(staleLockPath, {
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: staleLockTaskId,
    lockedBy: staleLockActorId,
    lockedAt: new Date().toISOString(),
    actorId: staleLockActorId,
    leaseId: `lease-stale-test`,
    heartbeatAt: new Date().toISOString(),
    ttlSeconds: 86400,
    files: ['packages/cli/src/commands/framework-development.ts'],
    linkedTaskId: staleLockLinkedTask
  });
  const staleLockInfo = classifyFrameworkStaleLock(fidelityRepo, staleLockActorId, { currentTaskId: staleLockCurrentTask });
  assert(staleLockInfo, 'classifyFrameworkStaleLock must detect the active stale lock');
  assert(staleLockInfo!.kind === 'stale-completed', `stale lock kind must be stale-completed, got ${staleLockInfo!.kind}`);
  assert(staleLockInfo!.linkedTaskId === staleLockLinkedTask, 'stale lock must report linked task id');
  assert(staleLockInfo!.currentTaskId === staleLockCurrentTask, 'stale lock must report the current task id');
  assert(staleLockInfo!.lockPath.endsWith(`${staleLockTaskId}.lock.json`), 'stale lock must report the lock path');
  assert(staleLockInfo!.actorId === staleLockActorId, 'stale lock must report actor id');
  assert(staleLockInfo!.requiredCommand.includes('framework-mode release'), 'stale lock requiredCommand must include framework-mode release');
  let staleClaimErrorCode: string | null = null;
  let staleClaimRequiredCommand = '';
  try {
    await runFrameworkTempClaim(fidelityRepo, staleLockActorId, ['packages/cli/src/commands/hook.ts'], 'new task claim');
    staleClaimErrorCode = null;
  } catch (error: any) {
    staleClaimErrorCode = error?.code ?? null;
    staleClaimRequiredCommand = String(error?.details?.requiredCommand ?? '');
  }
  assert(staleClaimErrorCode === 'ATM_FRAMEWORK_STALE_LOCK_CLEANUP_REQUIRED', `framework-mode claim must throw ATM_FRAMEWORK_STALE_LOCK_CLEANUP_REQUIRED for stale lock, got ${staleClaimErrorCode}`);
  assert(staleClaimRequiredCommand.includes('framework-mode release') && staleClaimRequiredCommand.includes('framework-mode claim'), 'stale lock claim error must include release-then-claim guidance');
  rmSync(staleLockPath, { force: true });

  if (!process.exitCode) {
    console.log(`[task-ledger-governance:${mode}] ok (dual ledger modes, visible mirrors, CLI transitions, disabled ledger, AI manual task rejection, legacy baseline migration, TASK-AAO-0038 import contract fidelity, TASK-AAO-0050 stale framework lock classification, and TASK-AAO-0053 batch framework delivery window verified)`);
  }
} finally {
  if (previousGitCeilingDirectories === undefined) {
    delete process.env.GIT_CEILING_DIRECTORIES;
  } else {
    process.env.GIT_CEILING_DIRECTORIES = previousGitCeilingDirectories;
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
