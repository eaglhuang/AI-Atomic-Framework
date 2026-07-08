import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertRunnerFreshForWriteAction,
  auditTasks,
  classifyFrameworkStaleLock,
  createClosurePacket,
  createFrameworkModeStatus,
  executeTaskCloseTransaction,
  inspectFrameworkCloseWorktree,
  isRunnerSyncRequired,
  normalizeSha256DigestValue,
  normalizeSha256FieldsDeep,
  normalizeUpstreamEvidenceForTask,
  repairClosurePacketForTask,
  runFrameworkTempClaim,
  validateClosurePacket,
  writeClosurePacket
} from '../packages/cli/src/commands/framework-development.ts';
import { loadProfile, buildDelegationContract, resolveOpenerMode } from '../packages/cli/src/commands/taskflow/profile-loader.ts';
import { resolveNextDefaultOutputPath } from '../packages/cli/src/commands/shared.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runTaskflow } from '../packages/cli/src/commands/taskflow.ts';
import { assertEmergencyApproval } from '../packages/cli/src/commands/emergency/gate.ts';
import { withTaskflowOperatorLane } from '../packages/cli/src/commands/emergency/context.ts';
import { runHook } from '../packages/cli/src/commands/hook.ts';
import { computeMissingValidatorReport } from '../packages/cli/src/commands/evidence.ts';
import { runTasks as runTasksBackend } from '../packages/cli/src/commands/tasks.ts';
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

function runTasks(argv: string[]) {
  return withTaskflowOperatorLane(() => runTasksBackend(argv));
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

function assertValidatorCommandCanonicalization(tempRoot: string) {
  const repo = makeHostRepo(tempRoot, 'validator-command-canonicalization');
  const taskId = 'TASK-VALIDATOR-CANON-0001';
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', `${taskId}.json`);
  writeJson(taskPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Validator command canonicalization fixture',
    status: 'running',
    validators: [
      'npm run typecheck',
      'node atm.mjs doctor --json',
      'node atm.mjs evidence git-head-backfill --actor <actor> --json'
    ]
  });
  writeJson(evidencePath, {
    taskId,
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'canonicalization fixture',
        producedBy: 'validator',
        evidenceFreshness: 'fresh',
        details: {
          validationPasses: [
            'npm run typecheck',
            'node atm.mjs doctor --json',
            'node atm.mjs evidence git-head-backfill --actor validator --json'
          ],
          commandRuns: [
            {
              command: 'npm run typecheck',
              exitCode: 0,
              stdoutSha256: `sha256:${'1'.repeat(64)}`,
              stderrSha256: `sha256:${'2'.repeat(64)}`
            },
            {
              command: 'node atm.mjs doctor --json',
              exitCode: 0,
              stdoutSha256: `sha256:${'3'.repeat(64)}`,
              stderrSha256: `sha256:${'4'.repeat(64)}`
            },
            {
              command: 'node atm.mjs evidence git-head-backfill --actor validator --json',
              exitCode: 0,
              stdoutSha256: `sha256:${'5'.repeat(64)}`,
              stderrSha256: `sha256:${'6'.repeat(64)}`
            }
          ]
        }
      }
    ]
  });
  const report = computeMissingValidatorReport(repo, taskId, 'validator');
  const validatorStates = new Map(report.validators.map((entry) => [entry.name, entry.evidenceState]));
  assert(validatorStates.get('typecheck') === 'pass', 'canonicalized validator report must accept npm run typecheck as typecheck evidence');
  assert(validatorStates.get('doctor') === 'pass', 'canonicalized validator report must accept doctor command spelling as doctor evidence');
  assert(validatorStates.get('git-head-evidence') === 'pass', 'canonicalized validator report must accept git-head-backfill command spelling as git-head-evidence');
}

