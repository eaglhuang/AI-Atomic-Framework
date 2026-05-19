import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, relativePathFrom } from './shared.ts';

export interface TaskImportSource {
  readonly planPath: string;
  readonly sectionTitle: string;
  readonly headingLine: number;
  readonly hash: string;
}

export interface TaskImportRecord {
  readonly schemaVersion: 'atm.workItem.v0.2';
  readonly workItemId: string;
  readonly title: string;
  readonly status: TaskImportStatus;
  readonly milestone?: string | null;
  readonly dependencies: readonly string[];
  readonly acceptance: readonly string[];
  readonly deliverables: readonly string[];
  readonly tags: readonly string[];
  readonly notes?: string | null;
  readonly source: TaskImportSource;
  readonly importedAt: string;
}

export type TaskImportStatus = 'planned' | 'open' | 'in_progress' | 'blocked' | 'done';

export interface TaskImportManifest {
  readonly schemaId: 'atm.taskImportManifest';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly planPath: string;
  readonly mode: 'dry-run' | 'write';
  readonly tasks: readonly TaskImportRecord[];
  readonly diagnostics: readonly TaskImportDiagnostic[];
  readonly writtenPaths: readonly string[];
  readonly evidencePath: string | null;
}

export interface TaskImportDiagnostic {
  readonly level: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly text: string;
  readonly workItemId?: string;
  readonly sourceLine?: number;
}

export interface TaskVerifyReport {
  readonly schemaId: 'atm.taskVerifyReport';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly taskStorePath: string;
  readonly inspectedTasks: number;
  readonly findings: readonly TaskImportDiagnostic[];
  readonly ok: boolean;
}

const validStatuses = new Set<TaskImportStatus>(['planned', 'open', 'in_progress', 'blocked', 'done']);
const acceptanceHeaders = ['acceptance criteria', 'acceptance', 'acceptance tests', 'criteria'];
const deliverablesHeaders = ['deliverables', 'outputs', 'outcomes'];
const dependenciesHeaders = ['dependencies', 'depends on', 'blocked by'];
const notesHeaders = ['notes', 'implementation notes', 'background'];
const tagsHeaders = ['tags', 'labels'];
const taskIdPattern = /^(?:TASK-)?[A-Z][A-Z0-9-]*-\d{2,}/;
const taskIdAnywherePattern = /(?:TASK-)?[A-Z][A-Z0-9-]*-\d{2,}/;

export async function runTasks(argv: string[]) {
  const action = (argv[0] ?? '').toLowerCase();
  if (action === 'import') {
    return await runTasksImport(argv.slice(1));
  }
  if (action === 'verify') {
    return await runTasksVerify(argv.slice(1));
  }
  if (!action) {
    throw new CliError('ATM_CLI_USAGE', 'tasks requires an action (import | verify).', { exitCode: 2 });
  }
  throw new CliError('ATM_CLI_USAGE', `tasks does not support action ${action}.`, { exitCode: 2 });
}

