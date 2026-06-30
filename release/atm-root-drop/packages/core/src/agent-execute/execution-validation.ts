import { spawnSync } from 'node:child_process';

interface ValidationPassPlanRecord {
  passId: string;
  fixtureSet: string;
  label: string;
  reportPath: string;
}

interface ValidationResultRecord {
  commandId: string;
  command: string;
  exitCode: number;
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  signal: string | null;
}

interface RawValidationOutcome {
  ok?: boolean;
  exitCode?: number;
  summary?: string;
  reportPath?: string;
  reportDocument?: unknown;
  results?: unknown[];
}

interface ValidationPassContext {
  repositoryRoot: string;
  validationCommands: string[];
  pass: ValidationPassPlanRecord;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeValidationPassOutcome(rawOutcome: RawValidationOutcome | unknown, pass: ValidationPassPlanRecord) {
  const outcome = asRecord(rawOutcome) as RawValidationOutcome | null;
  const ok = outcome?.ok !== false;
  const exitCode = normalizeExitCode(outcome?.exitCode, ok ? 0 : 1);
  const summary = String(outcome?.summary || `${pass.label} validated delegated commands.`);
  const reportPath = toPortablePath(outcome?.reportPath || pass.reportPath);
  const reportDocument = asRecord(outcome?.reportDocument)
    ? outcome?.reportDocument
    : {
      passId: pass.passId,
      fixtureSet: pass.fixtureSet,
      ok,
      exitCode,
      summary,
      results: Array.isArray(outcome?.results) ? outcome.results : []
    };

  return {
    reportPath,
    reportDocument,
    record: {
      passId: pass.passId,
      fixtureSet: pass.fixtureSet,
      ok,
      exitCode,
      reportPath,
      summary
    }
  };
}

export function createValidationPassPlan(lifecycleMode: string, reportsDirPath: string) {
  if (lifecycleMode === 'evolution') {
    return [
      createValidationPass('baseline-fixtures-x-new-code', 'baseline', 'Baseline fixtures validated against the candidate code.', reportsDirPath),
      createValidationPass('new-fixtures-x-new-code', 'candidate', 'New fixtures validated against the candidate code.', reportsDirPath)
    ];
  }
  return [
    createValidationPass('current-fixtures-x-current-code', 'current', 'Current fixtures validated against the candidate code.', reportsDirPath)
  ];
}

export function defaultRunValidationPass(context: ValidationPassContext) {
  const results: ValidationResultRecord[] = context.validationCommands.map((command, index) => {
    const startedAt = Date.now();
    const processResult = spawnSync(command, {
      cwd: context.repositoryRoot,
      shell: true,
      encoding: 'utf8'
    });
    const exitCode = normalizeExitCode(processResult.status, 1);
    return {
      commandId: `validation-${index + 1}`,
      command,
      exitCode,
      ok: exitCode === 0,
      stdout: normalizeText(processResult.stdout),
      stderr: [normalizeText(processResult.stderr), processResult.error?.message || ''].filter(Boolean).join('\n'),
      durationMs: Math.max(0, Date.now() - startedAt),
      signal: processResult.signal || null
    };
  });

  const exitCode = results.find((entry) => entry.exitCode !== 0)?.exitCode ?? 0;
  const ok = results.every((entry) => entry.ok === true);
  return {
    ok,
    exitCode,
    summary: ok
      ? `${context.pass.label}`
      : `${context.pass.label} detected a delegated validation failure.`,
    results
  };
}

function createValidationPass(passId: string, fixtureSet: string, label: string, reportsDirPath: string): ValidationPassPlanRecord {
  return {
    passId,
    fixtureSet,
    label,
    reportPath: `${reportsDirPath}/${passId}.report.json`
  };
}

function normalizeExitCode(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function normalizeText(value: unknown) {
  return String(value || '');
}

function toPortablePath(value: unknown) {
  return String(value || '').replace(/\\/g, '/');
}