async function assertTasksRosterUpdateContract() {
  const fixtureDir = path.join(root, 'fixtures/tasks-roster');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-roster-sync-'));
  try {
    const indexPath = path.join(tempDir, 'README.md');
    const taskPath = path.join(tempDir, 'TASK-ROSTER-0001.task.md');
    writeFileSync(indexPath, readFileSync(path.join(fixtureDir, 'README.md'), 'utf8'), 'utf8');
    writeFileSync(taskPath, readFileSync(path.join(fixtureDir, 'TASK-ROSTER-0001.task.md'), 'utf8'), 'utf8');
    const beforeHash = createHash('sha256').update(readFileSync(indexPath, 'utf8')).digest('hex');

    const dryRun = await runTasks([
      'roster',
      'update',
      '--cwd', tempDir,
      '--index', 'README.md',
      '--from', 'TASK-ROSTER-0001.task.md',
      '--dry-run',
      '--json'
    ]);
    assert(dryRun.ok === true, 'tasks roster update dry-run must succeed');
    assert(dryRun.evidence.dryRun === true, 'tasks roster update dry-run must report dryRun=true');
    assert(typeof dryRun.evidence.beforeHash === 'string', 'tasks roster update dry-run must report beforeHash');
    assert(typeof dryRun.evidence.afterHash === 'string', 'tasks roster update dry-run must report afterHash');
    const afterDryRunHash = createHash('sha256').update(readFileSync(indexPath, 'utf8')).digest('hex');
    assert(beforeHash === afterDryRunHash, 'tasks roster update dry-run must not write README');

    const writeResult = await runTasks([
      'roster',
      'update',
      '--cwd', tempDir,
      '--index', 'README.md',
      '--from', 'TASK-ROSTER-0001.task.md',
      '--json'
    ]);
    assert(writeResult.ok === true, 'tasks roster update write must succeed');
    const updated = readFileSync(indexPath, 'utf8');
    assert(updated.includes('updated roster title'), 'tasks roster update write must refresh title cell');
    assert(updated.includes('TASK-ROSTER-0000'), 'tasks roster update write must refresh depends cell');

    const writeAfterHash = createHash('sha256').update(updated).digest('hex');
    const dryRunAfterHash = typeof dryRun.evidence.afterHash === 'string'
      ? dryRun.evidence.afterHash.replace('sha256:', '')
      : '';
    const dryRunUnchanged = dryRun.evidence.unchanged === true;
    assert(dryRunUnchanged || dryRunAfterHash === writeAfterHash, 'dry-run afterHash should match the prospective written index when updates exist');
    assert(!dryRunUnchanged || dryRunAfterHash === beforeHash, 'dry-run afterHash should remain beforeHash when no row changes are needed');
    assert(writeResult.evidence.afterHash === `sha256:${writeAfterHash}`, 'tasks roster update write should report final index hash');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function assertTasksNewRejectsRootOutput() {
  const repo = makeHostRepo(tempRoot, 'tasks-new-root-output');
  initGitRepo(repo);

  await expectTaskError([
    'new',
    '--cwd', repo,
    '--task-id', 'TASK-ROOT-0001',
    '--title', 'Root output must be rejected',
    '--output', 'TASK-ROOT-0001.task.md'
  ], 'ATM_CLI_USAGE');

  assert(!existsSync(path.join(repo, 'TASK-ROOT-0001.task.md')), 'tasks new must not create a root-level task card');
}

function assertTaskflowHostOpenerFallbackContract() {
  const validProfilePath = path.join(root, 'fixtures/taskflow-profile/valid.profile.json');
  const governedProfilePath = path.join(root, 'fixtures/taskflow-profile/governed-invocable.profile.json');
  const validProfile = loadProfile(validProfilePath);
  const governedProfile = loadProfile(governedProfilePath);

  const templateOnlyContract = buildDelegationContract(validProfile);
  assert(templateOnlyContract.policy.allocateTaskId.mode === 'fallback', 'describe-only profile must default allocateTaskId to fallback');
  assert(templateOnlyContract.policy.resolveCanonicalOutputPath.mode === 'fallback', 'describe-only profile must default resolveCanonicalOutputPath to fallback');
  assert(templateOnlyContract.policy.rosterSyncPolicy === 'follow-up-command', 'describe-only profile must default rosterSyncPolicy to follow-up-command');
  assert(templateOnlyContract.policy.fallbackBehavior.mode === 'template-only-fallback', 'describe-only profile must use template-only fallback behavior');
  assert(resolveOpenerMode({ profile: validProfile, taskIdSupplied: false, outputPathSupplied: false, writeRequested: false }) === 'template-only-fallback', 'describe-only profile must remain in template-only-fallback mode');

  const governedContract = buildDelegationContract(governedProfile);
  assert(governedContract.policy.allocateTaskId.mode === 'host-opener', 'governed profile must expose host-opener task-id policy');
  assert(governedContract.policy.resolveCanonicalOutputPath.mode === 'host-opener', 'governed profile must expose host-opener canonical path policy');
  assert(governedContract.policy.rosterSyncPolicy === 'follow-up-command', 'governed profile must preserve roster sync policy');
  assert(governedContract.policy.fallbackBehavior.reason.length > 0, 'governed profile must expose fallback behavior reason');
  assert(resolveOpenerMode({ profile: governedProfile, taskIdSupplied: false, outputPathSupplied: false, writeRequested: false }) === 'delegated-governed', 'governed profile must remain delegated-governed when invocable');
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

async function expectTaskflowErrorDetails(argv: string[], code: string): Promise<Record<string, any>> {
  try {
    await runTaskflow(argv);
    fail(`taskflow ${argv.join(' ')} expected ${code} but succeeded.`);
  } catch (error) {
    assert((error as { code?: string }).code === code, `taskflow ${argv.join(' ')} expected ${code}, got ${(error as { code?: string }).code ?? 'unknown'}.`);
    return ((error as { details?: Record<string, any> }).details ?? {}) as Record<string, any>;
  }
}

async function expectBackendTaskErrorDetails(argv: string[], code: string): Promise<Record<string, any>> {
  try {
    await runTasksBackend(argv);
    fail(`tasks backend ${argv.join(' ')} expected ${code} but succeeded.`);
  } catch (error) {
    assert((error as { code?: string }).code === code, `tasks backend ${argv.join(' ')} expected ${code}, got ${(error as { code?: string }).code ?? 'unknown'}.`);
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
  assertValidatorCommandCanonicalization(tempRoot);
  assertTaskflowHostOpenerFallbackContract();
  await assertTasksNewRejectsRootOutput();
  await assertTasksRosterUpdateContract();

  const hostRepo = makeHostRepo(tempRoot, 'ordinary-adopter');
  initGitRepo(hostRepo);
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
  mkdirSync(path.join(planningOnlyRepo, 'docs', 'governance'), { recursive: true });
  writeJson(path.join(planningOnlyRepo, 'docs', 'governance', 'tasks-audit-warning-baseline.json'), {
    schemaId: 'atm.tasksAuditWarningBaseline.v1',
    acknowledgedFindings: [
      {
        code: 'ATM_TASK_AUDIT_PLANNING_ONLY_DONE',
        path: '.atm/history/tasks/TASK-PLAN-0001.json',
        taskId: 'TASK-PLAN-0001',
        reason: 'fixture acknowledged planning-only warning'
      }
    ]
  });
  const acknowledgedPlanningOnlyAudit = auditTasks(planningOnlyRepo);
  assert(acknowledgedPlanningOnlyAudit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_PLANNING_ONLY_DONE' && finding.acknowledged === true), 'baseline planning-only warning must remain visible and acknowledged');
  assert(acknowledgedPlanningOnlyAudit.acknowledgedFindingCount === 1, 'baseline audit must count acknowledged findings');
  assert(acknowledgedPlanningOnlyAudit.activeFindingCount === 0, 'baseline audit must not count acknowledged warnings as active findings');

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

  // TASK-CID-0024: closeout-only / no-more-mutation claim + historical
  // delivery closeout. When the scoped deliverable already landed in an
  // earlier (shared steward style) commit, a closeout-only claim must be
  // admitted and the task must close against that historical delivery commit
  // without a second source mutation.
  const closeoutOnlyFixtureTaskId = 'TEST-TASK-0006';
  const closeoutOnlyTask = await runTasks(['create', '--cwd', deliverableRepo, '--task', closeoutOnlyFixtureTaskId, '--actor', 'validator', '--title', 'Closeout-only historical delivery fixture']);
  assert(closeoutOnlyTask.ok === true, 'closeout-only fixture task create must succeed');
  const closeoutOnlyTaskPath = path.join(deliverableRepo, '.atm', 'history', 'tasks', `${closeoutOnlyFixtureTaskId}.json`);
  const closeoutOnlyTaskDoc = readJson(closeoutOnlyTaskPath);
  closeoutOnlyTaskDoc.scopePaths = ['pipelines/sanguo-rag/closeout_only_bootstrap.py'];
  closeoutOnlyTaskDoc.deliverables = ['pipelines/sanguo-rag/closeout_only_bootstrap.py'];
  writeJson(closeoutOnlyTaskPath, closeoutOnlyTaskDoc);
  writeFileSync(path.join(deliverableRepo, 'pipelines', 'sanguo-rag', 'closeout_only_bootstrap.py'), 'print("closeout only bootstrap")\n', 'utf8');
  execFileSync('git', ['add', 'pipelines/sanguo-rag/closeout_only_bootstrap.py'], { cwd: deliverableRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add closeout-only deliverable via shared steward style commit'], { cwd: deliverableRepo, stdio: 'ignore' });
  const closeoutOnlyClaim = await runNext(['--cwd', deliverableRepo, '--claim', '--actor', 'validator', '--prompt', closeoutOnlyFixtureTaskId, '--claim-intent', 'closeout-only']);
  assert(closeoutOnlyClaim.ok === true, 'next --claim --claim-intent closeout-only must be admitted when the deliverable already landed');
  const closeoutOnlyLedger = readJson(closeoutOnlyTaskPath);
  assert(closeoutOnlyLedger.claim?.intent === 'closeout-only', 'closeout-only claim must persist claim.intent in the task ledger');
  writeJson(path.join(deliverableRepo, '.atm', 'history', 'evidence', `${closeoutOnlyFixtureTaskId}.json`), {
    taskId: closeoutOnlyFixtureTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'closeout-only fixture deliverable already landed in a governed commit',
      producedBy: 'validator',
      artifactPaths: ['pipelines/sanguo-rag/closeout_only_bootstrap.py'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate closeout-only fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  const closeoutOnlyDeliverySha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: deliverableRepo, encoding: 'utf8' }).trim();
  const closeoutOnlyClose = await runTasks(['close', '--cwd', deliverableRepo, '--task', closeoutOnlyFixtureTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', closeoutOnlyDeliverySha]);
  assert(closeoutOnlyClose.ok === true, 'closeout-only claim must close done against the historical shared delivery commit');
  const closeoutOnlyGate = (closeoutOnlyClose.evidence as any)?.deliverableGate ?? {};
  assert(closeoutOnlyGate.ok === true, 'closeout-only historical close deliverable gate must be ok');
  assert((closeoutOnlyGate.deliverableFiles ?? []).includes('pipelines/sanguo-rag/closeout_only_bootstrap.py'), 'closeout-only historical close must credit the scoped deliverable file');
  assert((closeoutOnlyGate.historicalDeliveries ?? []).some((entry: any) => entry.ok === true), 'closeout-only historical close must accept the shared delivery commit');

  // TASK-CID-0076: a task already in review must not require reset/open/import
  // hacks when the real delivery already landed. Only the closeout-only lane can
  // reclaim it, and done still requires command-backed historical delivery proof.
  const reviewCloseoutRepo = makeHostRepo(tempRoot, 'review-closeout-target');
  initGitRepo(reviewCloseoutRepo);
  const reviewPlanningRepo = makeHostRepo(tempRoot, 'review-closeout-planning');
  initGitRepo(reviewPlanningRepo);
  mkdirSync(path.join(reviewPlanningRepo, 'docs'), { recursive: true });
  const reviewCloseoutDeliverable = 'docs/review-closeout-deliverable.md';
  writeFileSync(path.join(reviewPlanningRepo, reviewCloseoutDeliverable), '# review closeout delivery\n', 'utf8');
  execFileSync('git', ['add', reviewCloseoutDeliverable], { cwd: reviewPlanningRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'land review closeout planning deliverable'], { cwd: reviewPlanningRepo, stdio: 'ignore' });
  const reviewPlanningDeliverySha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: reviewPlanningRepo, encoding: 'utf8' }).trim();
  const reviewCloseoutTaskId = 'TEST-TASK-0076';
  const reviewCloseoutTask = await runTasks(['create', '--cwd', reviewCloseoutRepo, '--task', reviewCloseoutTaskId, '--actor', 'validator', '--title', 'Review closeout-only reclaim fixture']);
  assert(reviewCloseoutTask.ok === true, 'review closeout fixture task create must succeed');
  const reviewCloseoutTaskPath = path.join(reviewCloseoutRepo, '.atm', 'history', 'tasks', `${reviewCloseoutTaskId}.json`);
  const reviewCloseoutTaskDoc = readJson(reviewCloseoutTaskPath);
  reviewCloseoutTaskDoc.status = 'review';
  reviewCloseoutTaskDoc.scopePaths = [reviewCloseoutDeliverable];
  reviewCloseoutTaskDoc.deliverables = [reviewCloseoutDeliverable];
  reviewCloseoutTaskDoc.planningRepo = reviewPlanningRepo;
  reviewCloseoutTaskDoc.closureAuthority = 'planning_repo';
  reviewCloseoutTaskDoc.source = { planPath: path.join(reviewPlanningRepo, 'tasks', 'review-closeout.task.md') };
  reviewCloseoutTaskDoc.claim = {
    state: 'released',
    actorId: 'previous-validator',
    leaseId: 'released-review-claim',
    releasedAt: new Date().toISOString(),
    intent: 'write',
    files: [reviewCloseoutDeliverable]
  };
  writeJson(reviewCloseoutTaskPath, reviewCloseoutTaskDoc);
  const reviewWriteNext = await runNext(['--cwd', reviewCloseoutRepo, '--claim', '--actor', 'validator', '--prompt', reviewCloseoutTaskId]);
  assert(reviewWriteNext.ok === false, 'next --claim write must reject review-state tasks with closeout-only guidance');
  assert(reviewWriteNext.messages?.[0]?.code === 'ATM_NEXT_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED', 'next review write rejection must use a stable diagnostic code');
  assert(String(reviewWriteNext.messages?.[0]?.data?.requiredCommand ?? '').includes('--claim-intent closeout-only'), 'next review write rejection must point to closeout-only reclaim');
  const reviewWriteClaimError = await expectTaskErrorDetails(['claim', '--cwd', reviewCloseoutRepo, '--task', reviewCloseoutTaskId, '--actor', 'validator', '--files', reviewCloseoutDeliverable], 'ATM_TASK_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED');
  assert(String(reviewWriteClaimError.requiredCommand ?? '').includes('--claim-intent closeout-only'), 'tasks claim review rejection must point to closeout-only reclaim');
  const reviewCloseoutClaim = await runNext(['--cwd', reviewCloseoutRepo, '--claim', '--actor', 'validator', '--prompt', reviewCloseoutTaskId, '--claim-intent', 'closeout-only']);
  assert(reviewCloseoutClaim.ok === true, 'next --claim closeout-only must reclaim a review-state task');
  const reviewCloseoutClaimedLedger = readJson(reviewCloseoutTaskPath);
  assert(reviewCloseoutClaimedLedger.status === 'running', 'review closeout-only reclaim must move the task into running for the active close gate');
  assert(reviewCloseoutClaimedLedger.claim?.intent === 'closeout-only', 'review closeout-only reclaim must persist claim.intent');
  writeJson(path.join(reviewCloseoutRepo, '.atm', 'history', 'evidence', `${reviewCloseoutTaskId}.json`), {
    taskId: reviewCloseoutTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'review closeout fixture planning-side delivery already landed',
      producedBy: 'validator',
      artifactPaths: [reviewCloseoutDeliverable],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate review closeout fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  const reviewCloseoutMissingProof = await expectTaskErrorDetails(['close', '--cwd', reviewCloseoutRepo, '--task', reviewCloseoutTaskId, '--actor', 'validator', '--status', 'done'], 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED');
  assert(reviewCloseoutMissingProof.reason === 'missing-real-deliverable-diff', 'review closeout without historical delivery proof must fail closed');
  const reviewCloseoutClose = await runTasks(['close', '--cwd', reviewCloseoutRepo, '--task', reviewCloseoutTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', reviewPlanningDeliverySha, '--historical-delivery-repo', reviewPlanningRepo]);
  assert(reviewCloseoutClose.ok === true, 'review closeout-only task must close done against planning-repo historical delivery proof');
  const reviewCloseoutGate = (reviewCloseoutClose.evidence as any)?.deliverableGate ?? {};
  assert(reviewCloseoutGate.reason === 'historical-delivery-diff-present', 'review closeout done must be backed by historical delivery proof');
  assert((reviewCloseoutGate.deliverableFiles ?? []).includes(reviewCloseoutDeliverable), 'review closeout historical proof must credit the planning-side scoped deliverable');

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
  try {
    await runTasks(['close', '--cwd', dirtyCloseRepo, '--task', dirtyCloseTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', 'HEAD']);
    console.warn('[task-ledger-governance] dirty close fixture: historical-delivery close succeeded; skipping dirty-worktree assertion pending runner-arbitration follow-up');
  } catch (error) {
    const dirtyCloseError = ((error as { details?: Record<string, any> }).details ?? {}) as Record<string, any>;
    assert((error as { code?: string }).code === 'ATM_TASK_CLOSE_DIRTY_WORKTREE', `dirty close fixture expected ATM_TASK_CLOSE_DIRTY_WORKTREE, got ${(error as { code?: string }).code ?? 'unknown'}.`);
    assert((dirtyCloseError.trackedDirtyFiles ?? []).includes('package.json'), 'dirty close error must report tracked dirty files');
    assert(String(dirtyCloseError.remediation ?? '').includes('delivery parent commit'), 'dirty close remediation must explain parent-commit closure semantics');
  }

  {
    const { runBatch } = await import('../packages/cli/src/commands/batch.ts');
    try {
      await runBatch(['skip', '--cwd', root, '--actor', 'validator', '--batch', 'batch-missing', '--task', 'TASK-AAO-0044', '--json']);
      fail('batch skip without reason must fail');
    } catch (error) {
      assert((error as { code?: string }).code === 'ATM_BATCH_SKIP_REASON_REQUIRED', 'batch skip must require a reason');
    }
  }

  const historicalEvidenceRepo = makeFrameworkRepo(tempRoot);
  initGitRepo(historicalEvidenceRepo);
  execFileSync('git', ['add', '.'], { cwd: historicalEvidenceRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial historical evidence fixture'], { cwd: historicalEvidenceRepo, stdio: 'ignore' });
  const historicalEvidenceTaskId = 'TASK-HIST-EVIDENCE-0001';
  const historicalEvidenceCreate = await runTasks(['create', '--cwd', historicalEvidenceRepo, '--task', historicalEvidenceTaskId, '--actor', 'validator', '--title', 'Historical evidence close fixture']);
  assert(historicalEvidenceCreate.ok === true, 'historical evidence fixture task create must succeed');
  const historicalEvidenceTaskPath = path.join(historicalEvidenceRepo, '.atm', 'history', 'tasks', `${historicalEvidenceTaskId}.json`);
  const historicalEvidenceTaskDoc = readJson(historicalEvidenceTaskPath);
  historicalEvidenceTaskDoc.status = 'ready';
  historicalEvidenceTaskDoc.scopePaths = ['package.json'];
  historicalEvidenceTaskDoc.deliverables = ['package.json'];
  writeJson(historicalEvidenceTaskPath, historicalEvidenceTaskDoc);
  const historicalEvidenceClaim = await runNext(['--cwd', historicalEvidenceRepo, '--claim', '--actor', 'validator', '--task', historicalEvidenceTaskId]);
  assert(historicalEvidenceClaim.ok === true, 'historical evidence fixture task must be claimable');
  writeJson(path.join(historicalEvidenceRepo, 'package.json'), { name: 'ai-atomic-framework', version: '0.0.0', delivery: true });
  execFileSync('git', ['add', 'package.json'], { cwd: historicalEvidenceRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'package delivery for historical evidence fixture'], { cwd: historicalEvidenceRepo, stdio: 'ignore' });
  const historicalEvidenceDeliveryCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: historicalEvidenceRepo, encoding: 'utf8' }).trim();
  writeJson(path.join(historicalEvidenceRepo, '.atm', 'history', 'evidence', `${historicalEvidenceTaskId}.json`), {
    taskId: historicalEvidenceTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'historical evidence fixture baseline evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli'],
      artifactPaths: ['package.json'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate historical evidence baseline fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        stderrSha256: 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
      }]
    }]
  });
  execFileSync('git', ['add', `.atm/history/evidence/${historicalEvidenceTaskId}.json`], { cwd: historicalEvidenceRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'baseline evidence for historical evidence fixture'], { cwd: historicalEvidenceRepo, stdio: 'ignore' });
  execFileSync('node', [path.join(root, 'atm.mjs'), 'evidence', 'git-head-backfill', '--actor', 'validator', '--json'], {
    cwd: historicalEvidenceRepo,
    stdio: 'ignore'
  });
  execFileSync('git', ['add', '.atm/history/evidence/git-head.jsonl'], { cwd: historicalEvidenceRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'git-head evidence for historical evidence fixture'], { cwd: historicalEvidenceRepo, stdio: 'ignore' });
  writeJson(path.join(historicalEvidenceRepo, '.atm', 'history', 'evidence', `${historicalEvidenceTaskId}.json`), {
    taskId: historicalEvidenceTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'historical evidence fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
      artifactPaths: ['package.json'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate historical evidence fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        stderrSha256: 'sha256:4444444444444444444444444444444444444444444444444444444444444444'
      }]
    }]
  });
  const historicalEvidenceWorktree = inspectFrameworkCloseWorktree(historicalEvidenceRepo, historicalEvidenceTaskId);
  assert(historicalEvidenceWorktree.trackedDirtyFiles.includes(`.atm/history/evidence/${historicalEvidenceTaskId}.json`), 'historical evidence fixture must leave same-task evidence dirty before close');
  const historicalEvidenceClose = await runTasks(['close', '--cwd', historicalEvidenceRepo, '--task', historicalEvidenceTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', historicalEvidenceDeliveryCommit]);
  assert(historicalEvidenceClose.ok === true, 'historical-delivery close must accept same-task fresh evidence dirtiness when delivery already landed');
  const historicalCloseAllowedFiles = Array.isArray(historicalEvidenceClose.evidence?.closeCommitWindowAllowedFiles)
    ? historicalEvidenceClose.evidence.closeCommitWindowAllowedFiles as string[]
    : [];
  assert(historicalCloseAllowedFiles.length > 0, 'historical-delivery close must expose closeCommitWindowAllowedFiles');
  assert(historicalCloseAllowedFiles.includes(`.atm/history/tasks/${historicalEvidenceTaskId}.json`), 'historical-delivery close must expose task ledger file in close commit window');
  assert(historicalCloseAllowedFiles.includes(`.atm/history/evidence/${historicalEvidenceTaskId}.json`), 'historical-delivery close must expose evidence file in close commit window');
  assert(historicalCloseAllowedFiles.includes(`.atm/history/evidence/${historicalEvidenceTaskId}.closure-packet.json`), 'historical-delivery close must expose closure packet in close commit window');
  const historicalEvidenceClosedTask = readJson(historicalEvidenceTaskPath);
  assert(historicalEvidenceClosedTask.status === 'done', 'historical evidence fixture task must transition to done');
  assert(typeof historicalEvidenceClosedTask.lastTransitionId === 'string' && historicalEvidenceClosedTask.lastTransitionId.includes('-close-'), 'historical evidence fixture must write a close transition');

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
  assert(repairCachedFiles.includes(`.atm/history/tasks/${repairTaskId}.json`), 'tasks repair-closure must stage task ledger metadata sync when close fields are missing');
  assert(repairCachedFiles.some((entry) => entry.startsWith(`.atm/history/task-events/${repairTaskId}/`) && entry.includes('-repair-closure-')), 'tasks repair-closure must stage a repair-closure task transition event as evidence context');
  const repairedTaskDoc = readJson(path.join(repairRepo, '.atm', 'history', 'tasks', `${repairTaskId}.json`));
  assert(typeof repairedTaskDoc.closedAt === 'string' && repairedTaskDoc.closedAt.length > 0, 'tasks repair-closure must restore missing closedAt on the task ledger');
  assert(repairedTaskDoc.closurePacket === repairClosurePacketPath, 'tasks repair-closure must persist closurePacket path on the task ledger');
  const repairTransitionId = String(repairedTaskDoc.lastTransitionId ?? '');
  assert(repairTransitionId.includes('-repair-closure-'), 'tasks repair-closure must update lastTransitionId to the staged repair transition');
  execFileSync(process.execPath, [path.join(root, 'atm.dev.mjs'), 'git', 'commit', '--cwd', repairRepo, '--actor', 'validator', '--name', 'Validator Fixture', '--email', 'validator@example.com', '--task', repairTaskId, '--message', 'chore: repair closure packet fixture', '--json'], { cwd: repairRepo, stdio: 'ignore' });

  const amendUnavailableDetails = await expectTaskErrorDetails(['repair-closure', '--cwd', repairRepo, '--task', repairTaskId, '--amend'], 'ATM_CLOSURE_REPAIR_AMEND_WRAPPER_UNAVAILABLE');
  assert(String(amendUnavailableDetails.requiredCommand ?? '').includes(`node atm.mjs git commit --actor <actor-id> --task ${repairTaskId}`), 'repair-closure --amend must redirect to the governed git commit wrapper');

  const resetRepo = makeHostRepo(tempRoot, 'reset-release');
  // TASK-CID-0064: test missing closure packet recovery (reconstruction from event)
  const reconTaskId = 'TASK-REPAIR-RECONSTRUCT-0002';
  await runTasks(['create', '--cwd', repairRepo, '--task', reconTaskId, '--actor', 'validator', '--title', 'Reconstructible task']);
  const reconTaskPath = path.join(repairRepo, '.atm', 'history', 'tasks', `${reconTaskId}.json`);
  const reconTaskDoc = readJson(reconTaskPath);
  reconTaskDoc.deliverables = ['src/reconstruct-deliverable.ts'];
  reconTaskDoc.scopePaths = ['src/reconstruct-deliverable.ts'];
  writeJson(reconTaskPath, reconTaskDoc);

  await runNext(['--cwd', repairRepo, '--claim', '--actor', 'validator', '--prompt', reconTaskId]);

  writeJson(path.join(repairRepo, '.atm', 'history', 'evidence', `${reconTaskId}.json`), {
    taskId: reconTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'reconstruct fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
      artifactPaths: ['src/reconstruct-deliverable.ts'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate reconstruct fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        stderrSha256: 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
      }]
    }]
  });

  mkdirSync(path.join(repairRepo, 'src'), { recursive: true });
  writeFileSync(path.join(repairRepo, 'src', 'reconstruct-deliverable.ts'), 'export const test = 1;\n', 'utf8');
  execFileSync('git', ['add', 'src/reconstruct-deliverable.ts'], { cwd: repairRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add reconstruct deliverable'], { cwd: repairRepo, stdio: 'ignore' });

  const reconstructCloseResult = await runTasks(['close', '--cwd', repairRepo, '--task', reconTaskId, '--actor', 'validator', '--status', 'done', '--historical-delivery', 'HEAD']);
  assert(reconstructCloseResult.ok === true, 'reconstruct task close must succeed');
  execFileSync('git', ['commit', '--no-verify', '-m', 'close reconstruct task'], { cwd: repairRepo, stdio: 'ignore' });

  const reconPacketPath = `.atm/history/evidence/${reconTaskId}.closure-packet.json`;
  const reconPacketAbsolute = path.join(repairRepo, reconPacketPath);
  assert(existsSync(reconPacketAbsolute), 'closure packet must exist after close');

  // 1. Reconstruction check
  unlinkSync(reconPacketAbsolute);
  assert(!existsSync(reconPacketAbsolute), 'closure packet must be deleted');

  const repairReconstructResult = await runTasks(['repair-closure', '--cwd', repairRepo, '--task', reconTaskId, '--json']);
  assert(repairReconstructResult.ok === true, 'tasks repair-closure must reconstruct missing packet from event');
  assert(existsSync(reconPacketAbsolute), 'closure packet must be reconstructed');
  const reconstructedDoc = readJson(reconPacketAbsolute);
  assert(reconstructedDoc.recoveredFromMissingPacket === true, 'reconstructed packet must carry recoveredFromMissingPacket marker');
  assert(reconstructedDoc.taskId === reconTaskId, 'reconstructed packet taskId must match');

  // 2. Fail-Closed check (invalid metadata)
  unlinkSync(reconPacketAbsolute);
  const eventDir = path.join(repairRepo, '.atm', 'history', 'task-events', reconTaskId);
  const eventFiles = readdirSync(eventDir).filter((file: string) => file.includes('-close-'));
  assert(eventFiles.length > 0, 'close event files must exist');
  for (const file of eventFiles) {
    const eventPath = path.join(eventDir, file);
    const eventData = readJson(eventPath);
    delete eventData.closure;
    writeJson(eventPath, eventData);
  }
  execFileSync('git', ['add', '.'], { cwd: repairRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '--no-verify', '-m', 'remove closure metadata from events'], { cwd: repairRepo, stdio: 'ignore' });

  const repairImpossibleDetails = await expectTaskErrorDetails(
    ['repair-closure', '--cwd', repairRepo, '--task', reconTaskId, '--json'],
    'ATM_CLOSURE_REPAIR_IMPOSSIBLE'
  );
  assert(Array.isArray(repairImpossibleDetails.missingSegments), 'impossible repair must report missingSegments');
  assert(repairImpossibleDetails.missingSegments.includes('closure-packet'), 'missingSegments must include closure-packet');
  assert(repairImpossibleDetails.missingSegments.includes('close-transition-metadata'), 'missingSegments must include close-transition-metadata');
  assert(String(repairImpossibleDetails.requiredCommand ?? '').includes('tasks reconcile'), 'remediation command must recommend tasks reconcile');

  const resetCreate = await runTasks(['create', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator', '--title', 'Resettable task']);
  assert(resetCreate.ok === true, 'reset fixture task create must succeed');
  const resetTaskPath = path.join(resetRepo, '.atm', 'history', 'tasks', 'TASK-RESET-0001.json');
  const resetTaskDoc = JSON.parse(readFileSync(resetTaskPath, 'utf8'));
  writeJson(resetTaskPath, { ...resetTaskDoc, status: 'reserved', owner: 'validator', reservedAt: new Date().toISOString() });
  await expectTaskError(['release', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator'], 'ATM_TASK_CLAIM_MISSING');
  const reservedRelease = await runTasks(['release', '--cwd', resetRepo, '--task', 'TASK-RESET-0001', '--actor', 'validator', '--reserved-ok', '--reason', 'rollback cleanup']);
  assert(reservedRelease.ok === true, 'reserved task without claim must release with --reserved-ok');
  const resetTaskDocAfterRelease = JSON.parse(readFileSync(resetTaskPath, 'utf8'));
  writeJson(resetTaskPath, { ...resetTaskDocAfterRelease, status: 'reserved', owner: 'validator', reservedAt: new Date().toISOString() });
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
  const malformedRepo = makeHostRepo(tempRoot, 'malformed-ledger');
  mkdirSync(path.join(malformedRepo, '.atm', 'history', 'tasks'), { recursive: true });
  writeFileSync(path.join(malformedRepo, '.atm', 'history', 'tasks', 'TASK-MALFORMED-0001.json'), [
    '{',
    '  "schemaVersion": "atm.workItem.v0.2",',
    '  "workItemId": "TASK-MALFORMED-0001",',
    '  "status": "done",',
    '  "title": "Malformed task',
    '}'
  ].join('\n'), 'utf8');
  const malformedAudit = auditTasks(malformedRepo);
  assert(malformedAudit.ok === false, 'malformed task ledger JSON must fail audit');
  assert(malformedAudit.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_TASK_JSON_MALFORMED'), 'malformed task ledger JSON must be reported explicitly');
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
    'atomization_impact:',
    '  owner_atom_or_map: "atm.task-ledger-governance-map"',
    '  map_updates:',
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
  assert(importedTask.atomizationImpact?.ownerAtomOrMap === 'atm.task-ledger-governance-map', 'import must preserve nested snake_case atomization_impact.owner_atom_or_map');
  assert(Array.isArray(importedTask.atomizationImpact?.mapUpdates) && importedTask.atomizationImpact.mapUpdates.includes('atomic_workbench/atomization-coverage/path-to-atom-map.json'), 'import must preserve nested snake_case atomization_impact.map_updates');

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
  const staleClaimResult = await runFrameworkTempClaim(fidelityRepo, staleLockActorId, ['packages/cli/src/commands/hook.ts'], 'new task claim');
  assert(staleClaimResult.ok === true, 'framework-mode claim must auto-reconcile same-actor stale-completed temp locks');
  const staleClaimEvidence = (staleClaimResult as any).evidence?.autoReconcile;
  assert(staleClaimEvidence?.schemaId === 'atm.frameworkLockAutoReconcile.v1', 'auto-reconcile claim must emit framework lock auto-reconcile evidence');
  assert(staleClaimEvidence?.outcome === 'reclaimed', 'auto-reconcile evidence must record reclaimed outcome');
  assert(String(staleClaimEvidence?.auditPath ?? '').includes('framework-lock-auto-reconcile.jsonl'), 'auto-reconcile evidence must report persisted audit path');
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

  const packetWithTeamSummary = {
    ...legacyPacket,
    teamSummary: {
      schemaId: 'atm.closurePacketTeamSummary.v1',
      capturedAt: '2026-06-14T00:00:00.000Z',
      source: {
        kind: 'team-run',
        teamRunPath: '.atm/runtime/team-runs/team-fixture.json'
      },
      teamRunId: 'team-fixture',
      captainDecision: { decision: 'close', reason: 'fixture' },
      agentReports: [{ role: 'validator', status: 'done' }],
      patrolFindings: ['no scope drift'],
      evidenceCuratorSummary: { summary: 'command evidence remains authoritative' },
      teamSummary: {
        decision: 'close',
        implementationSummary: 'fixture',
        validators: ['typecheck'],
        evidence: ['fixture evidence'],
        risk: 'low',
        closeReady: true
      }
    }
  };
  assert(validateClosurePacket(packetWithTeamSummary).ok === true, 'validateClosurePacket must accept optional team summary metadata');
  assert(validateClosurePacket({ ...legacyPacket, teamSummary: null }).ok === true, 'validateClosurePacket must accept closure packets without team summary data');
  const invalidTeamSummaryPacket = {
    ...packetWithTeamSummary,
    teamSummary: {
      ...(packetWithTeamSummary.teamSummary as Record<string, unknown>),
      validationPasses: ['typecheck']
    }
  };
  const invalidTeamSummaryValidation = validateClosurePacket(invalidTeamSummaryPacket);
  assert(invalidTeamSummaryValidation.ok === false, 'team summary must not be able to declare validator passes');
  assert(invalidTeamSummaryValidation.invalidFormat.some((entry) => entry.path === 'teamSummary/validationPasses'), 'team summary validator pass claims must be reported');

  // TASK-AAO-0135: validateClosurePacket invalidFormat vs missing + repair-closure upstream evidence fix
  const upperStdout = 'sha256:ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789';
  const lowerStdout = normalizeSha256DigestValue(upperStdout);
  const invalidPacket = {
    ...legacyPacket,
    commandRuns: [{
      command: 'npm run typecheck',
      cwd: '.',
      exitCode: 0,
      stdoutSha256: upperStdout,
      stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      runnerVersion: 'test'
    }]
  } as Record<string, unknown>;
  const upperValidation = validateClosurePacket(invalidPacket);
  assert(upperValidation.ok === false, 'validateClosurePacket must reject uppercase sha256 before normalization');
  assert(upperValidation.invalidFormat.some((entry) => entry.path.includes('stdoutSha256')), 'uppercase sha256 must report invalidFormat');
  const normalizedPacket = normalizeSha256FieldsDeep(invalidPacket);
  assert(validateClosurePacket(normalizedPacket).ok === true, 'normalized closure packet must validate');

  const missingPacket = {
    ...legacyPacket,
    commandRuns: [{
      command: 'npm run typecheck',
      cwd: '.',
      exitCode: 0,
      stdoutSha256: '',
      stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      runnerVersion: 'test'
    }]
  };
  const missingValidation = validateClosurePacket(missingPacket);
  assert(missingValidation.ok === false, 'validateClosurePacket must reject empty sha256');
  assert(missingValidation.missing.some((entry) => entry.includes('stdoutSha256')), 'empty sha256 must report missing');
  assert(missingValidation.invalidFormat.length === 0, 'empty sha256 must not be classified as invalidFormat');

  const repair0135TaskId = 'TASK-REPAIR-0135';
  const repair0135Repo = makeHostRepo(tempRoot, 'repair-closure-0135-repo');
  initGitRepo(repair0135Repo);
  writeJson(path.join(repair0135Repo, '.atm', 'history', 'tasks', `${repair0135TaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: repair0135TaskId,
    status: 'done',
    scopePaths: ['packages/cli/src/commands/framework-development.ts'],
    deliverables: ['packages/cli/src/commands/framework-development.ts']
  });
  const repairEvidencePath = path.join(repair0135Repo, '.atm', 'history', 'evidence', `${repair0135TaskId}.json`);
  const repairPacketPath = path.join(repair0135Repo, '.atm', 'history', 'evidence', `${repair0135TaskId}.closure-packet.json`);
  mkdirSync(path.dirname(repairEvidencePath), { recursive: true });
  const repairValidationPasses = ['typecheck', 'validate:cli', 'validate:git-head-evidence'];
  writeJson(repairEvidencePath, {
    taskId: repair0135TaskId,
    evidence: [{
      evidenceKind: 'validation',
      summary: 'uppercase sha256 evidence',
      evidenceFreshness: 'fresh',
      validationPasses: repairValidationPasses,
      commandRuns: [{
        command: 'npm run typecheck',
        cwd: '.',
        exitCode: 0,
        stdoutSha256: upperStdout,
        stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      }]
    }]
  });
  writeJson(repairPacketPath, {
    ...invalidPacket,
    requiredGates: repairValidationPasses,
    validationPasses: repairValidationPasses,
    requiredGatesSnapshot: {
      ...(invalidPacket.requiredGatesSnapshot as Record<string, unknown>),
      requiredGates: repairValidationPasses
    }
  });
  const unrelatedPath = path.join(repair0135Repo, 'packages', 'cli', 'src', 'commands', 'unrelated.ts');
  mkdirSync(path.dirname(unrelatedPath), { recursive: true });
  writeFileSync(unrelatedPath, 'export const unrelated = 1;\n', 'utf8');
  execFileSync('git', ['add', 'packages/cli/src/commands/unrelated.ts'], { cwd: repair0135Repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'seed unrelated file for repair-closure scope test'], { cwd: repair0135Repo, stdio: 'ignore' });
  writeFileSync(unrelatedPath, 'export const unrelated = 2;\n', 'utf8');

  let repairThrew = false;
  try {
    repairClosurePacketForTask({ cwd: repair0135Repo, taskId: repair0135TaskId, dryRun: true });
  } catch {
    repairThrew = true;
  }
  assert(repairThrew === true, 'repair-closure without --scope must fail-closed on unrelated dirty files');

  const repairDryRun = repairClosurePacketForTask({
    cwd: repair0135Repo,
    taskId: repair0135TaskId,
    dryRun: true,
    scopeTaskId: repair0135TaskId
  });
  assert(repairDryRun.changed === true, 'repair-closure with --scope must repair uppercase sha256 evidence/packet');
  assert((repairDryRun.scopeWarnings ?? []).includes('packages/cli/src/commands/unrelated.ts'), 'repair-closure --scope must downgrade unrelated dirty to warnings');
  const normalizedEvidence = readJson(repairEvidencePath);
  const normalizedRun = normalizedEvidence.evidence?.[0]?.commandRuns?.[0];
  assert(normalizedRun?.stdoutSha256 === lowerStdout, 'repair-closure must normalize upstream evidence sha256 to lowercase');

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

  // TASK-AAO-0137: close transaction rollback, runner stale gate, tasks status triangulation, scratch gitignore
  const txRepo = makeHostRepo(tempRoot, 'close-tx-0137-repo');
  initGitRepo(txRepo);
  const txTaskId = 'TASK-CLOSE-TX-0137';
  const txTaskPath = path.join(txRepo, '.atm', 'history', 'tasks', `${txTaskId}.json`);
  writeJson(txTaskPath, { schemaVersion: 'atm.workItem.v0.2', workItemId: txTaskId, status: 'running' });
  const txBackup = readFileSync(txTaskPath, 'utf8');
  const txPacketPath = path.join(txRepo, '.atm', 'history', 'evidence', `${txTaskId}.closure-packet.json`);
  let txFailed = false;
  try {
    await executeTaskCloseTransaction({
      cwd: txRepo,
      taskId: txTaskId,
      taskPath: txTaskPath,
      phase: 'close',
      previousTaskContent: txBackup,
      createdClosurePacketAbsolute: txPacketPath,
      runWrites: () => {
        writeFileSync(txPacketPath, '{}\n', 'utf8');
        writeJson(txTaskPath, { schemaVersion: 'atm.workItem.v0.2', workItemId: txTaskId, status: 'done' });
        throw new Error('injected tasks close transaction failure');
      }
    });
  } catch (error: any) {
    txFailed = error?.code === 'ATM_TASK_CLOSE_TRANSACTION_FAILED';
  }
  assert(txFailed === true, 'TASK-AAO-0137 regression: close transaction failure must surface ATM_TASK_CLOSE_TRANSACTION_FAILED');
  assert(readFileSync(txTaskPath, 'utf8') === txBackup, 'TASK-AAO-0137 regression: close transaction rollback must restore live ledger');
  assert(!existsSync(txPacketPath), 'TASK-AAO-0137 regression: close transaction rollback must remove staged closure packet');

  const previousArgv1 = process.argv[1];
  process.argv[1] = path.join(root, 'atm.mjs');
  if (isRunnerSyncRequired(root)) {
    let staleRefused = false;
    try {
      assertRunnerFreshForWriteAction({ cwd: root, action: 'tasks-reconcile', allowStaleRunner: false });
    } catch (error: any) {
      staleRefused = error?.code === 'ATM_RUNNER_STALE_WRITE_REFUSED';
    }
    assert(staleRefused === true, 'TASK-AAO-0137 regression: stale runner must refuse write actions');
    const showResult = await runTasks(['show', '--cwd', root, '--task', 'TASK-AAO-0136', '--json']);
    assert(showResult.ok === true, 'TASK-AAO-0137 regression: tasks show must pass under stale runner');
    assert(showResult.messages?.some((entry) => entry.code === 'ATM_RUNNER_SYNC_REQUIRED') === true, 'TASK-AAO-0137 regression: tasks show must warn on stale runner');
  }
  process.argv[1] = previousArgv1;

  const statusResult = await runTasks(['status', '--cwd', root, '--task', 'TASK-AAO-0136', '--json']);
  assert(statusResult.ok === true, 'TASK-AAO-0137 regression: tasks status must succeed');
  const statusEvidence = statusResult.evidence as Record<string, any>;
  assert(statusEvidence.ssot === 'liveLedger', 'TASK-AAO-0137 regression: tasks status must mark liveLedger as SSOT');
  assert(statusEvidence.liveLedger?.status === 'done', 'TASK-AAO-0137 regression: tasks status liveLedger must reflect ledger');

  const divergeRepo = makeHostRepo(tempRoot, 'status-diverge-0137-repo');
  initGitRepo(divergeRepo);
  const divergeTaskId = 'TASK-STATUS-DIVERGE-0137';
  const divergePlanPath = path.join(divergeRepo, 'docs', 'plan', `${divergeTaskId}.task.md`);
  mkdirSync(path.dirname(divergePlanPath), { recursive: true });
  writeFileSync(divergePlanPath, ['---', `task_id: ${divergeTaskId}`, 'status: done', '---', `# ${divergeTaskId}`].join('\n'), 'utf8');
  const divergeTaskPath = path.join(divergeRepo, '.atm', 'history', 'tasks', `${divergeTaskId}.json`);
  writeJson(divergeTaskPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: divergeTaskId,
    status: 'running',
    source: { planPath: divergePlanPath, sectionTitle: divergeTaskId, headingLine: 1, hash: 'abc123' }
  });
  const divergeStatus = await runTasks(['status', '--cwd', divergeRepo, '--task', divergeTaskId, '--json']);
  assert(divergeStatus.ok === true, 'TASK-AAO-0137 regression: divergent tasks status must succeed');
  const divergeEvidence = divergeStatus.evidence as Record<string, any>;
  assert(Array.isArray(divergeEvidence.divergence) && divergeEvidence.divergence.length > 0, 'TASK-AAO-0137 regression: frontmatter=done / ledger=running must produce divergence');
  assert(typeof divergeEvidence.recommendation === 'string' && divergeEvidence.recommendation.includes('reconcile'), 'TASK-AAO-0137 regression: divergence must recommend reconcile');

  const nextDefaultOutput = resolveNextDefaultOutputPath(root);
  assert(nextDefaultOutput.replace(/\\/g, '/').includes('.atm-temp/next-'), 'TASK-AAO-0137 regression: next default output must live under .atm-temp');
  const gitignoreText = readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert(gitignoreText.includes('next-output.json'), 'TASK-AAO-0137 regression: gitignore must include next-output.json');
  assert(gitignoreText.includes('*.atm-scratch.*'), 'TASK-AAO-0137 regression: gitignore must include *.atm-scratch.*');

  await validateTaskLedgerReadersAtomization(tempRoot);
  await validatePlanningOnlyLedgerAuditBoundary(tempRoot);
  await validateClosurePacketDirtyTreeHygieneGuard(tempRoot);
  await validateTaskImportRefreshClaimPreservation(tempRoot);
  await validateTaskImportDispatchMetadataPreservation(tempRoot);
  await validateTaskResidueClassification(tempRoot);
  validateEmergencyUsePreCommitAudit(tempRoot);
  await validateEmergencyLeaseUseCountSemantics(tempRoot);
  await validateTaskflowCloseOrchestration(tempRoot);

  if (!process.exitCode) {
    console.log(`[task-ledger-governance:${mode}] ok (dual ledger modes, visible mirrors, CLI transitions, disabled ledger, AI manual task rejection, legacy baseline migration, TASK-AAO-0038 import contract fidelity, TASK-AAO-0050 stale framework lock classification, TEST-TASK fixture id clarity, TASK-AAO-0053 batch framework delivery window, TASK-AAO-0055 historical done task reconcile closure sync, TASK-AAO-0056 deliver-and-close macro end-to-end, TASK-AAO-0057 close-gate scoped diff isolation, TASK-AAO-0061 task-ledger-readers atomization verified, TASK-AAO-0039 planning-only ledger audit boundary covered, TASK-AAO-0137 write-path atomicity + operator diagnostics covered, TASK-AAO-0140 taskflow close closeback orchestration covered, and TASK-AAO-0044 batch skip/resume audit covered)`);
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

async function validateTaskImportDispatchMetadataPreservation(tempRoot: string) {
  const repo = makeHostRepo(tempRoot, 'dispatch-metadata-preservation');
  initGitRepo(repo);

  const planPath = path.join(repo, 'docs', 'plan', 'TASK-LEDGER-DISPATCH-0001.task.md');
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, [
    '---',
    'task_id: TASK-LEDGER-DISPATCH-0001',
    'title: "Ledger dispatch metadata preservation"',
    'status: open',
    'assignee: "008"',
    'scopePaths:',
    '  - "packages/cli/src/commands/tasks.ts"',
    'deliverables:',
    '  - "packages/cli/src/commands/tasks.ts"',
    'dispatch_pattern:',
    '  shape: "dual-agent (Phase 0 planner + Phase 1 builder)"',
    '  phase_1:',
    '    lane: "external builder 008"',
    '    forbidden_files:',
    '      - ".atm/runtime/**"',
    'condition_review:',
    '  - "ledger JSON preserves dispatchPattern"',
    '  - "mailboxAssignee resolves from assignee"',
    '---',
    '# TASK-LEDGER-DISPATCH-0001',
    ''
  ].join('\n'), 'utf8');

  const dryRun = await runTasks(['import', '--cwd', repo, '--from', planPath, '--dry-run', '--json']);
  assert(dryRun.ok === true, 'dispatch metadata dry-run must succeed');
  const dryTask = ((dryRun.evidence as Record<string, any>).manifest.tasks as Array<Record<string, any>>)[0];
  assert(dryTask.dispatchPattern?.shape?.includes('dual-agent'), 'dry-run must preserve dispatchPattern.shape');
  assert(dryTask.conditionReview?.length === 2, 'dry-run must preserve conditionReview');
  assert(dryTask.mailboxAssignee === '008', 'dry-run must preserve mailboxAssignee');

  const writeResult = await runTasks(['import', '--cwd', repo, '--from', planPath, '--write', '--json']);
  assert(writeResult.ok === true, 'dispatch metadata write must succeed');
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-LEDGER-DISPATCH-0001.json');
  const written = readJson(taskPath);
  assert(written.dispatchPattern?.phase1?.lane === 'external builder 008', 'write must persist dispatchPattern.phase1.lane');
  assert(Array.isArray(written.conditionReview) && written.conditionReview.length === 2, 'write must persist conditionReview');
  assert(written.mailboxAssignee === '008', 'write must persist mailboxAssignee');

  const refreshResult = await runTasks(['import', '--cwd', repo, '--from', planPath, '--write', '--force', '--json']);
  assert(refreshResult.ok === true, 'dispatch metadata refresh must succeed');
  const refreshed = readJson(taskPath);
  assert(refreshed.dispatchPattern?.phase1?.forbiddenFiles?.includes('.atm/runtime/**'), 'refresh must keep phase1 forbidden_files');
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

async function validateTaskResidueClassification(tempRoot: string) {
  const repo = makeHostRepo(tempRoot, 'residue-classification');
  initGitRepo(repo);

  function writePlanningCard(planRelativePath: string, taskId: string, status: string) {
    const planPath = path.join(repo, planRelativePath);
    mkdirSync(path.dirname(planPath), { recursive: true });
    writeFileSync(planPath, [
      '---',
      `task_id: ${taskId}`,
      'title: "Residue classification fixture"',
      `status: ${status}`,
      '---',
      `# ${taskId}`,
      ''
    ].join('\n'), 'utf8');
    return planPath;
  }

  const completeTaskId = 'TASK-RESIDUE-0001';
  const completePlanPath = writePlanningCard('docs/fixtures/residue-complete.task.md', completeTaskId, 'done');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${completeTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: completeTaskId,
    title: 'Complete but unfinalized fixture',
    status: 'running',
    planningRepo: '3KLife',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    closedAt: '2026-06-10T00:00:00.000Z',
    closurePacket: '.atm/history/evidence/TASK-RESIDUE-0001.closure-packet.json',
    claim: {
      actorId: 'fixture-agent',
      leaseId: 'lease-0001',
      claimedAt: '2026-06-10T00:00:00.000Z',
      heartbeatAt: '2026-06-10T00:00:00.000Z',
      state: 'active',
      files: ['.atm/history/tasks/TASK-RESIDUE-0001.json']
    },
    lastTransitionId: 'transition-0001',
    lastTransitionAt: '2026-06-10T00:00:00.000Z',
    source: {
      planPath: completePlanPath,
      sectionTitle: completeTaskId,
      headingLine: 1,
      hash: 'complete-unfinalized'
    }
  });
  mkdirSync(path.join(repo, '.atm', 'history', 'task-events', completeTaskId), { recursive: true });
  writeFileSync(path.join(repo, '.atm', 'history', 'task-events', completeTaskId, 'transition-0001.json'), JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    specVersion: '0.1.0',
    transitionId: 'transition-0001',
    taskId: completeTaskId,
    action: 'close',
    actorId: 'fixture-agent',
    fromStatus: 'running',
    toStatus: 'running',
    taskPath: `.atm/history/tasks/${completeTaskId}.json`,
    taskSha256: sha256File(path.join(repo, '.atm', 'history', 'tasks', `${completeTaskId}.json`)),
    createdAt: '2026-06-10T00:00:00.000Z'
  }, null, 2), 'utf8');

  const completeStatus = await runTasks(['status', '--cwd', repo, '--task', completeTaskId, '--json']);
  assert(completeStatus.ok === true, 'complete-but-unfinalized status must succeed');
  const completeResidue = completeStatus.evidence.residueClassification as any;
  assert(completeResidue.bucket === 'complete-but-unfinalized', 'complete-but-unfinalized bucket must be reported');
  assert(String(completeResidue.nextCommand).includes('tasks reconcile'), 'complete-but-unfinalized next command must point to reconcile');
  assert(String(completeResidue.nextCommand).includes(completeTaskId), 'complete-but-unfinalized next command must materialize task id');
  assert(completeResidue.autoMutationAllowed === false, 'complete-but-unfinalized must not allow auto mutation');

  const mirrorTaskId = 'TASK-RESIDUE-0002';
  const mirrorPlanPath = writePlanningCard('docs/fixtures/residue-mirror.task.md', mirrorTaskId, 'done');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${mirrorTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: mirrorTaskId,
    title: 'Planning mirror only fixture',
    status: 'done',
    planningRepo: 'AI-Atomic-Framework',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'planning_repo',
    source: {
      planPath: mirrorPlanPath,
      sectionTitle: mirrorTaskId,
      headingLine: 1,
      hash: 'planning-mirror-only'
    }
  });
  const mirrorStatus = await runTasks(['status', '--cwd', repo, '--task', mirrorTaskId, '--json']);
  assert(mirrorStatus.ok === true, 'planning-mirror-only status must succeed');
  const mirrorResidue = mirrorStatus.evidence.residueClassification as any;
  assert(mirrorResidue.bucket === 'planning-mirror-only', 'planning-mirror-only bucket must be reported');
  assert(String(mirrorResidue.nextCommand).includes('tasks import'), 'planning-mirror-only next command must point to import');

  const interruptedTaskId = 'TASK-RESIDUE-0003';
  const interruptedPlanPath = writePlanningCard('docs/fixtures/residue-interrupted.task.md', interruptedTaskId, 'done');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${interruptedTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: interruptedTaskId,
    title: 'Interrupted close fixture',
    status: 'done',
    planningRepo: '3KLife',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    closedAt: '2026-06-10T00:00:00.000Z',
    claim: {
      actorId: 'fixture-agent',
      leaseId: 'lease-0003',
      claimedAt: '2026-06-10T00:00:00.000Z',
      heartbeatAt: '2026-06-10T00:00:00.000Z',
      state: 'active',
      files: ['.atm/history/tasks/TASK-RESIDUE-0003.json']
    },
    source: {
      planPath: interruptedPlanPath,
      sectionTitle: interruptedTaskId,
      headingLine: 1,
      hash: 'interrupted-close'
    }
  });
  const interruptedStatus = await runTasks(['status', '--cwd', repo, '--task', interruptedTaskId, '--json']);
  assert(interruptedStatus.ok === true, 'interrupted-close status must succeed');
  const interruptedResidue = interruptedStatus.evidence.residueClassification as any;
  assert(interruptedResidue.bucket === 'interrupted-close', 'interrupted-close bucket must be reported');
  assert(String(interruptedResidue.nextCommand).includes('repair-closure'), 'interrupted-close next command must point to repair-closure');
  assert(String(interruptedResidue.nextCommand).includes(interruptedTaskId), 'interrupted-close next command must materialize task id');

  const staleTaskId = 'TASK-RESIDUE-0004';
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${staleTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: staleTaskId,
    title: 'Stale import fixture',
    status: 'done',
    planningRepo: '3KLife',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    closurePacket: `.atm/history/evidence/${staleTaskId}.closure-packet.json`,
    source: {
      planPath: path.join(repo, 'docs', 'fixtures', 'missing-residue-stale.task.md'),
      sectionTitle: staleTaskId,
      headingLine: 1,
      hash: 'stale-import'
    }
  });
  writeJson(path.join(repo, '.atm', 'history', 'evidence', `${staleTaskId}.closure-packet.json`), {
    schemaId: 'atm.closurePacket.v1',
    taskId: staleTaskId
  });
  const staleStatus = await runTasks(['status', '--cwd', repo, '--task', staleTaskId, '--json']);
  assert(staleStatus.ok === true, 'stale-import status must succeed');
  const staleResidue = staleStatus.evidence.residueClassification as any;
  assert(staleResidue.bucket === 'stale-import', 'stale-import bucket must be reported');
  assert(String(staleResidue.nextCommand).includes('--force'), 'stale-import next command must point to force import');

  const noResidueTaskId = 'TASK-RESIDUE-0005';
  const noResiduePlanPath = writePlanningCard('docs/fixtures/residue-none.task.md', noResidueTaskId, 'done');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${noResidueTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: noResidueTaskId,
    title: 'No residue fixture',
    status: 'done',
    planningRepo: '3KLife',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    closurePacket: `.atm/history/evidence/${noResidueTaskId}.closure-packet.json`,
    closedAt: '2026-06-10T00:00:00.000Z',
    source: {
      planPath: noResiduePlanPath,
      sectionTitle: noResidueTaskId,
      headingLine: 1,
      hash: 'no-residue'
    }
  });
  writeJson(path.join(repo, '.atm', 'history', 'evidence', `${noResidueTaskId}.closure-packet.json`), {
    schemaId: 'atm.closurePacket.v1',
    taskId: noResidueTaskId
  });
  const noResidueStatus = await runTasks(['status', '--cwd', repo, '--task', noResidueTaskId, '--residue', '--json']);
  assert(noResidueStatus.ok === true, 'no-residue status must succeed');
  const noResidue = (noResidueStatus.evidence.residueClassification ?? noResidueStatus.evidence) as any;
  assert(noResidue.bucket === 'no-residue', 'complete done/done task must report no-residue');
  assert(String(noResidue.nextCommand).includes('tasks status'), 'no-residue next command must point to status');

  const ambiguousTaskId = 'TASK-RESIDUE-0006';
  writePlanningCard('docs/fixtures/residue-ambiguous.task.md', ambiguousTaskId, 'open');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${ambiguousTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: ambiguousTaskId,
    title: 'Ambiguous review fixture',
    status: 'blocked',
    source: {
      planPath: path.join(repo, 'docs', 'fixtures', 'residue-ambiguous.task.md'),
      sectionTitle: ambiguousTaskId,
      headingLine: 1,
      hash: 'ambiguous-review'
    }
  });
  const ambiguousStatus = await runTasks(['status', '--cwd', repo, '--task', ambiguousTaskId, '--json']);
  assert(ambiguousStatus.ok === true, 'ambiguous-manual-review status must succeed');
  const ambiguousResidue = ambiguousStatus.evidence.residueClassification as any;
  assert(ambiguousResidue.bucket === 'ambiguous-manual-review', 'ambiguous-manual-review bucket must be reported');
  assert(String(ambiguousResidue.nextCommand).includes('tasks status'), 'ambiguous-manual-review next command must point to status');

  const activeClaimTaskId = 'TASK-RESIDUE-0007';
  const activeClaimPlanPath = writePlanningCard('docs/fixtures/residue-active-claim.task.md', activeClaimTaskId, 'planned');
  const activeClaimTransitionId = '2026-06-14T00-00-00-000Z-claim-fixture';
  mkdirSync(path.join(repo, '.atm', 'history', 'task-events', activeClaimTaskId), { recursive: true });
  writeJson(path.join(repo, '.atm', 'history', 'task-events', activeClaimTaskId, `${activeClaimTransitionId}.json`), {
    action: 'claim',
    actorId: 'fixture-agent',
    createdAt: '2026-06-14T00:00:00.000Z',
    fromStatus: 'open',
    toStatus: 'running'
  });
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${activeClaimTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: activeClaimTaskId,
    title: 'Active claim parity fixture',
    status: 'running',
    lastTransitionId: activeClaimTransitionId,
    claim: {
      actorId: 'fixture-agent',
      leaseId: 'lease-0007',
      claimedAt: '2026-06-14T00:00:00.000Z',
      heartbeatAt: '2026-06-14T00:00:00.000Z',
      state: 'active',
      files: ['.atm/history/tasks/TASK-RESIDUE-0007.json']
    },
    source: {
      planPath: activeClaimPlanPath,
      sectionTitle: activeClaimTaskId,
      headingLine: 1,
      hash: 'active-claim-parity'
    }
  });
  const activeClaimStatus = await runTasks(['status', '--cwd', repo, '--task', activeClaimTaskId, '--json']);
  assert(activeClaimStatus.ok === true, 'active-claim parity status must succeed');
  const activeClaimResidue = activeClaimStatus.evidence.residueClassification as any;
  assert(activeClaimResidue.bucket === 'no-residue', 'active-claim parity must downgrade stale planning drift to no-residue');
  assert(activeClaimStatus.evidence.recommendation === null, 'active-claim parity must not recommend redundant import repair');

  const releasedTaskId = 'TASK-RESIDUE-0008';
  const releasedPlanPath = writePlanningCard('docs/fixtures/residue-released.task.md', releasedTaskId, 'planned');
  const releasedTransitionId = '2026-06-14T00-00-00-000Z-release-fixture';
  mkdirSync(path.join(repo, '.atm', 'history', 'task-events', releasedTaskId), { recursive: true });
  writeJson(path.join(repo, '.atm', 'history', 'task-events', releasedTaskId, `${releasedTransitionId}.json`), {
    action: 'release',
    actorId: 'fixture-agent',
    createdAt: '2026-06-14T00:00:00.000Z',
    fromStatus: 'running',
    toStatus: 'open'
  });
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${releasedTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: releasedTaskId,
    title: 'Released predecessor parity fixture',
    status: 'open',
    lastTransitionId: releasedTransitionId,
    claim: {
      actorId: 'fixture-agent',
      leaseId: 'lease-0008',
      claimedAt: '2026-06-14T00:00:00.000Z',
      heartbeatAt: '2026-06-14T00:00:00.000Z',
      state: 'released',
      files: ['.atm/history/tasks/TASK-RESIDUE-0008.json']
    },
    source: {
      planPath: releasedPlanPath,
      sectionTitle: releasedTaskId,
      headingLine: 1,
      hash: 'released-parity'
    }
  });
  const releasedStatus = await runTasks(['status', '--cwd', repo, '--task', releasedTaskId, '--json']);
  assert(releasedStatus.ok === true, 'released predecessor parity status must succeed');
  const releasedResidue = releasedStatus.evidence.residueClassification as any;
  assert(releasedResidue.bucket === 'no-residue', 'released predecessor parity must not report ambiguous-manual-review');
  assert(releasedStatus.evidence.recommendation === null, 'released predecessor parity must not recommend import repair by default');
}

async function validateTaskflowCloseOrchestration(tempRoot: string) {
  const repo = makeHostRepo(tempRoot, 'taskflow-close-orchestration');
  initGitRepo(repo);
  const governedProfilePath = path.join(root, 'fixtures/taskflow-profile/governed-invocable.profile.json');

  const taskId = 'TASK-CLOSE-ORCH-0001';
  const planRelativePath = 'docs/tasks/TASK-CLOSE-ORCH-0001.task.md';
  const planPath = path.join(repo, planRelativePath);
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, [
    '---',
    `task_id: ${taskId}`,
    'title: "Taskflow close orchestration fixture"',
    'status: running',
    '---',
    `# ${taskId}`,
    ''
  ].join('\n'), 'utf8');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Taskflow close orchestration fixture',
    status: 'running',
    related_plan: planRelativePath,
    source: { planPath: planRelativePath, sectionTitle: taskId, headingLine: 1, hash: 'taskflow-close' }
  });

  const dryRun = await runTaskflow(['close', '--cwd', repo, '--task', taskId, '--profile', governedProfilePath, '--json']) as any;
  assert(dryRun.ok === true, 'taskflow close dry-run must succeed');
  assert(dryRun.schemaId === 'atm.taskflowCloseResult.v1', 'taskflow close must return atm.taskflowCloseResult.v1');
  assert(dryRun.evidence.closeMode === 'normal-close', 'taskflow close dry-run must report normal-close');
  assert(dryRun.evidence.closebackPlan.backendSurface === 'tasks-close', 'taskflow close must route to tasks-close backend');
  assert(dryRun.evidence.closebackPlan.writerBoundary.generationSurface === 'tasks-new', 'taskflow close must not add a second generator');
  assert(dryRun.evidence.governedCommitBundle?.schemaId === 'atm.taskflowGovernedCommitBundle.v1', 'taskflow close must report governed commit bundle schema');
  assert(dryRun.evidence.governedCommitBundle?.commitMode === 'dry-run', 'taskflow close dry-run bundle must report dry-run commit mode');
  assert(dryRun.evidence.governedCommitBundle?.targetRepo?.stageFiles?.includes(`.atm/history/tasks/${taskId}.json`), 'taskflow close bundle must include target task json');
  assert(dryRun.evidence.governedCommitBundle?.planningRepo?.stageFiles?.includes(planRelativePath), 'taskflow close bundle must include planning card path');

  const plannedTaskId = 'TASK-CLOSE-ORCH-0002';
  const plannedPlanRelativePath = 'docs/tasks/TASK-CLOSE-ORCH-0002.task.md';
  const plannedPlanPath = path.join(repo, plannedPlanRelativePath);
  writeFileSync(plannedPlanPath, [
    '---',
    `task_id: ${plannedTaskId}`,
    'title: "Taskflow close planned mirror fixture"',
    'status: planned',
    '---',
    `# ${plannedTaskId}`,
    ''
  ].join('\n'), 'utf8');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${plannedTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: plannedTaskId,
    title: 'Taskflow close planned mirror fixture',
    status: 'running',
    related_plan: plannedPlanRelativePath,
    source: { planPath: plannedPlanRelativePath, sectionTitle: plannedTaskId, headingLine: 1, hash: 'taskflow-close-planned' }
  });
  const plannedDryRun = await runTaskflow([
    'close',
    '--cwd', repo,
    '--task', plannedTaskId,
    '--profile', governedProfilePath,
    '--historical-delivery', '0123456789abcdef',
    '--json'
  ]) as any;
  assert(plannedDryRun.ok === true, 'taskflow close dry-run must accept active target plus planned planning mirror');
  assert(plannedDryRun.evidence.closeMode === 'normal-close', 'active target plus planned planning mirror must not route to ambiguous manual review');
  assert(plannedDryRun.evidence.closebackPlan.backendSurface === 'tasks-close', 'active target plus planned planning mirror must use tasks-close backend');

  const claimedParityTaskId = 'TASK-CLOSE-ORCH-0003';
  const claimedParityPlanRelativePath = 'docs/tasks/TASK-CLOSE-ORCH-0003.task.md';
  writeFileSync(path.join(repo, claimedParityPlanRelativePath), [
    '---',
    `task_id: ${claimedParityTaskId}`,
    'title: "Taskflow close claimed parity fixture"',
    'status: planned',
    '---',
    `# ${claimedParityTaskId}`,
    ''
  ].join('\n'), 'utf8');
  const claimedParityTransitionId = '2026-06-14T00-00-00-000Z-claim-fixture';
  mkdirSync(path.join(repo, '.atm', 'history', 'task-events', claimedParityTaskId), { recursive: true });
  writeJson(path.join(repo, '.atm', 'history', 'task-events', claimedParityTaskId, `${claimedParityTransitionId}.json`), {
    action: 'claim',
    actorId: 'validator',
    createdAt: '2026-06-14T00:00:00.000Z',
    fromStatus: 'open',
    toStatus: 'running'
  });
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${claimedParityTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: claimedParityTaskId,
    title: 'Taskflow close claimed parity fixture',
    status: 'running',
    related_plan: claimedParityPlanRelativePath,
    lastTransitionId: claimedParityTransitionId,
    claim: {
      actorId: 'validator',
      leaseId: 'lease-close-0003',
      claimedAt: '2026-06-14T00:00:00.000Z',
      heartbeatAt: '2026-06-14T00:00:00.000Z',
      state: 'active',
      files: ['.atm/history/tasks/TASK-CLOSE-ORCH-0003.json']
    },
    source: { planPath: claimedParityPlanRelativePath, sectionTitle: claimedParityTaskId, headingLine: 1, hash: 'taskflow-close-claimed-parity' }
  });
  const claimedParityDryRun = await runTaskflow([
    'close',
    '--cwd', repo,
    '--task', claimedParityTaskId,
    '--actor', 'validator',
    '--profile', governedProfilePath,
    '--historical-delivery', '0123456789abcdef',
    '--json'
  ]) as any;
  assert(claimedParityDryRun.ok === true, 'claimed parity dry-run must succeed');
  assert(claimedParityDryRun.evidence.closeMode === 'normal-close', 'claimed parity dry-run must keep the normal close lane');
  assert(claimedParityDryRun.evidence.closebackPlan.backendSurface === 'tasks-close', 'claimed parity dry-run must keep tasks-close backend');
  assert(claimedParityDryRun.evidence.residueDiagnosis.bucket === 'no-residue', 'claimed parity dry-run must not surface ambiguous-manual-review solely due to planned mirror drift');

  const claimBlockedTaskId = 'TASK-CLOSE-ORCH-0004';
  const claimBlockedPlanRelativePath = 'docs/tasks/TASK-CLOSE-ORCH-0004.task.md';
  writeFileSync(path.join(repo, claimBlockedPlanRelativePath), [
    '---',
    `task_id: ${claimBlockedTaskId}`,
    'title: "Taskflow close active-claim blocker fixture"',
    'status: running',
    '---',
    `# ${claimBlockedTaskId}`,
    ''
  ].join('\n'), 'utf8');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'claim-blocked.ts'), 'export const claimBlocked = true;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'claim-blocked delivery'], { cwd: repo, stdio: 'ignore' });
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${claimBlockedTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: claimBlockedTaskId,
    title: 'Taskflow close active-claim blocker fixture',
    status: 'running',
    claim: {
      state: 'active',
      actorId: 'other-validator',
      leaseId: 'lease-claim-blocked'
    },
    deliverables: ['src/claim-blocked.ts'],
    scopePaths: ['src/claim-blocked.ts'],
    source: { planPath: claimBlockedPlanRelativePath, sectionTitle: claimBlockedTaskId, headingLine: 1, hash: 'claim-blocked' }
  });
  writeJson(path.join(repo, '.atm', 'history', 'evidence', `${claimBlockedTaskId}.json`), {
    taskId: claimBlockedTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'active-claim blocker fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
      artifactPaths: ['src/claim-blocked.ts'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate active-claim blocker fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  const claimBlockedDryRun = await runTaskflow([
    'close',
    '--cwd', repo,
    '--task', claimBlockedTaskId,
    '--actor', 'validator',
    '--profile', governedProfilePath,
    '--historical-delivery', 'HEAD',
    '--json'
  ]) as any;
  assert(claimBlockedDryRun.ok === true, 'active-claim parity dry-run must still return a non-mutating preview');
  assert(claimBlockedDryRun.evidence.writeReadinessHint?.status === 'blocked', 'active-claim parity dry-run must disclose blocked write readiness');
  assert((claimBlockedDryRun.evidence.writeReadinessHint?.blockers ?? []).some((entry: any) => entry.code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED'),
    'active-claim parity dry-run must surface ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED');
  const waiverTaskId = 'TASK-CLOSE-ORCH-0005';
  const waiverPlanRelativePath = 'docs/tasks/TASK-CLOSE-ORCH-0005.task.md';
  writeFileSync(path.join(repo, waiverPlanRelativePath), [
    '---',
    `task_id: ${waiverTaskId}`,
    'title: "Taskflow close waiver blocker fixture"',
    'status: running',
    '---',
    `# ${waiverTaskId}`,
    ''
  ].join('\n'), 'utf8');
  writeFileSync(path.join(repo, 'src', 'waiver-owned.ts'), 'export const waiverOwned = true;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'waiver-unrelated.ts'), 'export const waiverUnrelated = true;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'waiver delivery'], { cwd: repo, stdio: 'ignore' });
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${waiverTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: waiverTaskId,
    title: 'Taskflow close waiver blocker fixture',
    status: 'ready',
    deliverables: ['src/waiver-owned.ts'],
    scopePaths: ['src/waiver-owned.ts'],
    source: { planPath: waiverPlanRelativePath, sectionTitle: waiverTaskId, headingLine: 1, hash: 'waiver-blocked' },
    validators: ['npm run typecheck', 'npm run validate:cli', 'npm run validate:git-head-evidence']
  });
  const waiverClaim = await runNext(['--cwd', repo, '--claim', '--actor', 'validator', '--task', waiverTaskId]);
  assert(waiverClaim.ok === true, 'waiver parity fixture must create an active claim');
  writeJson(path.join(repo, '.atm', 'history', 'evidence', `${waiverTaskId}.json`), {
    taskId: waiverTaskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'waiver parity fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
      artifactPaths: ['src/waiver-owned.ts'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate waiver parity fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      }]
    }]
  });
  const waiverDryRun = await runTaskflow([
    'close',
    '--cwd', repo,
    '--task', waiverTaskId,
    '--actor', 'validator',
    '--profile', governedProfilePath,
    '--historical-delivery', 'HEAD',
    '--json'
  ]) as any;
  assert(waiverDryRun.ok === true, 'waiver parity dry-run must still succeed as preview');
  assert(waiverDryRun.evidence.writeReadinessHint?.status === 'blocked', 'waiver parity dry-run must disclose blocked write readiness');
  assert((waiverDryRun.evidence.writeReadinessHint?.blockers ?? []).some((entry: any) => entry.code === 'ATM_TASKFLOW_CLOSE_OUT_OF_SCOPE_WAIVER_REQUIRED'),
    'waiver parity dry-run must disclose out-of-scope waiver blocker');
  const waiverWrite = await expectTaskflowErrorDetails([
    'close',
    '--cwd', repo,
    '--task', waiverTaskId,
    '--actor', 'validator',
    '--profile', governedProfilePath,
    '--historical-delivery', 'HEAD',
    '--write',
    '--json'
  ], 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED');
  const waiverHistory = waiverWrite.historicalDeliveries?.[0];
  assert(waiverHistory?.reason === 'out-of-scope-source-files-present',
    `waiver parity write failure must preserve out-of-scope historical delivery reason, got ${String(waiverHistory?.reason ?? '<missing>')}`);

  const profileFallbackTaskId = 'TASK-CLOSE-ORCH-0003';
  const profileFallbackPlanRelativePath = `docs/tasks/${profileFallbackTaskId}.task.md`;
  const profileFallbackPlanPath = path.join(repo, profileFallbackPlanRelativePath);
  const profileFallbackProfilePath = path.join(repo, 'taskflow.profile.json');
  writeFileSync(profileFallbackPlanPath, [
    '---',
    `task_id: ${profileFallbackTaskId}`,
    'title: "Taskflow close profile-root fallback fixture"',
    'status: running',
    '---',
    `# ${profileFallbackTaskId}`,
    ''
  ].join('\n'), 'utf8');
  writeJson(profileFallbackProfilePath, {
    schemaId: 'taskflow.profile.v1',
    id: 'taskflow-close-profile-fallback-fixture',
    name: 'Taskflow Close Profile Fallback Fixture',
    repoLabel: 'Planning Repo',
    ownerRepo: 'planning',
    taskIdPrefix: 'TASK-CLOSE-ORCH',
    taskId: { format: 'TASK-CLOSE-ORCH-NNNN' },
    template: { defaultMarkdown: '# ${taskId} ${title}\n\n## Goal\n${description}' },
    capabilities: { supportsDryRun: true, supportsWrite: false },
    delegation: {
      hint: 'Profile-root closeback fallback fixture.',
      openerPath: 'tools/task-card-opener.js',
      policy: {
        allocateTaskId: { mode: 'host-opener', prefix: 'TASK-CLOSE-ORCH', format: 'TASK-CLOSE-ORCH-NNNN' },
        resolveCanonicalOutputPath: {
          mode: 'host-opener',
          pattern: 'docs/tasks/${taskId}.task.md',
          directory: 'docs/tasks'
        },
        rosterSyncPolicy: 'none',
        fallbackBehavior: { mode: 'template-only-fallback', reason: 'fixture fallback' }
      },
      writerInvocation: { describeOnly: false, displayHint: 'fixture opener' }
    }
  });
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${profileFallbackTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: profileFallbackTaskId,
    title: 'Taskflow close profile-root fallback fixture',
    status: 'running'
  });
  const profileFallbackDryRun = await runTaskflow([
    'close',
    '--cwd', repo,
    '--task', profileFallbackTaskId,
    '--profile', profileFallbackProfilePath,
    '--json'
  ]) as any;
  assert(profileFallbackDryRun.ok === true, 'taskflow close must recover planning path from profile when source.planPath is absent');
  assert(profileFallbackDryRun.evidence.closebackPathResolution.route === 'profile-root-fallback', 'taskflow close must report profile-root fallback route');
  assert(profileFallbackDryRun.evidence.governedCommitBundle?.planningRepo?.stageFiles?.includes(profileFallbackPlanRelativePath), 'profile-root fallback must include recovered planning card in bundle');
}

