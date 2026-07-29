import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildTaskViewDashboard, type TaskViewDashboard } from '../task-view.ts';
import { CliError, makeResult, message, type CommandResult } from '../shared.ts';
import { setFieldsProjection, setSummaryProjection } from '../shared/result-core.ts';

export const TASK_READ_PROJECTION_SCHEMA_ID = 'atm.taskReadProjection.v1';

/**
 * Every projected field is a pure read of the TASK-MAO-0044 dashboard summary.
 * No entry may re-derive lifecycle or status state; add a reader here instead of
 * branching in callers.
 */
const FIELD_REGISTRY: Readonly<Record<string, (dashboard: TaskViewDashboard) => unknown>> = {
  taskId: (dashboard) => dashboard.taskId,
  status: (dashboard) => dashboard.liveStatus,
  claimState: (dashboard) => dashboard.claimState,
  owner: (dashboard) => dashboard.lastEvent.actorId,
  lastTransitionAt: (dashboard) => dashboard.lastEvent.createdAt,
  residueBucket: (dashboard) => dashboard.residueBucket,
  nextActionCode: (dashboard) => deriveNextActionCode(dashboard.nextSafeCommand),
  planningStatus: (dashboard) => dashboard.planningStatus,
  partialClose: (dashboard) => dashboard.partialClose
};

export const REGISTERED_PROJECTION_FIELDS: readonly string[] = Object.freeze(Object.keys(FIELD_REGISTRY));

const DEFAULT_SUMMARY_FIELDS: readonly string[] = Object.freeze([
  'taskId',
  'status',
  'claimState',
  'owner',
  'lastTransitionAt',
  'residueBucket',
  'nextActionCode'
]);

const PROJECTION_FLAGS: readonly string[] = Object.freeze(['--summary', '--fields', '--tasks', '--series', '--all']);

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SERIES_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Reduce a dashboard next-safe command to a stable slug without hard-coding the
 * command catalogue: drop the runner prefix, then keep tokens up to the first flag.
 */
function deriveNextActionCode(nextSafeCommand: string | null): string | null {
  if (!nextSafeCommand) return null;
  const tokens = nextSafeCommand.trim().split(/\s+/);
  const start = tokens[0] === 'node' && tokens[1]?.endsWith('.mjs') ? 2 : 0;
  const verbs: string[] = [];
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith('-')) break;
    verbs.push(token);
  }
  return verbs.length > 0 ? verbs.join('-') : null;
}

export interface TaskReadProjectionOptions {
  readonly cwd: string;
  readonly selector: { readonly kind: 'tasks'; readonly taskIds: readonly string[] }
    | { readonly kind: 'series'; readonly series: string }
    | { readonly kind: 'all' };
  readonly fields: readonly string[];
}

/** True when the argv asks for the read projection rather than the findings audit. */
export function hasTaskReadProjectionRequest(argv: readonly string[]): boolean {
  return argv.some((arg) => PROJECTION_FLAGS.includes(arg));
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new CliError('ATM_CLI_USAGE', `${flag} requires a value.`, { exitCode: 2 });
  }
  return value;
}

function splitList(raw: string, flag: string): string[] {
  const entries = raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new CliError('ATM_CLI_USAGE', `${flag} requires at least one entry.`, { exitCode: 2 });
  }
  return entries;
}