async function runTasksImport(argv: string[]) {
  const options = parseImportOptions(argv);
  if (!options.from) {
    throw new CliError('ATM_CLI_USAGE', 'tasks import requires --from <plan.md>.', { exitCode: 2 });
  }
  if (options.dryRun === options.write) {
    throw new CliError('ATM_CLI_USAGE', 'tasks import requires exactly one of --dry-run or --write.', { exitCode: 2 });
  }

  const planAbsolute = path.resolve(options.cwd, options.from);
  if (!existsSync(planAbsolute) || !statSync(planAbsolute).isFile()) {
    throw new CliError('ATM_TASKS_PLAN_NOT_FOUND', `Plan markdown file not found: ${options.from}`, {
      exitCode: 2,
      details: { planPath: options.from }
    });
  }

  const planText = readFileSync(planAbsolute, 'utf8');
  const generatedAt = new Date().toISOString();
  const parsed = parsePlanMarkdown({
    planText,
    planRelativePath: relativePathFrom(options.cwd, planAbsolute),
    importedAt: generatedAt
  });

  if (parsed.diagnostics.some((entry) => entry.level === 'error') || parsed.tasks.length === 0) {
    if (parsed.tasks.length === 0) {
      parsed.diagnostics.push({
        level: 'error',
        code: 'ATM_TASKS_PLAN_EMPTY',
        text: 'No task cards were detected in the plan markdown. Each task must be introduced by a TASK-... heading or YAML front matter.'
      });
    }
    throw new CliError('ATM_TASKS_PLAN_PARSE_FAILED', 'Task plan import failed before writing any tasks.', {
      exitCode: 1,
      details: {
        diagnostics: parsed.diagnostics,
        planPath: relativePathFrom(options.cwd, planAbsolute)
      }
    });
  }

  const writtenPaths: string[] = [];
  let evidencePath: string | null = null;

  if (options.write) {
    const result = writeTaskFiles({
      cwd: options.cwd,
      tasks: parsed.tasks,
      force: options.force
    });
    writtenPaths.push(...result.writtenPaths);
    parsed.diagnostics.push(...result.diagnostics);
    if (result.diagnostics.some((entry) => entry.level === 'error')) {
      throw new CliError('ATM_TASKS_IMPORT_WRITE_FAILED', 'Task plan import refused to write because of conflicts.', {
        exitCode: 1,
        details: {
          diagnostics: result.diagnostics,
          writtenPaths: result.writtenPaths
        }
      });
    }
    evidencePath = writeImportEvidence({
      cwd: options.cwd,
      tasks: parsed.tasks,
      planPath: relativePathFrom(options.cwd, planAbsolute),
      generatedAt,
      writtenPaths
    });
  }

  const manifest: TaskImportManifest = {
    schemaId: 'atm.taskImportManifest',
    specVersion: '0.1.0',
    generatedAt,
    planPath: relativePathFrom(options.cwd, planAbsolute),
    mode: options.dryRun ? 'dry-run' : 'write',
    tasks: parsed.tasks,
    diagnostics: parsed.diagnostics,
    writtenPaths,
    evidencePath
  };

  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message(
        'info',
        options.dryRun ? 'ATM_TASKS_IMPORT_DRY_RUN' : 'ATM_TASKS_IMPORT_WRITE_READY',
        options.dryRun
          ? `Parsed ${parsed.tasks.length} task(s) from plan; no files were written.`
          : `Wrote ${writtenPaths.length} task file(s) and import evidence.`,
        { tasks: parsed.tasks.length, mode: manifest.mode }
      )
    ],
    evidence: {
      manifest,
      planPath: manifest.planPath,
      writtenPaths,
      evidencePath
    }
  });
}

