import { spawnSync } from 'node:child_process';

export function normalizeValidationPassOutcome(rawOutcome: any, pass: any) {
  const ok = rawOutcome?.ok !== false;
  const exitCode = normalizeExitCode(rawOutcome?.exitCode, ok ? 0 : 1);
  const summary = String(rawOutcome?.summary || `${pass.label} validated delegated commands.`);
  const reportPath = toPortablePath(rawOutcome?.reportPath || pass.reportPath);
  const reportDocument = rawOutcome?.reportDocument && typeof rawOutcome.reportDocument === 'object'
    ? rawOutcome.reportDocument
    : {
      passId: pass.passId,
      fixtureSet: pass.fixtureSet,
      ok,
      exitCode,
      summary,
      results: Array.isArray(rawOutcome?.results) ? rawOutcome.results : []
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

export function createValidationPassPlan(lifecycleMode: any, reportsDirPath: any) {
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

export function defaultRunValidationPass(context: any) {
  const results = context.validationCommands.map((command: any, index: any) => {
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

  const exitCode = results.find((entry: any) => entry.exitCode !== 0)?.exitCode ?? 0;
  const ok = results.every((entry: any) => entry.ok === true);
  return {
    ok,
    exitCode,
    summary: ok
      ? `${context.pass.label}`
      : `${context.pass.label} detected a delegated validation failure.`,
    results
  };
}

function createValidationPass(passId: any, fixtureSet: any, label: any, reportsDirPath: any) {
  return {
    passId,
    fixtureSet,
    label,
    reportPath: `${reportsDirPath}/${passId}.report.json`
  };
}

function normalizeExitCode(value: any, fallback: any) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function normalizeText(value: any) {
  return String(value || '');
}

function toPortablePath(value: any) {
  return String(value || '').replace(/\\/g, '/');
}
