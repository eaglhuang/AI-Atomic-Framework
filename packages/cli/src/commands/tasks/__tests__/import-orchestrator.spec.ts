/**
 * TASK-RFT-0012 spec — import-orchestrator surface smoke test.
 *
 * Branches exercised via CliError code:
 *   - fresh-open (missing --from)
 *   - drift (both --dry-run and --write set)
 *   - reset-open (reset-open without emergency approval → classification path)
 *   - emergency-lease (--force without approval)
 */
import { runTasksImport } from '../import-orchestrator.ts';
import { CliError } from '../../shared.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fail(message: string): never {
  console.error(`[import-orchestrator.spec] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

assert(typeof runTasksImport === 'function', 'runTasksImport export must be a function');
assert(runTasksImport.constructor.name === 'AsyncFunction', 'runTasksImport must be async');

async function expectCliError(argv: string[], branch: string): Promise<CliError> {
  try {
    await runTasksImport(argv);
    fail(`branch ${branch}: expected CliError, got success`);
  } catch (err) {
    if (!(err instanceof CliError)) {
      fail(`branch ${branch}: expected CliError, got ${err instanceof Error ? err.constructor.name : typeof err}`);
    }
    return err;
  }
}

// fresh-open branch: missing --from is a usage error
const missingFrom = await expectCliError(['--dry-run'], 'fresh-open');
assert(missingFrom.code === 'ATM_CLI_USAGE', 'missing --from must be a usage error');
assert(missingFrom.message.includes('--from <path-to-task-card.md>'), 'missing --from message must explain expected path form');
assert(missingFrom.message.includes('node atm.mjs tasks import --from .atm/task-plans/TASK-EXAMPLE-0001.md --write --json'), 'missing --from message must include copyable example');
assert(missingFrom.details.expectedFlag === '--from <path-to-task-card.md>', 'missing --from details must include expectedFlag');
assert(typeof missingFrom.details.exampleCommand === 'string', 'missing --from details must include exampleCommand');
// drift branch: both --dry-run and --write are contradictory
await expectCliError(['--from', 'docs/plan.md', '--dry-run', '--write'], 'drift');
// reset-open branch: --write --reset-open triggers classification/emergency path
await expectCliError(['--from', 'docs/nonexistent-plan.md', '--write', '--reset-open'], 'reset-open');
// emergency-lease branch: --force without approval token
await expectCliError(['--from', 'docs/nonexistent-plan.md', '--write', '--force'], 'emergency-lease');

const literalPlan = await expectCliError(['--from', 'plan', '--dry-run'], 'literal-plan');
assert(literalPlan.code === 'ATM_TASKS_PLAN_NOT_FOUND', 'literal plan must be rejected as missing plan path');
assert(literalPlan.message.includes('not the literal value "plan"'), 'literal plan message must explain that plan is not a path');
assert(literalPlan.message.includes('--from .atm/task-plans/TASK-EXAMPLE-0001.md'), 'literal plan message must include copyable path example');
assert(literalPlan.details.planPath === 'plan', 'literal plan details must preserve requested path');
assert(literalPlan.details.literalPlanValue === true, 'literal plan details must flag literalPlanValue');
assert(literalPlan.details.expectedFlag === '--from <path-to-task-card.md>', 'literal plan details must include expectedFlag');

const missingMarkdown = await expectCliError(['--from', 'docs/nonexistent-plan.md', '--dry-run'], 'missing-markdown');
assert(missingMarkdown.code === 'ATM_TASKS_PLAN_NOT_FOUND', 'missing markdown path must remain plan-not-found');
assert(missingMarkdown.message.includes('tasks import --from expects a markdown task-card path'), 'missing markdown message must explain expected --from path');
assert(missingMarkdown.details.planPath === 'docs/nonexistent-plan.md', 'missing markdown details must preserve requested path');
assert(missingMarkdown.details.literalPlanValue === false, 'missing markdown details must not flag literalPlanValue');

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-import-orchestrator-'));
try {
  writeJson(path.join(tempRoot, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  const taskId = 'TASK-IMPORT-077';
  const planPath = path.join(tempRoot, 'docs/tasks/TASK-IMPORT-077.task.md');
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, [
    '---',
    `task_id: ${taskId}`,
    'title: Reconcile mirror fixture',
    'status: done',
    'planning_repo: PlanningRepo',
    'target_repo: TargetRepo',
    'closure_authority: target-repo',
    'deliverables:',
    '  - src/new.ts',
    '---',
    `# ${taskId}`,
    ''
  ].join('\n'), 'utf8');
  const taskPath = path.join(tempRoot, '.atm/history/tasks', `${taskId}.json`);
  writeJson(taskPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Existing done fixture',
    status: 'done',
    closedAt: '2026-07-10T00:00:00.000Z',
    closedByActor: 'validator',
    closurePacket: '.atm/history/evidence/TASK-IMPORT-077.closure-packet.json',
    source: { planPath: 'docs/tasks/old.task.md', hash: 'old-hash' },
    importedAt: '2026-07-09T00:00:00.000Z'
  });

  const result = await runTasksImport(['--cwd', tempRoot, '--from', planPath, '--write', '--reconcile-mirror', '--json']);
  assert(result.ok === true, 'reconcile-mirror import must succeed for done task');
  const updated = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, any>;
  assert(updated.status === 'done', 'reconcile-mirror must preserve done status');
  assert(updated.closedAt === '2026-07-10T00:00:00.000Z', 'reconcile-mirror must preserve closedAt');
  assert(updated.closedByActor === 'validator', 'reconcile-mirror must preserve closedByActor');
  assert(updated.closurePacket === '.atm/history/evidence/TASK-IMPORT-077.closure-packet.json', 'reconcile-mirror must preserve closurePacket');
  assert(updated.source.planPath === 'docs/tasks/TASK-IMPORT-077.task.md', 'reconcile-mirror must refresh source planPath');
  assert(updated.planningRepo === 'PlanningRepo', 'reconcile-mirror must refresh planningRepo');
  assert(updated.targetRepo === 'TargetRepo', 'reconcile-mirror must refresh targetRepo');
  const eventDir = path.join(tempRoot, '.atm/history/task-events', taskId);
  assert(existsSync(eventDir), 'reconcile-mirror must write a transition event');
  const eventText = readFileSync(path.join(eventDir, readdirFirstJson(eventDir)), 'utf8');
  assert(eventText.includes('planning-mirror-reconcile'), 'transition event must identify mirror-only reconcile action');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function readdirFirstJson(directory: string): string {
  return readdirSync(directory).find((entry) => entry.endsWith('.json')) ?? fail('expected transition event json');
}