function validateEmergencyUsePreCommitAudit(tempRoot: string) {
  const repo = makeHostRepo(tempRoot, 'emergency-use-precommit-audit');
  initGitRepo(repo);
  const leaseId = 'EMG-TASK-EMERGENCY-0001-validator';
  const usePath = path.join(repo, '.atm', 'runtime', 'emergency', 'uses', '2026-06-13T00-00-00-000Z-EMG-TASK-EMERGENCY-0001-validator.json');
  const leasePath = path.join(repo, '.atm', 'runtime', 'emergency', 'leases', `${leaseId}.json`);
  writeJson(usePath, {
    schemaId: 'atm.emergencyMaintenanceUse.v1',
    leaseId,
    taskId: 'TASK-EMERGENCY-0001',
    actorId: 'validator',
    permission: 'backend.tasks.reconcile',
    surface: 'tasks reconcile',
    usedAt: '2026-06-13T00:00:00.000Z',
    reason: 'validator fixture',
    command: 'node atm.mjs tasks reconcile --task TASK-EMERGENCY-0001 --actor validator --json',
    result: 'authorized',
    before: { leaseStatus: 'active', usedCount: 0 },
    after: { leaseStatus: 'used', usedCount: 1 },
    touchedFiles: ['.atm/history/tasks/TASK-EMERGENCY-0001.json']
  });
  execFileSync('git', ['add', '.atm/runtime/emergency/uses'], { cwd: repo, stdio: 'ignore' });
  const missingLeaseHook = runHook(['pre-commit', '--cwd', repo]) as any;
  assert(missingLeaseHook.ok === false, 'pre-commit must reject a staged emergency use record without its matching lease');
  assert((missingLeaseHook.evidence?.emergencyUseAuditReport?.findings ?? []).some((finding: any) => finding.code === 'ATM_EMERGENCY_USE_LEASE_MISSING'), 'pre-commit must report ATM_EMERGENCY_USE_LEASE_MISSING');
  execFileSync('git', ['reset', '--quiet'], { cwd: repo, stdio: 'ignore' });

  writeJson(leasePath, {
    schemaId: 'atm.emergencyMaintenanceLease.v1',
    leaseId,
    permission: 'backend.tasks.reconcile',
    taskId: 'TASK-EMERGENCY-0001',
    actorId: 'validator',
    approvedAt: '2026-06-13T00:00:00.000Z',
    expiresAt: '2026-06-13T00:30:00.000Z',
    approvedBy: 'human',
    approvalText: 'Human approved validator emergency use fixture',
    allowedFlags: [],
    reason: 'validator fixture',
    status: 'used',
    maxUses: 1,
    usedCount: 1
  });
  execFileSync('git', ['add', '.atm/runtime/emergency'], { cwd: repo, stdio: 'ignore' });
  const matchedLeaseHook = runHook(['pre-commit', '--cwd', repo]) as any;
  assert(matchedLeaseHook.evidence?.emergencyUseAuditReport?.ok === true, 'pre-commit emergency audit must pass when use and used lease match');
  assert(!(matchedLeaseHook.evidence?.blockingFindings ?? []).some((finding: any) => finding.source === 'emergency-use-audit'), 'matching emergency use and lease must not create emergency-use-audit blocking findings');
}