export function parseTaskReadProjectionOptions(argv: readonly string[]): TaskReadProjectionOptions {
  let cwd = process.cwd();
  let taskIds: string[] | null = null;
  let series: string | null = null;
  let all = false;
  let summary = false;
  let fields: string[] | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    if (arg === '--summary') { summary = true; continue; }
    if (arg === '--all') { all = true; continue; }
    if (arg === '--tasks') {
      taskIds = splitList(requireValue(argv, index, arg), '--tasks');
      index += 1;
      continue;
    }
    if (arg === '--series') {
      series = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--fields') {
      fields = splitList(requireValue(argv, index, arg), '--fields');
      index += 1;
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks audit does not support option ${arg}`, { exitCode: 2 });
  }

  const selectorCount = (taskIds ? 1 : 0) + (series ? 1 : 0) + (all ? 1 : 0);
  if (selectorCount !== 1) {
    throw new CliError(
      'ATM_CLI_USAGE',
      'tasks audit projection requires exactly one of --tasks <id,...>, --series <PREFIX>, or --all.',
      { exitCode: 2 }
    );
  }
  if (!summary && !fields) {
    throw new CliError(
      'ATM_CLI_USAGE',
      'tasks audit projection requires --summary or --fields <name,...>.',
      { exitCode: 2 }
    );
  }

  const resolvedFields = fields ?? [...DEFAULT_SUMMARY_FIELDS];
  const unknownFields = resolvedFields.filter((field) => !(field in FIELD_REGISTRY));
  if (unknownFields.length > 0) {
    throw new CliError(
      'ATM_CLI_USAGE',
      `tasks audit projection does not support field(s) ${unknownFields.join(', ')}. Registered fields: ${REGISTERED_PROJECTION_FIELDS.join(', ')}.`,
      { exitCode: 2 }
    );
  }

  if (taskIds) {
    const invalid = taskIds.filter((entry) => !TASK_ID_PATTERN.test(entry));
    if (invalid.length > 0) {
      throw new CliError(
        'ATM_CLI_USAGE',
        `--tasks accepts task ids only; rejected ${invalid.join(', ')}.`,
        { exitCode: 2 }
      );
    }
  }
  if (series && !SERIES_PATTERN.test(series)) {
    throw new CliError('ATM_CLI_USAGE', `--series accepts a task-id prefix only; rejected ${series}.`, { exitCode: 2 });
  }

  const selector: TaskReadProjectionOptions['selector'] = taskIds
    ? { kind: 'tasks', taskIds }
    : series
      ? { kind: 'series', series }
      : { kind: 'all' };

  return { cwd: path.resolve(cwd), selector, fields: resolvedFields };
}

function ledgerDir(cwd: string): string {
  return path.join(cwd, '.atm', 'history', 'tasks');
}

function listLedgerTaskIds(cwd: string): string[] {
  const dir = ledgerDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length));
}

function resolveSelectedTaskIds(options: TaskReadProjectionOptions): string[] {
  if (options.selector.kind === 'tasks') {
    const missing = options.selector.taskIds.filter(
      (taskId) => !existsSync(path.join(ledgerDir(options.cwd), `${taskId}.json`))
    );
    if (missing.length > 0) {
      throw new CliError(
        'ATM_CLI_USAGE',
        `No ledger record for task(s) ${missing.join(', ')}.`,
        { exitCode: 2 }
      );
    }
    return [...options.selector.taskIds];
  }
  const available = listLedgerTaskIds(options.cwd);
  if (options.selector.kind === 'all') return available;
  const prefix = `${options.selector.series}-`;
  return available.filter((taskId) => taskId.startsWith(prefix) || taskId.includes(`-${prefix}`));
}

function sortByTaskId(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function buildTaskReadProjection(options: TaskReadProjectionOptions): {
  readonly schemaId: typeof TASK_READ_PROJECTION_SCHEMA_ID;
  readonly generatedAt: string;
  readonly readOnly: true;
  readonly selector: TaskReadProjectionOptions['selector'];
  readonly fields: readonly string[];
  readonly rowCount: number;
  readonly rows: readonly Record<string, unknown>[];
} {
  const taskIds = resolveSelectedTaskIds(options).slice().sort(sortByTaskId);
  const rows = taskIds.map((taskId) => {
    const row: Record<string, unknown> = {};
    try {
      const dashboard = buildTaskViewDashboard({ cwd: options.cwd, taskId, actorId: null });
      for (const field of options.fields) {
        row[field] = FIELD_REGISTRY[field](dashboard);
      }
    } catch (error) {
      row.taskId = taskId;
      row.error = error instanceof Error ? error.message : String(error);
    }
    return row;
  });

  return {
    schemaId: TASK_READ_PROJECTION_SCHEMA_ID,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    selector: options.selector,
    fields: options.fields,
    rowCount: rows.length,
    rows
  };
}

export function runTasksReadProjection(argv: readonly string[]): CommandResult {
  const options = parseTaskReadProjectionOptions(argv);
  const projection = buildTaskReadProjection(options);
  // On this surface --summary/--fields select row fields, so the CLI-wide envelope
  // projection must not also strip the evidence block it produced.
  setSummaryProjection(false);
  setFieldsProjection(null);
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message(
        'info',
        'ATM_TASKS_READ_PROJECTION_READY',
        `Projected ${projection.rowCount} task row(s) with ${projection.fields.length} field(s).`,
        { rowCount: projection.rowCount, fields: projection.fields }
      )
    ],
    evidence: { projection }
  });
}