// TASK-AAO-FABLE-008 — frontmatter nested object-list values must strip quotes.
{
  const { extractFrontMatter } = await import('../task-import-validators.ts');
  const front = extractFrontMatter([
    '---',
    'title: "Quoted title"',
    'atomizationImpact:',
    '  ownerAtomOrMap: atm.example',
    '  extractionCandidates:',
    '    - atom: "atm.quoted-atom"',
    '      pattern: "Policy Object"',
    '      disposition: extract',
    '---',
    '',
    '# body'
  ].join('\n'));
  assert(front !== null, 'frontmatter must parse');
  const candidates = (front!.data.atomizationImpact as Record<string, unknown>).extractionCandidates as Record<string, unknown>[];
  assert(candidates.length === 1, 'nested object-list must produce exactly one item');
  assert(candidates[0].atom === 'atm.quoted-atom', `quoted nested scalar must strip quotes, got: ${JSON.stringify(candidates[0].atom)}`);
  assert(candidates[0].pattern === 'Policy Object', `quoted nested field must strip quotes, got: ${JSON.stringify(candidates[0].pattern)}`);
  assert(candidates[0].disposition === 'extract', 'unquoted nested field must be unaffected');
}

// TASK-AAO-FABLE-007 — extraction-first import patrol (pure policy regression).
{
  const { buildExtractionFirstPatrolDiagnostics, EXTRACTION_FIRST_LINE_BUDGET } = await import('../task-import-validators.ts');
  const lineCounts: Record<string, number> = {
    'packages/cli/src/commands/big-module.ts': EXTRACTION_FIRST_LINE_BUDGET + 1,
    'packages/cli/src/commands/small-module.ts': 42
  };
  const resolveLineCount = (relativePath: string) => lineCounts[relativePath] ?? null;
  const flagged = buildExtractionFirstPatrolDiagnostics({
    scopePaths: ['packages/cli/src/commands/big-module.ts', 'packages/cli/src/commands/small-module.ts', 'docs/**'],
    hasExtractionCandidates: false,
    resolveLineCount
  });
  assert(flagged.length === 1, 'oversized scope without extraction candidates must emit exactly one advisory');
  assert(flagged[0].code === 'ATM_TASK_IMPORT_EXTRACTION_FIRST_CANDIDATE', 'patrol must use the dedicated diagnostic code');
  assert(flagged[0].severity === 'warning', 'extraction-first patrol must stay advisory, never blocking');
  assert((flagged[0].candidates ?? []).some((entry) => entry.includes('big-module.ts')), 'advisory must name the oversized module');
  assert(!(flagged[0].candidates ?? []).some((entry) => entry.includes('small-module.ts')), 'modules within budget must not be flagged');
  const declared = buildExtractionFirstPatrolDiagnostics({
    scopePaths: ['packages/cli/src/commands/big-module.ts'],
    hasExtractionCandidates: true,
    resolveLineCount
  });
  assert(declared.length === 0, 'declared extractionCandidates (any disposition) must silence the patrol');
  const smallOnly = buildExtractionFirstPatrolDiagnostics({
    scopePaths: ['packages/cli/src/commands/small-module.ts'],
    hasExtractionCandidates: false,
    resolveLineCount
  });
  assert(smallOnly.length === 0, 'small-module scope must not trigger the patrol');
}

console.log('[import-orchestrator.spec] ok (7 branches + reconcile-mirror + extraction-first patrol)');
