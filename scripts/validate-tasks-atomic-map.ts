import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs', 'reports', 'tasks-command-atomic-map.md');
const report = readFileSync(reportPath, 'utf8');
const tasksSourcePath = path.join(root, 'packages', 'cli', 'src', 'commands', 'tasks.ts');
const dispatchSourcePath = path.join(root, 'packages', 'cli', 'src', 'commands', 'tasks', 'command-dispatch.ts');
const tasksSource = readFileSync(tasksSourcePath, 'utf8');
const dispatchSource = readFileSync(dispatchSourcePath, 'utf8');

const requiredSections = [
  '## Scope',
  '## Atom List',
  '## Governance Invariants',
  '## Duplicate Logic Hotspots',
  '## Caller Surfaces',
  '## Extraction Targets',
  '## Validator Notes'
];

const requiredAtoms = [
  'tasks.command.dispatch',
  'tasks.close.governance',
  'tasks.claim.lifecycle',
  'tasks.reconcile.delivery',
  'tasks.repair.closure',
  'tasks.status.triangulation',
  'tasks.residue.diagnostics',
  'tasks.scope.locking',
  'tasks.ledger.import.verify',
  'next.imported-task.routing',
  'next.route.predicates'
];

const requiredCallers = [
  'packages/cli/src/commands/tasks.ts',
  'packages/cli/src/commands/tasks/command-dispatch.ts',
  'packages/cli/src/commands/next.ts',
  'packages/cli/src/commands/next/route-predicates.ts'
];

const requiredDispatchArtifacts = [
  'packages/cli/src/commands/tasks/command-dispatch.ts',
  'packages/cli/src/commands/tasks/__tests__/command-dispatch.test.ts'
];

function fail(message: string): never {
  console.error(`[tasks-atomic-map] ${message}`);
  process.exit(1);
}

for (const section of requiredSections) {
  if (!report.includes(section)) {
    fail(`missing required section: ${section}`);
  }
}

for (const atom of requiredAtoms) {
  if (!report.includes(atom)) {
    fail(`missing atom inventory entry: ${atom}`);
  }
}

for (const caller of requiredCallers) {
  if (!report.includes(caller)) {
    fail(`missing caller surface reference: ${caller}`);
  }
}

for (const artifact of requiredDispatchArtifacts) {
  if (!report.includes(artifact)) {
    fail(`missing TASK-CID-0058 dispatch artifact reference: ${artifact}`);
  }
  if (!existsSync(path.join(root, artifact))) {
    fail(`missing TASK-CID-0058 dispatch artifact file: ${artifact}`);
  }
}

if (!/read-only/i.test(report)) {
  fail('report must explicitly state it is read-only');
}

if (!tasksSource.includes("from './tasks/command-dispatch.ts'")) {
  fail('tasks.ts must import the command dispatch atom');
}

if (!tasksSource.includes('return dispatchTasksAction(argv,')) {
  fail('runTasks must delegate action routing to dispatchTasksAction');
}

if (!dispatchSource.includes("case 'block':") || !dispatchSource.includes("'--status', 'blocked'")) {
  fail('command-dispatch must own block alias routing');
}

if (!dispatchSource.includes("case 'claim':") || !dispatchSource.includes('handlers.claimLifecycle(action, rest)')) {
  fail('command-dispatch must own claim lifecycle action grouping');
}

console.log('[tasks-atomic-map] ok');