async function runTasksVerify(argv: string[]) {
  const options = parseVerifyOptions(argv);
  const taskStoreAbsolute = path.resolve(options.cwd, '.atm', 'history', 'tasks');
  const generatedAt = new Date().toISOString();
  if (!existsSync(taskStoreAbsolute)) {
    const report: TaskVerifyReport = {
      schemaId: 'atm.taskVerifyReport',
      specVersion: '0.1.0',
      generatedAt,
      taskStorePath: relativePathFrom(options.cwd, taskStoreAbsolute),
      inspectedTasks: 0,
      findings: [
        {
          level: 'warning',
          code: 'ATM_TASKS_VERIFY_STORE_MISSING',
          text: '.atm/history/tasks does not exist; nothing to verify.'
        }
      ],
      ok: true
    };
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('warn', 'ATM_TASKS_VERIFY_STORE_MISSING', 'Task store directory is missing.')],
      evidence: { report }
    });
  }

  const entries = readdirSync(taskStoreAbsolute)
    .filter((entry) => entry.endsWith('.json'))
    .sort();
  const findings: TaskImportDiagnostic[] = [];
  const seen = new Map<string, string>();
  let inspectedTasks = 0;

  for (const entry of entries) {
    const filePath = path.join(taskStoreAbsolute, entry);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_INVALID_JSON',
        text: `Task file is not valid JSON: ${entry} (${error instanceof Error ? error.message : String(error)})`
      });
      continue;
    }
    inspectedTasks += 1;
    const workItemId = typeof parsed?.workItemId === 'string'
      ? parsed.workItemId
      : typeof parsed?.id === 'string'
        ? parsed.id
        : '';
    if (!workItemId) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_MISSING_ID',
        text: `Task file ${entry} is missing workItemId.`
      });
      continue;
    }
    if (seen.has(workItemId)) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_DUPLICATE_ID',
        text: `Duplicate workItemId ${workItemId}: appears in ${seen.get(workItemId)} and ${entry}.`,
        workItemId
      });
    } else {
      seen.set(workItemId, entry);
    }
    const status = parsed.status;
    if (typeof status !== 'string' || !validStatuses.has(status as TaskImportStatus)) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_INVALID_STATUS',
        text: `Task ${workItemId} has invalid status ${String(status)}. Expected one of ${[...validStatuses].join(', ')}.`,
        workItemId
      });
    }
    if (parsed.source !== undefined) {
      const source = parsed.source as Record<string, unknown> | null;
      if (!source || typeof source.planPath !== 'string' || typeof source.sectionTitle !== 'string' || typeof source.hash !== 'string') {
        findings.push({
          level: 'error',
          code: 'ATM_TASKS_VERIFY_BAD_SOURCE_TRACE',
          text: `Task ${workItemId} declared a malformed source trace (planPath, sectionTitle, and hash are required).`,
          workItemId
        });
      }
    }
    const dependencies = Array.isArray(parsed.dependencies) ? (parsed.dependencies as unknown[]) : [];
    for (const dependency of dependencies) {
      if (typeof dependency !== 'string') {
        findings.push({
          level: 'error',
          code: 'ATM_TASKS_VERIFY_DEPENDENCY_TYPE',
          text: `Task ${workItemId} has a non-string dependency entry: ${JSON.stringify(dependency)}.`,
          workItemId
        });
      }
    }
  }

  for (const [workItemId, fileName] of seen.entries()) {
    const filePath = path.join(taskStoreAbsolute, fileName);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const dependencies = Array.isArray(parsed.dependencies) ? (parsed.dependencies as string[]) : [];
    for (const dependency of dependencies) {
      if (typeof dependency !== 'string' || !dependency) continue;
      if (!seen.has(dependency)) {
        findings.push({
          level: 'warning',
          code: 'ATM_TASKS_VERIFY_DEPENDENCY_MISSING',
          text: `Task ${workItemId} depends on ${dependency} but no matching task file is present.`,
          workItemId
        });
      }
    }
  }

  const ok = findings.every((entry) => entry.level !== 'error');
  const report: TaskVerifyReport = {
    schemaId: 'atm.taskVerifyReport',
    specVersion: '0.1.0',
    generatedAt,
    taskStorePath: relativePathFrom(options.cwd, taskStoreAbsolute),
    inspectedTasks,
    findings,
    ok
  };

  return makeResult({
    ok,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message(
        ok ? 'info' : 'error',
        ok ? 'ATM_TASKS_VERIFY_OK' : 'ATM_TASKS_VERIFY_FAILED',
        ok
          ? `Verified ${inspectedTasks} task file(s) with ${findings.length} advisory finding(s).`
          : `Verification failed with ${findings.filter((entry) => entry.level === 'error').length} error(s).`,
        { inspectedTasks }
      )
    ],
    evidence: { report }
  });
}

function parseImportOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    from: '',
    dryRun: false,
    write: false,
    force: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--from') {
      options.from = requireValue(argv, index, '--from');
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--write') {
      options.write = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks import does not support option ${arg}`, { exitCode: 2 });
  }
  return { ...options, cwd: path.resolve(options.cwd) };
}

function parseVerifyOptions(argv: string[]) {
  const options = {
    cwd: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    throw new CliError('ATM_CLI_USAGE', `tasks verify does not support option ${arg}`, { exitCode: 2 });
  }
  return { ...options, cwd: path.resolve(options.cwd) };
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `tasks requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}

export interface ParsedPlanResult {
  readonly tasks: readonly TaskImportRecord[];
  readonly diagnostics: TaskImportDiagnostic[];
}

