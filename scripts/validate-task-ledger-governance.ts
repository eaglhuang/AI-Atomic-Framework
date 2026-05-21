import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditTasks, createFrameworkModeStatus } from '../packages/cli/src/commands/framework-development.ts';
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

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-ledger-'));

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
  const closeResult = await runTasks(['close', '--cwd', hostRepo, '--task', 'TASK-LEDGER-0001', '--actor', 'validator', '--status', 'done']);
  assert(closeResult.ok === true, 'tasks close must succeed with evidence');
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
  const migratedMarkdownText = readFileSync(legacyMarkdownPath, 'utf8');
  assert(migratedMarkdownText.includes('ledgerBaselineKind: legacy-transition-backfill'), 'Markdown task must record legacy baseline kind');
  assert(migratedMarkdownText.includes('lastTransitionId:'), 'Markdown task must record migrated lastTransitionId');
  const legacyAuditAfter = auditTasks(legacyRepo);
  assert(legacyAuditAfter.ok === true, 'legacy tasks with baseline transition evidence must pass audit');
  assert(legacyAuditAfter.findings.some((finding) => finding.code === 'ATM_TASK_AUDIT_LEGACY_BASELINE_DONE'), 'legacy baseline done warning must remain visible');

  if (!process.exitCode) {
    console.log(`[task-ledger-governance:${mode}] ok (dual ledger modes, visible mirrors, CLI transitions, disabled ledger, and legacy baseline migration verified)`);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