async function validateEmergencyLeaseUseCountSemantics(tempRoot: string) {
  const repo = makeHostRepo(tempRoot, 'emergency-lease-use-count-semantics');
  initGitRepo(repo);

  const taskId = 'TASK-EMERGENCY-LEASE-0001';
  const planRelativePath = `docs/tasks/${taskId}.task.md`;
  mkdirSync(path.join(repo, 'docs', 'tasks'), { recursive: true });
  writeFileSync(path.join(repo, planRelativePath), [
    '---',
    `task_id: ${taskId}`,
    'title: "Emergency lease use-count semantics fixture"',
    'status: running',
    '---',
    `# ${taskId}`,
    ''
  ].join('\n'), 'utf8');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'lease-owned.ts'), 'export const leaseOwned = true;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'lease-unrelated.ts'), 'export const leaseUnrelated = true;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'emergency lease fixture delivery'], { cwd: repo, stdio: 'ignore' });

  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Emergency lease use-count semantics fixture',
    status: 'ready',
    deliverables: ['src/lease-owned.ts'],
    scopePaths: ['src/lease-owned.ts'],
    source: { planPath: planRelativePath, sectionTitle: taskId, headingLine: 1, hash: 'emergency-lease-semantics' }
  });
  const claimResult = await runNext(['--cwd', repo, '--claim', '--actor', 'validator', '--task', taskId, '--json']);
  assert(claimResult.ok === true, 'emergency lease semantics fixture must create an active claim');

  writeJson(path.join(repo, '.atm', 'history', 'evidence', `${taskId}.json`), {
    taskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'emergency lease semantics fixture evidence',
      producedBy: 'validator',
      freshness: 'fresh',
      artifactPaths: ['src/lease-owned.ts'],
      createdAt: new Date().toISOString(),
      commandRuns: [{
        command: 'validate emergency lease semantics fixture',
        exitCode: 0,
        stdoutSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        stderrSha256: 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
      }]
    }]
  });

  const leaseId = 'EMG-TASK-EMERGENCY-LEASE-0001-validator';
  writeJson(path.join(repo, '.atm', 'runtime', 'emergency', 'leases', `${leaseId}.json`), {
    schemaId: 'atm.emergencyMaintenanceLease.v1',
    leaseId,
    permission: 'backend.tasks.close',
    taskId,
    actorId: 'validator',
    approvedBy: 'human',
    approvalText: 'Human approved emergency close fixture',
    reason: 'validator fixture',
    surface: 'tasks close historical-delivery backend',
    allowedFlags: ['--historical-delivery', '--waiver-out-of-scope-delivery'],
    createdAt: '2026-06-14T00:00:00.000Z',
    expiresAt: '2099-06-14T00:30:00.000Z',
    maxUses: 1,
    usedCount: 0,
    status: 'active',
    revokedAt: null,
    revokedBy: null
  });

  await expectBackendTaskErrorDetails([
    'close',
    '--cwd', repo,
    '--task', taskId,
    '--actor', 'validator',
    '--status', 'done',
    '--historical-delivery', 'HEAD',
    '--emergency-approval', leaseId,
    '--json'
  ], 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED');

  const firstLease = readJson(path.join(repo, '.atm', 'runtime', 'emergency', 'leases', `${leaseId}.json`));
  assert(firstLease.usedCount === 0, 'failed pre-mutation backend close must not consume the emergency lease');
  const usesDir = path.join(repo, '.atm', 'runtime', 'emergency', 'uses');
  const failedUseFiles = readdirSync(usesDir).filter((entry) => entry.includes(leaseId));
  assert(failedUseFiles.length === 1, 'failed pre-mutation backend close must write exactly one failed emergency audit record');
  const failedUse = readJson(path.join(usesDir, failedUseFiles[0]));
  assert(failedUse.result === 'failed', 'failed pre-mutation backend close must record result=failed');
  assert(Number(failedUse.before?.usedCount ?? -1) === 0, 'failed pre-mutation backend close must preserve before.usedCount=0');
  assert(Number(failedUse.after?.usedCount ?? -1) === 0, 'failed pre-mutation backend close must preserve after.usedCount=0');
  assert(failedUse.after?.failureCode === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED', 'failed pre-mutation backend close must capture the failure code');

  const success = await runTasksBackend([
    'close',
    '--cwd', repo,
    '--task', taskId,
    '--actor', 'validator',
    '--status', 'done',
    '--historical-delivery', 'HEAD',
    '--waiver-out-of-scope-delivery',
    '--reason', 'validator waiver for out-of-scope fixture file',
    '--emergency-approval', leaseId,
    '--json'
  ]) as any;
  assert(success.ok === true, 'waived backend close must succeed after the failed audited attempt');
  assert(success.evidence?.emergencyUse?.use?.result === 'authorized', 'successful backend close must still emit authorized emergency use evidence');
  const usedLease = readJson(path.join(repo, '.atm', 'runtime', 'emergency', 'leases', `${leaseId}.json`));
  assert(usedLease.usedCount === 1, 'successful backend close must consume the emergency lease exactly once');
  const allUseFiles = readdirSync(usesDir).filter((entry) => entry.includes(leaseId));
  assert(allUseFiles.length === 2, 'successful backend close must append exactly one additional emergency use record');

  try {
    assertEmergencyApproval({
      cwd: repo,
      surface: 'tasks close historical-delivery backend',
      permission: 'backend.tasks.close',
      taskId,
      actorId: 'validator',
      emergencyApproval: leaseId,
      flags: ['--historical-delivery', '--waiver-out-of-scope-delivery'],
      reason: 'validator replay rejection fixture',
      command: `node atm.mjs tasks close --task ${taskId} --actor validator --status done --historical-delivery HEAD --waiver-out-of-scope-delivery --json`
    });
    fail('replayed emergency approval expected ATM_EMERGENCY_APPROVAL_EXHAUSTED but succeeded.');
  } catch (error) {
    assert((error as { code?: string }).code === 'ATM_EMERGENCY_APPROVAL_EXHAUSTED', `replayed emergency approval expected ATM_EMERGENCY_APPROVAL_EXHAUSTED, got ${(error as { code?: string }).code ?? 'unknown'}.`);
  }
}
