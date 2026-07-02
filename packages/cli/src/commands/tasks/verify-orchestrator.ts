// TASK-RFT-0012: extracted verbatim from packages/cli/src/commands/tasks.ts.
// The body of runTasksVerify lives here; tasks.ts router re-exports it.
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { CliError, makeResult, message, relativePathFrom } from '../shared.ts';
import { readTaskLedgerPolicy } from '../task-ledger.ts';
import {
  type TaskImportDiagnostic,
  type TaskVerifyReport,
  inspectTaskVerifyStatus,
  inspectTaskSourceTrace,
  parseVerifyOptions,
  validStatuses
} from '../tasks.ts';

export async function runTasksVerify(argv: string[]) {
  const options = parseVerifyOptions(argv);
  const taskLedger = readTaskLedgerPolicy(options.cwd);
  const taskStoreAbsolute = path.resolve(options.cwd, taskLedger.taskRoot);
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
          text: `${taskLedger.taskRoot} does not exist; nothing to verify.`
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
    const statusInspection = inspectTaskVerifyStatus(parsed.status);
    if (!statusInspection.ok) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_INVALID_STATUS',
        text: `Task ${workItemId} has invalid status ${String(parsed.status)}. Expected one of ${[...validStatuses].join(', ')}.`,
        workItemId
      });
    } else if (statusInspection.warningCode) {
      findings.push({
        level: 'warning',
        code: statusInspection.warningCode,
        text: `Task ${workItemId} uses legacy status ${String(parsed.status)}; ATM will treat it as ${statusInspection.normalizedStatus}.`,
        workItemId
      });
    }
    if (parsed.source !== undefined) {
      const sourceFinding = inspectTaskSourceTrace(parsed, statusInspection);
      if (sourceFinding) {
        findings.push({
          level: sourceFinding.level,
          code: sourceFinding.code,
          text: `Task ${workItemId} ${sourceFinding.text}`,
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