export function parsePlanMarkdown(input: {
  readonly planText: string;
  readonly planRelativePath: string;
  readonly importedAt: string;
}): ParsedPlanResult {
  const { planText, planRelativePath, importedAt } = input;
  const lines = planText.split(/\r?\n/);
  const tasks: TaskImportRecord[] = [];
  const diagnostics: TaskImportDiagnostic[] = [];
  const seenIds = new Set<string>();
  const tableMetadata = parseTaskTableMetadata(lines);

  const singleCard = parseSingleCard({ planText, planRelativePath, importedAt });
  if (singleCard) {
    if (seenIds.has(singleCard.workItemId)) {
      diagnostics.push({
        level: 'error',
        code: 'ATM_TASKS_DUPLICATE_ID',
        text: `Duplicate task id ${singleCard.workItemId} in plan.`,
        workItemId: singleCard.workItemId
      });
    } else {
      tasks.push(singleCard);
      seenIds.add(singleCard.workItemId);
    }
    return { tasks, diagnostics };
  }

  const sections = splitPlanIntoTaskSections(lines);
  for (const section of sections) {
    const record = parseTaskSection({
      section,
      planRelativePath,
      importedAt,
      tableMetadata: tableMetadata.get(section.workItemId) ?? null
    });
    if (!record) continue;
    if (seenIds.has(record.task.workItemId)) {
      diagnostics.push({
        level: 'error',
        code: 'ATM_TASKS_DUPLICATE_ID',
        text: `Duplicate task id ${record.task.workItemId} at line ${section.headingLine}.`,
        workItemId: record.task.workItemId,
        sourceLine: section.headingLine
      });
      continue;
    }
    seenIds.add(record.task.workItemId);
    tasks.push(record.task);
    diagnostics.push(...record.diagnostics);
  }
  for (const [workItemId, metadata] of tableMetadata.entries()) {
    if (seenIds.has(workItemId)) continue;
    seenIds.add(workItemId);
    tasks.push(createTaskFromTableMetadata({
      metadata,
      planRelativePath,
      importedAt
    }));
  }
  return { tasks, diagnostics };
}

interface ParsedTaskSection {
  readonly headingLine: number;
  readonly title: string;
  readonly workItemId: string;
  readonly bodyLines: readonly string[];
}

interface TaskTableMetadata {
  readonly workItemId: string;
  readonly title: string;
  readonly milestone: string | null;
  readonly dependencies: readonly string[];
  readonly deliverables: readonly string[];
  readonly headingLine: number;
  readonly rowText: string;
}

function parseTaskTableMetadata(lines: readonly string[]): Map<string, TaskTableMetadata> {
  const entries = new Map<string, TaskTableMetadata>();
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || /^[-|\s:]+$/.test(trimmed.replace(/\|/g, ''))) {
      continue;
    }
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cleanCellText(cell));
    if (cells.length < 3) continue;
    const idMatch = taskIdPattern.exec(cells[0]);
    if (!idMatch) continue;
    const workItemId = normalizeTaskId(idMatch[0]);
    entries.set(workItemId, {
      workItemId,
      milestone: cells[1] || null,
      title: cells[2] || workItemId,
      dependencies: parseDependencyList(cells[3] ?? '', workItemId),
      deliverables: cells[4] ? [cells[4]] : [],
      headingLine: index + 1,
      rowText: rawLine
    });
  }
  return entries;
}

function splitPlanIntoTaskSections(lines: readonly string[]): readonly ParsedTaskSection[] {
  const sections: ParsedTaskSection[] = [];
  let current: { headingLine: number; title: string; workItemId: string; bodyLines: string[] } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const candidate = headingMatch[1];
      const idMatch = taskIdPattern.exec(candidate);
      if (idMatch) {
        if (current) sections.push(current);
        const workItemId = normalizeTaskId(idMatch[0]);
        current = {
          headingLine: index + 1,
          title: candidate.replace(taskIdPattern, '').replace(/^[\s:：.\-—–]+/u, '').trim() || workItemId,
          workItemId,
          bodyLines: []
        };
        continue;
      }
    }
    if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function parseSingleCard(input: {
  readonly planText: string;
  readonly planRelativePath: string;
  readonly importedAt: string;
}): TaskImportRecord | null {
  const frontMatter = extractFrontMatter(input.planText);
  if (!frontMatter || typeof frontMatter.data.task_id !== 'string') return null;
  const workItemId = normalizeTaskId(frontMatter.data.task_id);
  const title = typeof frontMatter.data.title === 'string' && frontMatter.data.title.trim()
    ? frontMatter.data.title.trim()
    : workItemId;
  const status = coerceStatus(typeof frontMatter.data.status === 'string' ? frontMatter.data.status : 'planned');
  const milestone = typeof frontMatter.data.milestone === 'string' ? frontMatter.data.milestone : null;
  const dependencies = parseYamlList(frontMatter.data.blocked_by ?? frontMatter.data.dependencies);
  const tags = parseYamlList(frontMatter.data.tags);
  const body = input.planText.slice(frontMatter.endIndex);
  const sections = sliceBodyByHeadings(body);
  const acceptance = collectBulletList(sections, acceptanceHeaders);
  const deliverables = collectBulletList(sections, deliverablesHeaders);
  const notes = collectText(sections, notesHeaders) ?? null;

  return {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId,
    title,
    status,
    milestone,
    dependencies,
    acceptance,
    deliverables,
    tags,
    notes,
    source: {
      planPath: input.planRelativePath,
      sectionTitle: workItemId,
      headingLine: frontMatter.headingLine,
      hash: hashSection(input.planText)
    },
    importedAt: input.importedAt
  };
}

