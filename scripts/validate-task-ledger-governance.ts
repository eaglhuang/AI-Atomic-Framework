import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditTasks, createFrameworkModeStatus } from '../packages/cli/src/commands/framework-development.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';

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

try {
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

  if (!process.exitCode) {
    console.log(`[task-ledger-governance:${mode}] ok (dual ledger modes, visible mirrors, CLI transitions, disabled ledger, AI manual task rejection, and legacy baseline migration verified)`);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
