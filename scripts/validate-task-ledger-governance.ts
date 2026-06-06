import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditTasks, classifyFrameworkStaleLock, createClosurePacket, createFrameworkModeStatus, inspectFrameworkCloseWorktree, runFrameworkTempClaim, validateClosurePacket, writeClosurePacket } from '../packages/cli/src/commands/framework-development.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';
import { parseClaimRecord, createClaimRecord, isClaimExpired, listRuntimeLockTaskIds } from '../packages/cli/src/commands/tasks/task-ledger-readers.ts';
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
  const pipelineFixtureTaskId = 'TEST-TASK-0001';
  const committedFixtureTaskId = 'TEST-TASK-0002';
  const pipelineTask = await runTasks(['create', '--cwd', deliverableRepo, '--task', pipelineFixtureTaskId, '--actor', 'validator', '--title', 'Build pipeline runner test fixture']);
  assert(pipelineTask.ok === true, 'pipeline test fixture task create must succeed');
  const pipelineTaskPath = path.join(deliverableRepo, '.atm', 'history', 'tasks', `${pipelineFixtureTaskId}.json`);
  const pipelineTaskDoc = readJson(pipelineTaskPath);
  pipelineTaskDoc.deliverables = ['pipelines/sanguo-rag/run_bootstrap.py'];
  writeJson(pipelineTaskPath, pipelineTaskDoc);
  const pipelineClaim = await runNext(['--cwd', deliverableRepo, '--claim', '--actor', 'validator', '--prompt', pipelineFixtureTaskId]);
  assert(pipelineClaim.ok === true, 'next --claim must create a direction lock for the pipeline test fixture task');
  writeJson(path.join(deliverableRepo, '.atm', 'history', 'evidence', `${pipelineFixtureTaskId}.json`), {
    taskId: pipelineFixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'test fixture evidence exists, but no deliverable file has changed yet',
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
  const deliverableError = await expectTaskErrorDetails(['close', '--cwd', deliverableRepo, '--task', pipelineFixtureTaskId, '--actor', 'validator', '--status', 'done'], 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED');
  assert(typeof deliverableError.deliveryPrinciple === 'string' && deliverableError.deliveryPrinciple.includes('deliver'), 'deliverable gate error must explain that delivery comes before closure');
  assert(Array.isArray(deliverableError.notAllowedAsCompletion) && deliverableError.notAllowedAsCompletion.some((entry: string) => entry.includes('.atm/history')), 'deliverable gate error must reject ledger-only completion');
  mkdirSync(path.join(deliverableRepo, 'pipelines', 'sanguo-rag'), { recursive: true });
  writeFileSync(path.join(deliverableRepo, 'pipelines', 'sanguo-rag', 'run_bootstrap.py'), 'print("bootstrap")\n', 'utf8');
  const pipelineClose = await runTasks(['close', '--cwd', deliverableRepo, '--task', pipelineFixtureTaskId, '--actor', 'validator', '--status', 'done']);
  assert(pipelineClose.ok === true, 'pipeline test fixture close must pass after a real deliverable diff exists');

  const committedTask = await runTasks(['create', '--cwd', deliverableRepo, '--task', committedFixtureTaskId, '--actor', 'validator', '--title', 'Committed pipeline runner test fixture']);
  assert(committedTask.ok === true, 'committed deliverable fixture task create must succeed');
  const committedTaskPath = path.join(deliverableRepo, '.atm', 'history', 'tasks', `${committedFixtureTaskId}.json`);
  const committedTaskDoc = readJson(committedTaskPath);
  committedTaskDoc.deliverables = ['pipelines/sanguo-rag/committed_bootstrap.py'];
  writeJson(committedTaskPath, committedTaskDoc);
  const committedClaim = await runNext(['--cwd', deliverableRepo, '--claim', '--actor', 'validator', '--prompt', committedFixtureTaskId]);
  assert(committedClaim.ok === true, 'next --claim must create a direction lock for the committed deliverable task');
  writeJson(path.join(deliverableRepo, '.atm', 'history', 'evidence', `${committedFixtureTaskId}.json`), {
    taskId: committedFixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'committed test fixture deliverable evidence exists',
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
  const committedClose = await runTasks(['close', '--cwd', deliverableRepo, '--task', committedFixtureTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', 'HEAD']);
  assert(committedClose.ok === true, 'deliverable gate must accept a scoped historical delivery commit');

  const runnerReleaseFixtureTaskId = 'TEST-TASK-0004';
  const runnerReleaseTask = await runTasks(['create', '--cwd', deliverableRepo, '--task', runnerReleaseFixtureTaskId, '--actor', 'validator', '--title', 'Committed runner release fixture']);
  assert(runnerReleaseTask.ok === true, 'runner release fixture task create must succeed');
  const runnerReleaseTaskPath = path.join(deliverableRepo, '.atm', 'history', 'tasks', `${runnerReleaseFixtureTaskId}.json`);
  const runnerReleaseTaskDoc = readJson(runnerReleaseTaskPath);
  runnerReleaseTaskDoc.scopePaths = ['release/atm-onefile/atm.mjs', 'release/atm-onefile/release-manifest.json'];
  runnerReleaseTaskDoc.deliverables = ['release/atm-onefile/atm.mjs', 'release/atm-onefile/release-manifest.json'];
  writeJson(runnerReleaseTaskPath, runnerReleaseTaskDoc);
  const runnerReleaseClaim = await runNext(['--cwd', deliverableRepo, '--claim', '--actor', 'validator', '--prompt', runnerReleaseFixtureTaskId]);
  assert(runnerReleaseClaim.ok === true, 'next --claim must create a direction lock for the runner release fixture task');
  writeJson(path.join(deliverableRepo, '.atm', 'history', 'evidence', `${runnerReleaseFixtureTaskId}.json`), {
    taskId: runnerReleaseFixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'runner release fixture deliverable evidence exists',
      producedBy: 'validator',
      artifactPaths: ['release/atm-onefile/atm.mjs', 'release/atm-onefile/release-manifest.json'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate runner release fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  mkdirSync(path.join(deliverableRepo, 'release', 'atm-onefile'), { recursive: true });
  writeFileSync(path.join(deliverableRepo, 'release', 'atm-onefile', 'atm.mjs'), 'export const runner = true;\n', 'utf8');
  writeJson(path.join(deliverableRepo, 'release', 'atm-onefile', 'release-manifest.json'), { runner: true });
  execFileSync('git', ['add', 'release/atm-onefile/atm.mjs', 'release/atm-onefile/release-manifest.json'], { cwd: deliverableRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add scoped runner release deliverables'], { cwd: deliverableRepo, stdio: 'ignore' });
  const runnerReleaseClose = await runTasks(['close', '--cwd', deliverableRepo, '--task', runnerReleaseFixtureTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', 'HEAD']);
  assert(runnerReleaseClose.ok === true, 'deliverable gate must accept declared runner release historical delivery files');

  const undeclaredReleaseFixtureTaskId = 'TEST-TASK-0005';
  const undeclaredReleaseTask = await runTasks(['create', '--cwd', deliverableRepo, '--task', undeclaredReleaseFixtureTaskId, '--actor', 'validator', '--title', 'Undeclared release noise fixture']);
  assert(undeclaredReleaseTask.ok === true, 'undeclared release fixture task create must succeed');
  const undeclaredReleaseTaskPath = path.join(deliverableRepo, '.atm', 'history', 'tasks', `${undeclaredReleaseFixtureTaskId}.json`);
  const undeclaredReleaseTaskDoc = readJson(undeclaredReleaseTaskPath);
  undeclaredReleaseTaskDoc.scopePaths = ['src/ordinary-deliverable.ts'];
  undeclaredReleaseTaskDoc.deliverables = ['src/ordinary-deliverable.ts'];
  undeclaredReleaseTaskDoc.source = { planPath: '../planning/ordinary-deliverable.task.md' };
  writeJson(undeclaredReleaseTaskPath, undeclaredReleaseTaskDoc);
  const undeclaredReleaseClaim = await runNext(['--cwd', deliverableRepo, '--claim', '--actor', 'validator', '--prompt', undeclaredReleaseFixtureTaskId]);
  assert(undeclaredReleaseClaim.ok === true, 'next --claim must create a direction lock for the undeclared release fixture task');
  writeJson(path.join(deliverableRepo, '.atm', 'history', 'evidence', `${undeclaredReleaseFixtureTaskId}.json`), {
    taskId: undeclaredReleaseFixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'undeclared release fixture evidence exists',
      producedBy: 'validator',
      artifactPaths: ['src/ordinary-deliverable.ts'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate undeclared release fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  const undeclaredReleaseError = await expectTaskErrorDetails(['close', '--cwd', deliverableRepo, '--task', undeclaredReleaseFixtureTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', 'HEAD'], 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED');
  assert(undeclaredReleaseError.historicalDeliveries?.[0]?.reason === 'no-scoped-deliverable-files', 'undeclared release historical delivery must remain excluded from deliverable credit');

  const lockScopedFixtureTaskId = 'TEST-TASK-0003';
  const lockScopedTask = await runTasks(['create', '--cwd', deliverableRepo, '--task', lockScopedFixtureTaskId, '--actor', 'validator', '--title', 'Build claim scoped runner fixture']);
  assert(lockScopedTask.ok === true, 'claim-scoped deliverable fixture task create must succeed');
  const lockScopedTaskPath = path.join(deliverableRepo, '.atm', 'history', 'tasks', `${lockScopedFixtureTaskId}.json`);
  const lockScopedTaskDoc = readJson(lockScopedTaskPath);
  lockScopedTaskDoc.scopePaths = ['docs/planning-only.task.md'];
  lockScopedTaskDoc.source = { planPath: '../planning/docs/planning-only.task.md' };
  writeJson(lockScopedTaskPath, lockScopedTaskDoc);
  const lockScopedClaim = await runNext(['--cwd', deliverableRepo, '--claim', '--actor', 'validator', '--prompt', lockScopedFixtureTaskId]);
  assert(lockScopedClaim.ok === true, 'next --claim must create a direction lock for the planning-only fixture');
  const lockScopedClaimedTaskDoc = readJson(lockScopedTaskPath);
  const absoluteClaimScopedRunner = path.join(deliverableRepo, 'src', 'claim-scoped-runner.ts');
  lockScopedClaimedTaskDoc.taskDirectionLock = {
    ...(lockScopedClaimedTaskDoc.taskDirectionLock ?? {}),
    allowedFiles: [absoluteClaimScopedRunner]
  };
  lockScopedClaimedTaskDoc.claim = {
    ...(lockScopedClaimedTaskDoc.claim ?? {}),
    files: [absoluteClaimScopedRunner]
  };
  writeJson(lockScopedTaskPath, lockScopedClaimedTaskDoc);
  writeJson(path.join(deliverableRepo, '.atm', 'history', 'evidence', `${lockScopedFixtureTaskId}.json`), {
    taskId: lockScopedFixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'claim-scoped deliverable evidence exists',
      producedBy: 'validator',
      artifactPaths: ['src/claim-scoped-runner.ts'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate claim scoped fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  mkdirSync(path.join(deliverableRepo, 'src'), { recursive: true });
  writeFileSync(path.join(deliverableRepo, 'src', 'claim-scoped-runner.ts'), 'export const claimScopedRunner = true;\n', 'utf8');
  const lockScopedClose = await runTasks(['close', '--cwd', deliverableRepo, '--task', lockScopedFixtureTaskId, '--actor', 'validator', '--status', 'done']);
  assert(lockScopedClose.ok === true, 'deliverable gate must accept absolute claim/taskDirectionLock allowed files when planning scopePaths are read-only');

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

  // Regression: TASK-AAO-0057 close-gate scoped diff isolation — unrelated dirty
  // framework critical files outside the task scope must be isolated as advisory
  // and must not raise ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE. The task's own scoped
  // deliverable diff still has to be governed (here via --historical-delivery).
  const isolationRepo = makeFrameworkRepo(tempRoot);
  initGitRepo(isolationRepo);
  execFileSync('git', ['add', '.'], { cwd: isolationRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial framework fixture'], { cwd: isolationRepo, stdio: 'ignore' });
  const isolationTaskId = 'TEST-TASK-ISOLATION-0057';
  const isolationTaskCreate = await runTasks(['create', '--cwd', isolationRepo, '--task', isolationTaskId, '--actor', 'validator', '--title', 'Scoped diff isolation fixture']);
  assert(isolationTaskCreate.ok === true, 'isolation fixture task create must succeed');
  const isolationTaskPath = path.join(isolationRepo, '.atm', 'history', 'tasks', `${isolationTaskId}.json`);
  const isolationTaskDoc = readJson(isolationTaskPath);
  isolationTaskDoc.status = 'ready';
  isolationTaskDoc.scopePaths = ['packages/cli/src/commands/batch.ts'];
  isolationTaskDoc.deliverables = ['packages/cli/src/commands/batch.ts'];
  writeJson(isolationTaskPath, isolationTaskDoc);
  const isolationClaim = await runNext(['--cwd', isolationRepo, '--claim', '--actor', 'validator', '--task', isolationTaskId]);
  assert(isolationClaim.ok === true, 'isolation fixture task must be claimable');
  writeJson(path.join(isolationRepo, '.atm', 'history', 'evidence', `${isolationTaskId}.json`), {
    taskId: isolationTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'isolation fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
      artifactPaths: ['packages/cli/src/commands/batch.ts'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate scoped diff isolation fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  mkdirSync(path.join(isolationRepo, 'packages', 'cli', 'src', 'commands'), { recursive: true });
  // Scoped deliverable: modified and committed so HEAD carries the in-scope diff.
  writeFileSync(path.join(isolationRepo, 'packages', 'cli', 'src', 'commands', 'batch.ts'), 'export const cli = "scoped delivery";\n', 'utf8');
  execFileSync('git', ['add', 'packages/cli/src/commands/batch.ts'], { cwd: isolationRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'scoped delivery commit for isolation fixture'], { cwd: isolationRepo, stdio: 'ignore' });
  // Unrelated tracked change: dirty in the working tree, outside the task scope.
  // This mirrors package-lock/package.json style repo-level churn that must stay advisory.
  const unrelatedRelativePath = 'package.json';
  writeJson(path.join(isolationRepo, unrelatedRelativePath), {
    name: 'ai-atomic-framework',
    version: '0.0.0',
    unrelatedDirty: true
  });
  const isolationClose = await runTasks(['close', '--cwd', isolationRepo, '--task', isolationTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', 'HEAD']);
  assert(isolationClose.ok === true, 'close must succeed when only unrelated critical files are dirty (scoped diff isolation)');
  const isolationDiagnosticRaw = (isolationClose.evidence as Record<string, any>)?.closeScopedDiffIsolation as Record<string, any> | null;
  assert(isolationDiagnosticRaw, 'close result must expose closeScopedDiffIsolation diagnostic in framework mode');
  const isolationDiagnostic = isolationDiagnosticRaw!;
  assert(isolationDiagnostic.schemaId === 'atm.taskCloseScopedDiffIsolation.v1', 'isolation diagnostic must declare its schema id');
  assert(Array.isArray(isolationDiagnostic.isolatedUnrelatedChanges) && isolationDiagnostic.isolatedUnrelatedChanges.includes(unrelatedRelativePath), 'unrelated dirty critical file must appear in isolatedUnrelatedChanges');
  assert(Array.isArray(isolationDiagnostic.scopedCriticalChangedFiles) && !isolationDiagnostic.scopedCriticalChangedFiles.includes(unrelatedRelativePath), 'unrelated dirty critical file must not be classified as scoped');
  assert(Array.isArray(isolationDiagnostic.advisoryTrackedDirtyFiles) && isolationDiagnostic.advisoryTrackedDirtyFiles.includes(unrelatedRelativePath), 'unrelated tracked dirty file must be isolated into advisoryTrackedDirtyFiles');
  assert(!Array.isArray(isolationDiagnostic.blockingTrackedDirtyFiles) || !isolationDiagnostic.blockingTrackedDirtyFiles.includes(unrelatedRelativePath), 'unrelated tracked dirty file must not be promoted into blockingTrackedDirtyFiles');
  assert(Array.isArray(isolationDiagnostic.declaredFiles) && isolationDiagnostic.declaredFiles.includes('packages/cli/src/commands/batch.ts'), 'isolation diagnostic must echo declared scope paths');
  assertLastTransitionHashMatchesDisk(isolationRepo, isolationTaskId);

  // Regression: TASK-MRP-0028 closure packets describe the delivery parent commit,
  // so tracked dirty framework files must fail before close can write a packet.
  const dirtyCloseRepo = makeFrameworkRepo(tempRoot);
  initGitRepo(dirtyCloseRepo);
  execFileSync('git', ['add', '.'], { cwd: dirtyCloseRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial dirty-close fixture'], { cwd: dirtyCloseRepo, stdio: 'ignore' });
  const dirtyCloseTaskId = 'TEST-TASK-MRP-0028-DIRTY-CLOSE';
  const dirtyCloseTaskCreate = await runTasks(['create', '--cwd', dirtyCloseRepo, '--task', dirtyCloseTaskId, '--actor', 'validator', '--title', 'Dirty framework close fixture']);
  assert(dirtyCloseTaskCreate.ok === true, 'dirty-close fixture task create must succeed');
  const dirtyCloseTaskPath = path.join(dirtyCloseRepo, '.atm', 'history', 'tasks', `${dirtyCloseTaskId}.json`);
  const dirtyCloseTaskDoc = readJson(dirtyCloseTaskPath);
  dirtyCloseTaskDoc.status = 'ready';
  dirtyCloseTaskDoc.scopePaths = ['package.json'];
  dirtyCloseTaskDoc.deliverables = ['package.json'];
  writeJson(dirtyCloseTaskPath, dirtyCloseTaskDoc);
  const dirtyCloseClaim = await runNext(['--cwd', dirtyCloseRepo, '--claim', '--actor', 'validator', '--task', dirtyCloseTaskId]);
  assert(dirtyCloseClaim.ok === true, 'dirty-close fixture task must be claimable');
  writeJson(path.join(dirtyCloseRepo, '.atm', 'history', 'evidence', `${dirtyCloseTaskId}.json`), {
    taskId: dirtyCloseTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'dirty close fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
      artifactPaths: ['package.json'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate dirty close fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  writeJson(path.join(dirtyCloseRepo, 'package.json'), { name: 'ai-atomic-framework', version: '0.0.0', delivery: true });
  execFileSync('git', ['add', 'package.json'], { cwd: dirtyCloseRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'package delivery for dirty close fixture'], { cwd: dirtyCloseRepo, stdio: 'ignore' });
  writeJson(path.join(dirtyCloseRepo, 'package.json'), { name: 'ai-atomic-framework', version: '0.0.0', delivery: true, dirty: true });
  const dirtyCloseError = await expectTaskErrorDetails(['close', '--cwd', dirtyCloseRepo, '--task', dirtyCloseTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', 'HEAD'], 'ATM_TASK_CLOSE_DIRTY_WORKTREE');
  assert((dirtyCloseError.trackedDirtyFiles ?? []).includes('package.json'), 'dirty close error must report tracked dirty files');
  assert(String(dirtyCloseError.remediation ?? '').includes('delivery parent commit'), 'dirty close remediation must explain parent-commit closure semantics');

  const repairRepo = makeFrameworkRepo(tempRoot);
  initGitRepo(repairRepo);
  execFileSync('git', ['add', '.'], { cwd: repairRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial repair fixture'], { cwd: repairRepo, stdio: 'ignore' });
  const repairTaskId = 'TASK-REPAIR-CLOSURE-0001';
  const repairTaskPath = path.join(repairRepo, '.atm', 'history', 'tasks', `${repairTaskId}.json`);
  writeJson(repairTaskPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: repairTaskId,
    title: 'Repair closure fixture',
    status: 'done',
    closurePacket: `.atm/history/evidence/${repairTaskId}.closure-packet.json`
  });
  writeJson(path.join(repairRepo, '.atm', 'history', 'evidence', `${repairTaskId}.json`), {
    taskId: repairTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'repair closure fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
      artifactPaths: ['package.json'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate repair closure fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        stderrSha256: 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
      }]
    }]
  });
  writeJson(path.join(repairRepo, 'package.json'), { name: 'ai-atomic-framework', version: '0.0.0', delivery: true });
  execFileSync('git', ['add', 'package.json'], { cwd: repairRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'package delivery for repair fixture'], { cwd: repairRepo, stdio: 'ignore' });
  const repairDeliveryCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repairRepo, encoding: 'utf8' }).trim();
  const repairClosurePacketPath = `.atm/history/evidence/${repairTaskId}.closure-packet.json`;
  const repairClosurePacketAbsolute = path.join(repairRepo, repairClosurePacketPath);
  const createdPacket = createClosurePacket({
    cwd: repairRepo,
    taskId: repairTaskId,
    actorId: 'validator',
    evidencePath: `.atm/history/evidence/${repairTaskId}.json`,
    changedFiles: ['package.json']
  });
  writeClosurePacket(repairRepo, repairTaskId, createdPacket);
  const brokenPacket = readJson(repairClosurePacketAbsolute);
  brokenPacket.targetCommit = 'broken-target-commit';
  brokenPacket.governedTreeSha = 'broken-governed-tree';
  brokenPacket.targetCommitDelta = {
    ...brokenPacket.targetCommitDelta,
    currentCommitSha: 'broken-current-commit',
    parentCommitShas: [],
    governedTreeSha: 'broken-governed-tree',
    changedFiles: []
  };
  writeJson(repairClosurePacketAbsolute, brokenPacket);
  const noHooksDir = path.join(repairRepo, '.atm-temp-hooks');
  mkdirSync(noHooksDir, { recursive: true });
  execFileSync('git', ['add', '.'], { cwd: repairRepo, stdio: 'ignore' });
  execFileSync('git', ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'broken closure packet fixture'], { cwd: repairRepo, stdio: 'ignore' });
  const brokenRepairHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repairRepo, encoding: 'utf8' }).trim();

  const repairStageOnlyResult = await runTasks(['repair-closure', '--cwd', repairRepo, '--task', repairTaskId, '--json']);
  assert(repairStageOnlyResult.ok === true, 'tasks repair-closure must succeed in default stage-only mode');
  const repairStageOnlyEvidence = repairStageOnlyResult.evidence as Record<string, any>;
  assert(repairStageOnlyEvidence.result?.amended === false, 'tasks repair-closure must not rewrite HEAD by default');
  assert(repairStageOnlyEvidence.result?.previousHead === brokenRepairHead, 'tasks repair-closure must report the pre-repair HEAD');
  assert(repairStageOnlyEvidence.result?.repairedHead === brokenRepairHead, 'tasks repair-closure stage-only mode must leave HEAD unchanged');
  assert(repairStageOnlyEvidence.nextAction?.kind === 'governed-commit-required', 'tasks repair-closure must return a governed follow-up action');
  assert(String(repairStageOnlyEvidence.nextAction?.command ?? '').includes(`node atm.mjs git commit --actor <actor-id> --task ${repairTaskId}`), 'tasks repair-closure must recommend the governed git commit wrapper');
  assert(!String(repairStageOnlyEvidence.nextAction?.command ?? '').includes('--no-verify'), 'tasks repair-closure must not recommend --no-verify as the standard historical ledger restore path');
  const repairedPacket = readJson(repairClosurePacketAbsolute);
  assert(repairedPacket.targetCommit === repairDeliveryCommit, 'tasks repair-closure must realign targetCommit to the delivery parent commit');
  assert(Array.isArray(repairedPacket.targetCommitDelta?.parentCommitShas) && repairedPacket.targetCommitDelta.parentCommitShas[0] === repairDeliveryCommit, 'tasks repair-closure must realign parent commit shas to HEAD parents');
  const repairCachedFiles = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repairRepo, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  assert(repairCachedFiles.includes(repairClosurePacketPath), 'tasks repair-closure must stage the repaired closure packet');
  assert(repairCachedFiles.includes('.atm/history/evidence/git-head.jsonl'), 'tasks repair-closure must stage git-head evidence for the follow-up governed commit');
  assert(!repairCachedFiles.includes(`.atm/history/tasks/${repairTaskId}.json`), 'tasks repair-closure must not mutate historical task JSON just to provide repair context');
  assert(repairCachedFiles.some((entry) => entry.startsWith(`.atm/history/task-events/${repairTaskId}/`) && entry.includes('-repair-closure-')), 'tasks repair-closure must stage a repair-closure task transition event as evidence context');
  execFileSync('git', ['commit', '--no-verify', '-m', 'repair closure packet fixture'], { cwd: repairRepo, stdio: 'ignore' });

  const amendUnavailableDetails = await expectTaskErrorDetails(['repair-closure', '--cwd', repairRepo, '--task', repairTaskId, '--amend'], 'ATM_CLOSURE_REPAIR_AMEND_WRAPPER_UNAVAILABLE');
  assert(String(amendUnavailableDetails.requiredCommand ?? '').includes(`node atm.mjs git commit --actor <actor-id> --task ${repairTaskId}`), 'repair-closure --amend must redirect to the governed git commit wrapper');

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

  // Regression: TASK-AAO-0055 historical done task reconcile / reopen closure sync
  const reconcileRepo = makeFrameworkRepo(tempRoot);
  initGitRepo(reconcileRepo);
  const reconcileTaskId = 'TASK-RECONCILE-0001';

  const planPath = path.join(reconcileRepo, 'docs', 'plan', 'tasks', `${reconcileTaskId}.task.md`);
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, [
    '---',
    'task_id: TASK-RECONCILE-0001',
    'title: "Reconcile test task"',
    'status: done',
    'scopePaths:',
    '  - "src/reconcile-file.ts"',
    'deliverables:',
    '  - "src/reconcile-file.ts"',
    '---',
    '# TASK-RECONCILE-0001'
  ].join('\n'), 'utf8');

  // 1. 匯入任務至 ledger
  const reconcileImport = await runTasks(['import', '--cwd', reconcileRepo, '--from', planPath, '--write', '--json']);
  assert(reconcileImport.ok === true, 'reconcile import must succeed');

  // 2. 判定 next 診斷：因為是 planning done + ledger open，next 應該主動診斷出 task-reconcile-suggested 並建議 tasks reconcile 路由！
  const reconcileNext = await runNext(['--cwd', reconcileRepo, '--prompt', reconcileTaskId]);
  assert(reconcileNext.ok === true, 'next command for reconcile task must succeed');
  const nextAction = (reconcileNext.evidence as any).nextAction;
  assert(nextAction.status === 'task-reconcile-suggested', `next status must be task-reconcile-suggested, got ${nextAction.status}`);
  assert(nextAction.recommendedChannel === 'reconcile', `next channel must be reconcile, got ${nextAction.recommendedChannel}`);
  assert(nextAction.requiredCommand.includes('tasks reconcile'), 'next requiredCommand must point to tasks reconcile');

  // 3. 在 Git 當中建立一個 commit 作為歷史 commit，並包含 deliverables 檔案！
  mkdirSync(path.join(reconcileRepo, 'src'), { recursive: true });
  writeFileSync(path.join(reconcileRepo, 'src', 'reconcile-file.ts'), 'export const reconciled = true;\n', 'utf8');
  execFileSync('git', ['add', 'src/reconcile-file.ts'], { cwd: reconcileRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'deliver TASK-RECONCILE-0001 changes'], { cwd: reconcileRepo, stdio: 'ignore' });
  const gitCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: reconcileRepo, encoding: 'utf8' }).trim();

  // 4. 執行 tasks reconcile 子命令！
  const reconcileResult = await runTasks([
    'reconcile',
    '--cwd',
    reconcileRepo,
    '--task',
    reconcileTaskId,
    '--actor',
    'validator',
    '--delivery-commit',
    gitCommitSha
  ]);
  assert(reconcileResult.ok === true, 'tasks reconcile must succeed with a valid historical delivery commit');

  // 5. 驗證 ledger 閉環！
  const reconciledTaskDoc = readJson(path.join(reconcileRepo, '.atm', 'history', 'tasks', `${reconcileTaskId}.json`));
  assert(reconciledTaskDoc.status === 'done', 'reconciled task status must be done');
  assert(typeof reconciledTaskDoc.closedAt === 'string', 'reconciled task closedAt must exist');
  assert(reconciledTaskDoc.closedByActor === 'validator', 'reconciled task closedByActor must be validator');
  assert(typeof reconciledTaskDoc.closurePacket === 'string', 'reconciled task closurePacket path must exist');

  // 驗證 closure packet 存在且有效
  const closurePacketPath = path.resolve(reconcileRepo, reconciledTaskDoc.closurePacket);
  assert(existsSync(closurePacketPath), 'closure packet must exist');
  const closurePacket = readJson(closurePacketPath);
  assert(closurePacket.taskId === reconcileTaskId, 'closure packet taskId must match');

  // TASK-AAO-0059: Reconcile closure-packet attestation contract alignment
  assert(closurePacket.attestation, 'reconciled closure packet must contain attestation');
  assert(closurePacket.attestation.schemaId === 'atm.reconcileAttestation.v1', 'attestation schemaId must match');
  assert(closurePacket.attestation.deliveryCommit === gitCommitSha, 'attestation deliveryCommit must match');
  assert(closurePacket.attestation.reconciledByActor === 'validator', 'attestation reconciledByActor must match');
  assert(typeof closurePacket.attestation.reconciledAt === 'string', 'attestation reconciledAt must exist');
  assert(closurePacket.attestation.reason.includes(gitCommitSha), 'attestation reason must describe the sync');

  // 驗證向後相容性：沒有 attestation 的舊 packet 依然可以通過 validateClosurePacket
  const legacyPacket = { ...closurePacket };
  delete legacyPacket.attestation;
  const legacyValidation = validateClosurePacket(legacyPacket);
  assert(legacyValidation.ok === true, 'validateClosurePacket must accept a legacy closure packet without attestation');

  // 驗證 evidence 檔案已補齊
  const evidencePath = path.join(reconcileRepo, '.atm', 'history', 'evidence', `${reconcileTaskId}.json`);
  assert(existsSync(evidencePath), 'reconciled task evidence must exist');
  const evidenceDoc = readJson(evidencePath);
  assert(evidenceDoc.evidence.some((entry: any) => entry.details?.action === 'reconcile'), 'evidence must record reconcile transition');

  // TASK-AAO-0056: tasks deliver-and-close macro
  const deliverMacroRepo = makeHostRepo(tempRoot, 'deliver-macro-repo');
  initGitRepo(deliverMacroRepo);
  // Write actor git identity so runAtmGit commit can create governed commits
  writeJson(path.join(deliverMacroRepo, '.atm', 'runtime', 'identity', 'default.json'), {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'validator',
    gitName: 'ATM Validator',
    gitEmail: 'validator@example.invalid',
    editor: null,
    provider: null,
    activeSessionId: null,
    updatedAt: new Date().toISOString()
  });
  const deliverMacroTaskId = 'TASK-DELIVER-0001';
  const deliverMacroTaskPath = path.join(deliverMacroRepo, '.atm', 'history', 'tasks', `${deliverMacroTaskId}.json`);
  const deliverMacroPlanDir = path.join(deliverMacroRepo, 'docs', 'plan', 'tasks');
  mkdirSync(deliverMacroPlanDir, { recursive: true });
  // Create a plan file and import it so the task is in the ledger (status: open → ready via reserve+promote is complex; use ready directly)
  writeFileSync(path.join(deliverMacroPlanDir, `${deliverMacroTaskId}.task.md`), [
    '---',
    `task_id: ${deliverMacroTaskId}`,
    'title: "Deliver macro test task"',
    'status: open',
    'scopePaths:',
    '  - "src/deliver.ts"',
    'deliverables:',
    '  - "src/deliver.ts"',
    '---',
    `# ${deliverMacroTaskId}`,
    'Deliver macro test task for TASK-AAO-0056 validator.',
    ''
  ].join('\n'), 'utf8');
  const deliverMacroImport = await runTasks([
    'import', '--cwd', deliverMacroRepo,
    '--from', path.join('docs', 'plan', 'tasks', `${deliverMacroTaskId}.task.md`),
    '--write', '--json'
  ]);
  assert(deliverMacroImport.ok === true, `tasks import must succeed for deliver-and-close setup, got: ${JSON.stringify(deliverMacroImport.messages)}`);
  // Move task to ready status so next --claim can pick it up
  const deliverMacroTaskDocRaw = readJson(deliverMacroTaskPath);
  writeJson(deliverMacroTaskPath, { ...deliverMacroTaskDocRaw, status: 'ready' });
  // Use next --claim to properly set up the direction lock (tasks claim alone does not embed taskDirectionLock)
  const deliverMacroClaim = await runNext([
    '--cwd', deliverMacroRepo,
    '--claim',
    '--actor', 'validator',
    '--prompt', deliverMacroTaskId,
    '--json'
  ]);
  assert(deliverMacroClaim.ok === true, `next --claim must succeed before deliver-and-close, got: ${JSON.stringify(deliverMacroClaim.messages)}`);
  // Create and commit a real deliverable to satisfy the deliverable gate
  mkdirSync(path.join(deliverMacroRepo, 'src'), { recursive: true });
  writeFileSync(path.join(deliverMacroRepo, 'src', 'deliver.ts'), 'export const delivered = true;\n', 'utf8');
  execFileSync('git', ['add', 'src/deliver.ts'], { cwd: deliverMacroRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'feat: deliver TASK-DELIVER-0001'], { cwd: deliverMacroRepo, stdio: 'ignore' });
  const deliverMacroCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: deliverMacroRepo, encoding: 'utf8' }).trim();
  // Write minimal command-backed evidence to satisfy the evidence gate (code task needs commit or test evidence)
  const deliverMacroEvidencePath = path.join(deliverMacroRepo, '.atm', 'history', 'evidence', `${deliverMacroTaskId}.json`);
  writeJson(deliverMacroEvidencePath, {
    schemaId: 'atm.evidence.v1',
    taskId: deliverMacroTaskId,
    generatedAt: new Date().toISOString(),
    evidence: [
      {
        evidenceType: 'commit',
        summary: `Delivery commit for ${deliverMacroTaskId}: ${deliverMacroCommitSha}`,
        producedBy: 'validator',
        createdAt: new Date().toISOString(),
        details: { commitSha: deliverMacroCommitSha, message: 'feat: deliver TASK-DELIVER-0001' }
      }
    ]
  });
  // Run tasks deliver-and-close with the pre-existing delivery commit (skips Phase 1 auto-stage)
  const deliverMacroResult = await runTasks([
    'deliver-and-close',
    '--cwd', deliverMacroRepo,
    '--task', deliverMacroTaskId,
    '--actor', 'validator',
    '--delivery-commit', deliverMacroCommitSha,
    '--json'
  ]);
  assert(deliverMacroResult.ok === true, `tasks deliver-and-close must succeed, got: ${JSON.stringify(deliverMacroResult.messages)}`);
  const deliverMacroEvidence = deliverMacroResult.evidence as Record<string, any>;
  assert(deliverMacroEvidence.action === 'deliver-and-close', 'deliver-and-close evidence action must match');
  assert(deliverMacroEvidence.deliveryCommitSha === deliverMacroCommitSha, 'deliver-and-close evidence must record the delivery commit SHA');
  assert(typeof deliverMacroEvidence.closureCommitSha === 'string' && deliverMacroEvidence.closureCommitSha.length > 0, 'deliver-and-close must create a governance commit and record its SHA');
  // Verify the task was closed properly
  const deliverMacroTaskDoc = readJson(deliverMacroTaskPath);
  assert(deliverMacroTaskDoc.status === 'done', `task must be done after deliver-and-close, got: ${deliverMacroTaskDoc.status}`);
  assert(typeof deliverMacroTaskDoc.closedAt === 'string', 'task closedAt must be set after deliver-and-close');
  assert(deliverMacroTaskDoc.closedByActor === 'validator', 'task closedByActor must match the actor');
  // Verify HEAD equals the governance commit SHA (deliver-and-close created the final commit)
  const deliverMacroHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: deliverMacroRepo, encoding: 'utf8' }).trim();
  assert(deliverMacroHead === deliverMacroEvidence.closureCommitSha, 'HEAD must equal the governance commit SHA after deliver-and-close');
  // Verify error path: missing task throws ATM_TASK_NOT_FOUND
  let deliverMacroDryRunError: string | null = null;
  try {
    await runTasks([
      'deliver-and-close',
      '--cwd', deliverMacroRepo,
      '--task', 'TASK-DELIVER-9999',
      '--actor', 'validator',
      '--dry-run',
      '--json'
    ]);
  } catch (error: any) {
    deliverMacroDryRunError = error?.code ?? 'UNKNOWN';
  }
  assert(deliverMacroDryRunError === 'ATM_TASK_NOT_FOUND', `deliver-and-close dry-run on missing task must throw ATM_TASK_NOT_FOUND, got: ${deliverMacroDryRunError}`);

  await validateTaskLedgerReadersAtomization(tempRoot);
  await validatePlanningOnlyLedgerAuditBoundary(tempRoot);
  await validateClosurePacketDirtyTreeHygieneGuard(tempRoot);
  await validateTaskImportRefreshClaimPreservation(tempRoot);

  if (!process.exitCode) {
    console.log(`[task-ledger-governance:${mode}] ok (dual ledger modes, visible mirrors, CLI transitions, disabled ledger, AI manual task rejection, legacy baseline migration, TASK-AAO-0038 import contract fidelity, TASK-AAO-0050 stale framework lock classification, TEST-TASK fixture id clarity, TASK-AAO-0053 batch framework delivery window, TASK-AAO-0055 historical done task reconcile closure sync, TASK-AAO-0056 deliver-and-close macro end-to-end, TASK-AAO-0057 close-gate scoped diff isolation, TASK-AAO-0061 task-ledger-readers atomization verified, and TASK-AAO-0039 planning-only ledger audit boundary covered)`);
  }
} finally {
  if (previousGitCeilingDirectories === undefined) {
    delete process.env.GIT_CEILING_DIRECTORIES;
  } else {
    process.env.GIT_CEILING_DIRECTORIES = previousGitCeilingDirectories;
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

async function validateTaskLedgerReadersAtomization(tempRoot: string) {
  // 1. 驗證 createClaimRecord 與 parseClaimRecord
  const timestamp = new Date().toISOString();
  const input = {
    taskId: 'TASK-ATOM-9999',
    actorId: 'atom-agent',
    files: ['src/atom.ts', 'src/sub/helper.ts'],
    ttlSeconds: 300,
    timestamp
  };
  const record = createClaimRecord(input);
  assert(record.actorId === 'atom-agent', 'createClaimRecord actorId must match');
  assert(record.leaseId.startsWith('lease-'), 'createClaimRecord leaseId must start with lease-');
  assert(record.claimedAt === timestamp, 'createClaimRecord claimedAt must match');
  assert(record.files.includes('src/atom.ts'), 'createClaimRecord files must preserve normalized relative paths');

  const parsed = parseClaimRecord(record);
  assert(parsed !== null, 'parseClaimRecord must successfully parse valid claim record');
  assert(parsed!.actorId === 'atom-agent', 'parseClaimRecord actorId must match');
  assert(parsed!.ttlSeconds === 300, 'parseClaimRecord ttlSeconds must match');

  // 2. 驗證 isClaimExpired
  assert(isClaimExpired(record, new Date(Date.parse(timestamp) + 100 * 1000).toISOString()) === false, 'isClaimExpired must be false before TTL expiration');
  assert(isClaimExpired(record, new Date(Date.parse(timestamp) + 400 * 1000).toISOString()) === true, 'isClaimExpired must be true after TTL expiration');

  // 3. 驗證 listRuntimeLockTaskIds 在 adopter-governed 目錄下運作正常
  const dummyRepo = makeHostRepo(tempRoot, 'atom-ledger-readers-locks-test');
  const locksDir = path.join(dummyRepo, '.atm', 'runtime', 'locks');
  mkdirSync(locksDir, { recursive: true });
  writeFileSync(path.join(locksDir, 'TASK-LOCK-0001.lock.json'), JSON.stringify({}), 'utf8');
  writeFileSync(path.join(locksDir, 'TASK-LOCK-0002.lock.json'), JSON.stringify({}), 'utf8');

  const lockTaskIds = listRuntimeLockTaskIds(dummyRepo);
  assert(lockTaskIds.includes('TASK-LOCK-0001'), 'listRuntimeLockTaskIds must list TASK-LOCK-0001');
  assert(lockTaskIds.includes('TASK-LOCK-0002'), 'listRuntimeLockTaskIds must list TASK-LOCK-0002');
}

async function validatePlanningOnlyLedgerAuditBoundary(tempRoot: string) {
  const boundaryRepo = makeFrameworkRepo(tempRoot);
  initGitRepo(boundaryRepo);

  // 1. 測試 `planning-only` done 任務：
  // 它的 closure_authority === 'planning_repo' 且 target_repo 指向外部 '3KLife'，沒有 closure packet。
  const planOnlyTaskId = 'TASK-PLAN-ONLY-0001';
  writeJson(path.join(boundaryRepo, '.atm', 'history', 'tasks', `${planOnlyTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: planOnlyTaskId,
    title: 'Planning-only done card example',
    status: 'done',
    planningRepo: '3KLife',
    targetRepo: '3KLife',
    closureAuthority: 'planning_repo',
    source: {
      planPath: '../3KLife/docs/plan.md',
      sectionTitle: planOnlyTaskId,
      headingLine: 1,
      hash: 'plan-only-boundary'
    }
  });

  // 2. 測試 `external-planning` 外部 target-repo 任務：
  // 它的 closure_authority === 'target_repo'，但 target_repo 指向外部 '3KLife'，沒有 closure packet。
  const extTaskId = 'TASK-EXT-0001';
  writeJson(path.join(boundaryRepo, '.atm', 'history', 'tasks', `${extTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: extTaskId,
    title: 'External-planning done card example',
    status: 'done',
    planningRepo: '3KLife',
    targetRepo: '3KLife',
    closureAuthority: 'target_repo',
    source: {
      planPath: '../3KLife/docs/plan.md',
      sectionTitle: extTaskId,
      headingLine: 10,
      hash: 'external-planning-boundary'
    }
  });

  // 3. 測試本專案的 done 任務 (target-authority)
  // 它的 closure_authority === 'target_repo'，且 target_repo 指向本 repo 'ai-atomic-framework'，缺少 closure packet。
  const targetTaskId = 'TASK-TARGET-0001';
  writeJson(path.join(boundaryRepo, '.atm', 'history', 'tasks', `${targetTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: targetTaskId,
    title: 'Target-authority done card example',
    status: 'done',
    planningRepo: '3KLife',
    targetRepo: 'ai-atomic-framework',
    closureAuthority: 'target_repo',
    source: {
      planPath: '../3KLife/docs/plan.md',
      sectionTitle: targetTaskId,
      headingLine: 20,
      hash: 'target-authority-boundary'
    }
  });

  const auditReport = auditTasks(boundaryRepo);

  // 驗證 ok 應為 false，因為 targetTaskId (本專案的 done 任務) 缺少 closure packet，被列為 error 阻擋！
  assert(auditReport.ok === false, 'audit must fail because of the missing local target closure packet');

  const planOnlyFinding = auditReport.findings.find((f) => f.taskId === planOnlyTaskId);
  assert(planOnlyFinding !== undefined, 'planning-only finding must exist');
  assert(planOnlyFinding!.level === 'warning', 'planning-only done task must be a warning');
  assert(planOnlyFinding!.code === 'ATM_TASK_AUDIT_PLANNING_ONLY_DONE', 'planning-only code must match');
  assert(planOnlyFinding!.detail.includes('[planning-only]'), 'planning-only detail must have [planning-only] prefix');
  assert(planOnlyFinding!.detail.includes('tasks import'), 'planning-only warning must suggest sync/import action');

  const extFinding = auditReport.findings.find((f) => f.taskId === extTaskId);
  console.log('DEBUG extFinding:', JSON.stringify(extFinding, null, 2));
  console.log('DEBUG allFindings:', JSON.stringify(auditReport.findings, null, 2));
  assert(extFinding !== undefined, 'external-planning finding must exist');
  assert(extFinding!.level === 'warning', 'external-planning done task must be a warning');
  assert(extFinding!.code === 'ATM_TASK_AUDIT_CROSS_REPO_DONE_WITHOUT_PACKET', 'external-planning code must match');
  assert(extFinding!.detail.includes('[external-planning]'), 'external-planning detail must have [external-planning] prefix');
  assert(extFinding!.detail.includes('tasks import'), 'external-planning warning must suggest sync/import action');

  const targetFinding = auditReport.findings.find((f) => f.taskId === targetTaskId && f.code === 'ATM_TASK_AUDIT_MANUAL_DONE');
  assert(targetFinding !== undefined, 'target-authority finding must exist');
  assert(targetFinding!.level === 'error', 'target-authority done task must be an error');
  assert(targetFinding!.code === 'ATM_TASK_AUDIT_MANUAL_DONE', 'target-authority code must match');
  assert(targetFinding!.detail.includes('[target-authority]'), 'target-authority detail must have [target-authority] prefix');
}

async function validateClosurePacketDirtyTreeHygieneGuard(tempRoot: string) {
  const hygieneRepo = makeFrameworkRepo(tempRoot);
  initGitRepo(hygieneRepo);
  execFileSync('git', ['add', '.'], { cwd: hygieneRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial hygiene repo'], { cwd: hygieneRepo, stdio: 'ignore' });

  const taskId = 'TASK-HYGIENE-0001';
  const taskPath = path.join(hygieneRepo, '.atm', 'history', 'tasks', `${taskId}.json`);

  writeJson(taskPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Hygiene guard test task',
    status: 'ready',
    targetRepo: 'ai-atomic-framework',
    closureAuthority: 'target_repo',
    deliverables: ['packages/cli/src/commands/batch.ts'],
    scopePaths: ['packages/cli/src/commands/batch.ts']
  });

  const claimResult = await runNext(['--cwd', hygieneRepo, '--claim', '--actor', 'validator', '--prompt', taskId, '--json']);
  assert(claimResult.ok === true, 'next --claim must succeed for hygiene test task');

  const taskDoc = readJson(taskPath);
  const targetAllowedFiles = Array.isArray(taskDoc.targetAllowedFiles) ? [...taskDoc.targetAllowedFiles] : [];
  targetAllowedFiles.push(path.join(hygieneRepo, 'packages', 'cli', 'src', 'commands', 'allowed-untracked.ts'));
  writeJson(taskPath, { ...taskDoc, targetAllowedFiles });

  const deliverableFilePath = path.join(hygieneRepo, 'packages', 'cli', 'src', 'commands', 'batch.ts');
  const allowedUntrackedFilePath = path.join(hygieneRepo, 'packages', 'cli', 'src', 'commands', 'allowed-untracked.ts');
  const noiseFilePath = path.join(hygieneRepo, 'scratch', 'noise.json');

  mkdirSync(path.dirname(deliverableFilePath), { recursive: true });
  writeFileSync(deliverableFilePath, 'export const batch = true;\n', 'utf8');

  mkdirSync(path.dirname(allowedUntrackedFilePath), { recursive: true });
  writeFileSync(allowedUntrackedFilePath, 'export const allowed = true;\n', 'utf8');

  mkdirSync(path.dirname(noiseFilePath), { recursive: true });
  writeFileSync(noiseFilePath, '{"noise": true}\n', 'utf8');

  const closeWorktree = inspectFrameworkCloseWorktree(hygieneRepo, taskId);
  assert(closeWorktree.untrackedFiles.includes('packages/cli/src/commands/allowed-untracked.ts'), 'allowed untracked must be in untrackedFiles');
  assert(!closeWorktree.untrackedFiles.includes('scratch/noise.json'), 'noise must not be in untrackedFiles');
  assert(closeWorktree.ignoredUntrackedFiles.includes('scratch/noise.json'), 'noise must be in ignoredUntrackedFiles');

  const packet = createClosurePacket({
    cwd: hygieneRepo,
    taskId,
    actorId: 'validator',
    evidencePath: `.atm/history/evidence/${taskId}.json`
  });

  const changedFiles = packet.targetCommitDelta.changedFiles;
  assert(changedFiles.includes('packages/cli/src/commands/allowed-untracked.ts'), 'changedFiles must include allowed untracked');
  assert(!changedFiles.includes('scratch/noise.json'), 'changedFiles must exclude untracked noise');
}

async function validateTaskImportRefreshClaimPreservation(tempRoot: string) {
  const repo = makeHostRepo(tempRoot, 'import-refresh-claim-preservation');
  initGitRepo(repo);

  const taskId = 'TASK-REFRESH-0001';
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);

  const planPath = path.join(repo, 'docs', 'plan', 'tasks', `${taskId}.task.md`);
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, [
    '---',
    `task_id: ${taskId}`,
    'title: "Refresh preservation test task"',
    'status: open',
    'scopePaths:',
    '  - "src/dummy.ts"',
    'deliverables:',
    '  - "src/dummy.ts"',
    '---',
    `# ${taskId}`,
    ''
  ].join('\n'), 'utf8');

  const importResult = await runTasks(['import', '--cwd', repo, '--from', planPath, '--write', '--json']);
  assert(importResult.ok === true, 'import must succeed');

  const taskDoc = readJson(taskPath);
  writeJson(taskPath, { ...taskDoc, status: 'ready' });

  const claimResult = await runNext(['--cwd', repo, '--claim', '--actor', 'validator', '--prompt', taskId, '--json']);
  assert(claimResult.ok === true, 'claim must succeed');

  const claimedDoc = readJson(taskPath);
  assert(claimedDoc.status === 'running', 'claimed status must be running');
  assert(claimedDoc.claim && claimedDoc.claim.state === 'active', 'active claim record must exist');
  assert(claimedDoc.taskDirectionLock, 'taskDirectionLock must exist');

  const refreshResult = await runTasks(['import', '--cwd', repo, '--from', planPath, '--write', '--force', '--json']);
  assert(refreshResult.ok === true, 'import refresh must succeed');

  const refreshedDoc = readJson(taskPath);
  assert(refreshedDoc.status === 'running', 'running status must be preserved after refresh');
  assert(refreshedDoc.claim && refreshedDoc.claim.state === 'active', 'active claim must be preserved after refresh');
  assert(refreshedDoc.taskDirectionLock, 'taskDirectionLock must be preserved after refresh');
  assert(refreshedDoc.owner === 'validator', 'owner validator must be preserved after refresh');
  assert(refreshedDoc.startedBySessionId === claimedDoc.startedBySessionId, 'startedBySessionId must be preserved after refresh');
}