function parseTaskSection(input: {
  readonly section: ParsedTaskSection;
  readonly planRelativePath: string;
  readonly importedAt: string;
  readonly tableMetadata: TaskTableMetadata | null;
}): { task: TaskImportRecord; diagnostics: TaskImportDiagnostic[] } | null {
  const { section } = input;
  const diagnostics: TaskImportDiagnostic[] = [];
  const sectionText = section.bodyLines.join('\n');
  const sectionsByHeading = sliceBodyByHeadings(sectionText);
  const acceptance = [
    ...collectBulletList(sectionsByHeading, acceptanceHeaders),
    ...collectLabeledText(section.bodyLines, ['acceptance criteria', 'acceptance', '驗收'])
  ];
  const deliverables = uniqueStrings([
    ...collectBulletList(sectionsByHeading, deliverablesHeaders),
    ...collectLabeledText(section.bodyLines, ['deliverables', 'outputs', 'outcomes', 'evidence', 'validation', '輸出', '驗證']),
    ...(input.tableMetadata?.deliverables ?? [])
  ]);
  const sectionDependencies = collectBulletList(sectionsByHeading, dependenciesHeaders)
    .flatMap((entry) => parseDependencyList(entry, section.workItemId));
  const dependencies = uniqueStrings(sectionDependencies.length > 0 ? sectionDependencies : input.tableMetadata?.dependencies ?? []);
  const tags = collectBulletList(sectionsByHeading, tagsHeaders);
  const notes = collectText(sectionsByHeading, notesHeaders) ?? null;
  const statusRaw = collectKeyValue(sectionsByHeading, 'status')
    ?? collectKeyValue(sectionsByHeading, 'state')
    ?? collectKeyValueFromLines(section.bodyLines, 'status')
    ?? collectKeyValueFromLines(section.bodyLines, 'state')
    ?? 'planned';
  const milestone = collectKeyValue(sectionsByHeading, 'milestone')
    ?? collectKeyValueFromLines(section.bodyLines, 'milestone')
    ?? input.tableMetadata?.milestone
    ?? null;
  const status = coerceStatus(statusRaw);
  const hash = hashSection(`${section.workItemId}\n${sectionText}`);

  if (!validStatuses.has(status)) {
    diagnostics.push({
      level: 'warning',
      code: 'ATM_TASKS_STATUS_UNKNOWN',
      text: `Task ${section.workItemId} declared unknown status ${statusRaw}; defaulted to planned.`,
      workItemId: section.workItemId,
      sourceLine: section.headingLine
    });
  }

  const task: TaskImportRecord = {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: section.workItemId,
    title: section.title || input.tableMetadata?.title || section.workItemId,
    status,
    milestone: milestone ?? null,
    dependencies,
    acceptance,
    deliverables,
    tags,
    notes,
    source: {
      planPath: input.planRelativePath,
      sectionTitle: section.title || section.workItemId,
      headingLine: section.headingLine,
      hash
    },
    importedAt: input.importedAt
  };
  return { task, diagnostics };
}

function createTaskFromTableMetadata(input: {
  readonly metadata: TaskTableMetadata;
  readonly planRelativePath: string;
  readonly importedAt: string;
}): TaskImportRecord {
  return {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: input.metadata.workItemId,
    title: input.metadata.title,
    status: 'planned',
    milestone: input.metadata.milestone,
    dependencies: input.metadata.dependencies,
    acceptance: [],
    deliverables: input.metadata.deliverables,
    tags: [],
    notes: null,
    source: {
      planPath: input.planRelativePath,
      sectionTitle: input.metadata.title,
      headingLine: input.metadata.headingLine,
      hash: hashSection(input.metadata.rowText)
    },
    importedAt: input.importedAt
  };
}

