// TASK-RFT-0013 — validate the close-helper cluster split remains in place.
// Asserts that each of the four close-helper files exists, that
// close-orchestrator.ts imports each helper module, and that tasks.ts stays
// under 6000 lines after the extraction.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const TASKS_TS = path.join(repoRoot, 'packages/cli/src/commands/tasks.ts');
const CLOSE_ORCH = path.join(repoRoot, 'packages/cli/src/commands/tasks/close-orchestrator.ts');
const HELPERS_DIR = 'packages/cli/src/commands/tasks/close-helpers';

const HELPERS = [
  'close-artifact-staging.ts',
  'task-transition-writer.ts',
  'broker-admission-explanation.ts',
  'close-window-diagnostics.ts'
];

const TASKS_TS_MAX_LINES = 6000;

interface Finding { readonly level: 'error'; readonly code: string; readonly text: string; }
const findings: Finding[] = [];

// 1. Each helper module must exist.
for (const helper of HELPERS) {
  const abs = path.join(repoRoot, HELPERS_DIR, helper);
  if (!existsSync(abs)) {
    findings.push({
      level: 'error',
      code: 'ATM_CLOSE_HELPERS_MISSING',
      text: `close-helper module missing: ${HELPERS_DIR}/${helper}`
    });
  }
}

// 2. close-orchestrator.ts must import the three helpers it directly consumes.
//    (broker-admission-explanation is consumed via tasks.ts parallel-advisor
//    path, so it is imported by tasks.ts, not close-orchestrator.ts.)
const ORCH_REQUIRED = [
  'close-artifact-staging.ts',
  'task-transition-writer.ts',
  'close-window-diagnostics.ts'
];
const closeSource = existsSync(CLOSE_ORCH) ? readFileSync(CLOSE_ORCH, 'utf8') : '';
const tasksSourceForImports = readFileSync(TASKS_TS, 'utf8');
if (!closeSource) {
  findings.push({
    level: 'error',
    code: 'ATM_CLOSE_HELPERS_ORCH_MISSING',
    text: 'close-orchestrator.ts is missing.'
  });
} else {
  for (const helper of ORCH_REQUIRED) {
    const stem = helper.replace(/\.ts$/, '');
    const needle = `./close-helpers/${stem}`;
    if (!closeSource.includes(needle)) {
      findings.push({
        level: 'error',
        code: 'ATM_CLOSE_HELPERS_ORCH_IMPORT_MISSING',
        text: `close-orchestrator.ts does not import from ${needle}.`
      });
    }
  }
  // broker-admission-explanation must be imported by tasks.ts (parallel-advisor slice).
  if (!tasksSourceForImports.includes('./tasks/close-helpers/broker-admission-explanation')) {
    findings.push({
      level: 'error',
      code: 'ATM_CLOSE_HELPERS_TASKS_TS_IMPORT_MISSING',
      text: 'tasks.ts does not import from ./tasks/close-helpers/broker-admission-explanation.'
    });
  }
}

// 3. tasks.ts line count.
const tasksSource = readFileSync(TASKS_TS, 'utf8');
const tasksLines = tasksSource.split('\n').length;
if (tasksLines >= TASKS_TS_MAX_LINES) {
  findings.push({
    level: 'error',
    code: 'ATM_CLOSE_HELPERS_TASKS_TS_TOO_LARGE',
    text: `tasks.ts has ${tasksLines} lines; expected under ${TASKS_TS_MAX_LINES} after close-helper split.`
  });
}

if (findings.length > 0) {
  console.error('[tasks-close-helpers-atomic-map] FAILED');
  for (const f of findings) console.error(`  ${f.code}: ${f.text}`);
  process.exit(1);
}

console.log(`[tasks-close-helpers-atomic-map] ok (tasks.ts=${tasksLines} lines, 4 helper modules wired into close-orchestrator)`);
