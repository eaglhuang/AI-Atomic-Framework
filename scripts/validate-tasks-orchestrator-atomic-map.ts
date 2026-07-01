// TASK-RFT-0012 — validate the orchestrator body extraction remains in place.
// Asserts that runTasksClose / runTasksImport / runTasksVerify function bodies
// no longer live inside packages/cli/src/commands/tasks.ts but instead live in
// their dedicated orchestrator files under packages/cli/src/commands/tasks/.
// Also enforces the size-cap goal (tasks.ts stays under 6,700 lines).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const TASKS_TS = path.join(repoRoot, 'packages/cli/src/commands/tasks.ts');
const CLOSE_ORCH = path.join(repoRoot, 'packages/cli/src/commands/tasks/close-orchestrator.ts');
const IMPORT_ORCH = path.join(repoRoot, 'packages/cli/src/commands/tasks/import-orchestrator.ts');
const VERIFY_ORCH = path.join(repoRoot, 'packages/cli/src/commands/tasks/verify-orchestrator.ts');

const TASKS_TS_MAX_LINES = 6700;

interface Finding {
  readonly level: 'error';
  readonly code: string;
  readonly text: string;
}

const findings: Finding[] = [];

function bodyDefinesFunction(source: string, name: string): boolean {
  // Match "async function <name>(" or "export async function <name>(" or "function <name>(" as a top-level definition.
  const re = new RegExp('^(?:export\\s+)?(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  return re.test(source);
}

const tasksSource = readFileSync(TASKS_TS, 'utf8');
const closeSource = readFileSync(CLOSE_ORCH, 'utf8');
const importSource = readFileSync(IMPORT_ORCH, 'utf8');
const verifySource = readFileSync(VERIFY_ORCH, 'utf8');

// 1. tasks.ts must NOT define the three orchestrator bodies.
for (const name of ['runTasksClose', 'runTasksImport', 'runTasksVerify']) {
  if (bodyDefinesFunction(tasksSource, name)) {
    findings.push({
      level: 'error',
      code: 'ATM_ORCH_BODY_STILL_IN_TASKS_TS',
      text: `${name} function body still defined in tasks.ts; expected to live only in its orchestrator file.`
    });
  }
}

// 2. Each orchestrator file MUST define its function.
if (!bodyDefinesFunction(closeSource, 'runTasksClose')) {
  findings.push({ level: 'error', code: 'ATM_ORCH_CLOSE_MISSING', text: 'runTasksClose not defined in tasks/close-orchestrator.ts.' });
}
if (!bodyDefinesFunction(importSource, 'runTasksImport')) {
  findings.push({ level: 'error', code: 'ATM_ORCH_IMPORT_MISSING', text: 'runTasksImport not defined in tasks/import-orchestrator.ts.' });
}
if (!bodyDefinesFunction(verifySource, 'runTasksVerify')) {
  findings.push({ level: 'error', code: 'ATM_ORCH_VERIFY_MISSING', text: 'runTasksVerify not defined in tasks/verify-orchestrator.ts.' });
}

// 3. tasks.ts size cap.
const tasksLines = tasksSource.split('\n').length;
if (tasksLines >= TASKS_TS_MAX_LINES) {
  findings.push({
    level: 'error',
    code: 'ATM_ORCH_TASKS_TS_TOO_LARGE',
    text: `tasks.ts has ${tasksLines} lines; expected under ${TASKS_TS_MAX_LINES} after orchestrator extraction.`
  });
}

if (findings.length > 0) {
  console.error('[tasks-orchestrator-atomic-map] FAILED');
  for (const f of findings) console.error(`  ${f.code}: ${f.text}`);
  process.exit(1);
}

console.log(`[tasks-orchestrator-atomic-map] ok (tasks.ts=${tasksLines} lines, 3 orchestrators in place)`);