function writeTaskFiles(input: {
  readonly cwd: string;
  readonly tasks: readonly TaskImportRecord[];
  readonly force: boolean;
}): { writtenPaths: string[]; diagnostics: TaskImportDiagnostic[] } {
  const writtenPaths: string[] = [];
  const diagnostics: TaskImportDiagnostic[] = [];
  const taskStoreDirectory = path.join(input.cwd, '.atm', 'history', 'tasks');
  mkdirSync(taskStoreDirectory, { recursive: true });
  for (const task of input.tasks) {
    const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
    if (existsSync(filePath) && !input.force) {
      try {
        const current = JSON.parse(readFileSync(filePath, 'utf8')) as { hash?: string; source?: { hash?: string } };
        const currentHash = current.source?.hash ?? current.hash ?? '';
        if (currentHash === task.source.hash) {
          diagnostics.push({
            level: 'info',
            code: 'ATM_TASKS_IMPORT_UNCHANGED',
            text: `Task ${task.workItemId} is unchanged; left existing file in place.`,
            workItemId: task.workItemId
          });
          continue;
        }
        diagnostics.push({
          level: 'error',
          code: 'ATM_TASKS_IMPORT_DRIFT',
          text: `Task ${task.workItemId} exists with a different hash; rerun with --force to overwrite.`,
          workItemId: task.workItemId
        });
        continue;
      } catch {
        diagnostics.push({
          level: 'error',
          code: 'ATM_TASKS_IMPORT_UNREADABLE_EXISTING',
          text: `Task ${task.workItemId} file exists but is unreadable; rerun with --force to overwrite.`,
          workItemId: task.workItemId
        });
        continue;
      }
    }
  }
  if (diagnostics.some((entry) => entry.level === 'error')) {
    return { writtenPaths, diagnostics };
  }
  for (const task of input.tasks) {
    const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
    if (existsSync(filePath) && !input.force) {
      continue;
    }
    writeFileSync(filePath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
    writtenPaths.push(relativePathFrom(input.cwd, filePath));
  }
  return { writtenPaths, diagnostics };
}

function writeImportEvidence(input: {
  readonly cwd: string;
  readonly tasks: readonly TaskImportRecord[];
  readonly planPath: string;
  readonly generatedAt: string;
  readonly writtenPaths: readonly string[];
}): string {
  const evidenceDirectory = path.join(input.cwd, '.atm', 'history', 'reports', 'task-import');
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidenceFile = `${input.generatedAt.replace(/[:.]/g, '-')}.json`;
  const evidencePath = path.join(evidenceDirectory, evidenceFile);
  const payload = {
    schemaId: 'atm.taskImportEvidence',
    specVersion: '0.1.0',
    generatedAt: input.generatedAt,
    planPath: input.planPath,
    taskCount: input.tasks.length,
    writtenPaths: input.writtenPaths,
    taskIds: input.tasks.map((task) => task.workItemId),
    sourceTraces: input.tasks.map((task) => ({
      workItemId: task.workItemId,
      planPath: task.source.planPath,
      sectionTitle: task.source.sectionTitle,
      headingLine: task.source.headingLine,
      hash: task.source.hash
    }))
  };
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return relativePathFrom(input.cwd, evidencePath);
}

interface FrontMatter {
  readonly data: Record<string, string | readonly string[]>;
  readonly endIndex: number;
  readonly headingLine: number;
}

function extractFrontMatter(text: string): FrontMatter | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const block = match[1];
  const data: Record<string, string | readonly string[]> = {};
  let currentKey: string | null = null;
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
      const colonIndex = line.indexOf(':');
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      currentKey = key;
      data[key] = value;
      continue;
    }
    if (currentKey && /^\s*-\s+/.test(line)) {
      const value = line.replace(/^\s*-\s+/, '').trim();
      const existing = data[currentKey];
      if (Array.isArray(existing)) {
        data[currentKey] = [...(existing as readonly string[]), value];
      } else if (typeof existing === 'string' && existing.length === 0) {
        data[currentKey] = [value];
      } else if (typeof existing === 'string') {
        data[currentKey] = [existing, value];
      } else {
        data[currentKey] = [value];
      }
    }
  }
  const endIndex = match.index! + match[0].length;
  const headingLineMatch = /\n#\s+(.+)/.exec(text.slice(endIndex));
  const headingLine = headingLineMatch
    ? text.slice(0, endIndex + headingLineMatch.index! + 1).split(/\r?\n/).length
    : text.slice(0, endIndex).split(/\r?\n/).length;
  return { data, endIndex, headingLine };
}

function parseYamlList(value: unknown): readonly string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return [trimmed];
}

interface HeadingSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

function sliceBodyByHeadings(text: string): readonly HeadingSection[] {
  const lines = text.split(/\r?\n/);
  const sections: HeadingSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    const headingMatch = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].toLowerCase().trim(), lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function collectBulletList(sections: readonly HeadingSection[], headingNames: readonly string[]): readonly string[] {
  const target = sections.find((section) => headingNames.some((name) => section.heading.includes(name)));
  if (!target) return [];
  const items: string[] = [];
  for (const line of target.lines) {
    const match = /^\s*[-*]\s+\[\s*[ xX]\s*\]\s+(.+)|^\s*[-*]\s+(.+)/.exec(line);
    if (match) {
      const value = (match[1] ?? match[2] ?? '').trim();
      if (value) items.push(value);
    }
  }
  return items;
}

function collectText(sections: readonly HeadingSection[], headingNames: readonly string[]): string | null {
  const target = sections.find((section) => headingNames.some((name) => section.heading.includes(name)));
  if (!target) return null;
  const text = target.lines.join('\n').trim();
  return text || null;
}

function collectKeyValue(sections: readonly HeadingSection[], key: string): string | null {
  const keyLower = key.toLowerCase();
  for (const section of sections) {
    for (const line of section.lines) {
      const match = /^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.+?)\s*$/.exec(line);
      if (match && match[1].toLowerCase() === keyLower) {
        return match[2];
      }
    }
  }
  return null;
}

function collectKeyValueFromLines(lines: readonly string[], key: string): string | null {
  const keyLower = key.toLowerCase();
  for (const line of lines) {
    const match = /^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.+?)\s*$/.exec(line);
    if (match && match[1].toLowerCase() === keyLower) {
      return match[2].trim();
    }
  }
  return null;
}

function extractTaskReference(value: string): string | null {
  const match = taskIdAnywherePattern.exec(value);
  return match ? normalizeTaskId(match[0]) : null;
}

function parseDependencyList(value: string, baseWorkItemId: string): readonly string[] {
  const trimmed = cleanCellText(value);
  if (!trimmed || /^(none|n\/a|na|null|無|--|-|\?)$/i.test(trimmed)) return [];
  const prefix = baseWorkItemId.replace(/-\d+$/, '');
  const values = trimmed
    .split(/[,/、，\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const fullMatch = taskIdAnywherePattern.exec(entry);
      if (fullMatch) return [normalizeTaskId(fullMatch[0])];
      if (/^\d{2,}$/.test(entry) && prefix !== baseWorkItemId) return [`${prefix}-${entry}`];
      return [];
    });
  return uniqueStrings(values);
}

function collectLabeledText(lines: readonly string[], labels: readonly string[]): readonly string[] {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const values: string[] = [];
  for (const line of lines) {
    const match = /^\s*\*\*(.+?)\*\*\s*[：:]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    if (!normalizedLabels.some((candidate) => label.includes(candidate))) continue;
    const value = match[2].trim();
    if (value) values.push(value);
  }
  return values;
}

function cleanCellText(value: string): string {
  return value
    .replace(/`/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .trim();
}

function coerceStatus(value: string): TaskImportStatus {
  const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (normalized === 'todo' || normalized === 'planned') return 'planned';
  if (normalized === 'open' || normalized === 'pending') return 'open';
  if (normalized === 'in_progress' || normalized === 'wip' || normalized === 'doing') return 'in_progress';
  if (normalized === 'blocked' || normalized === 'waiting') return 'blocked';
  if (normalized === 'done' || normalized === 'completed' || normalized === 'closed') return 'done';
  if (validStatuses.has(normalized as TaskImportStatus)) return normalized as TaskImportStatus;
  return 'planned';
}

function normalizeTaskId(raw: string): string {
  return raw.trim().replace(/`/g, '').toUpperCase();
}

function hashSection(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
