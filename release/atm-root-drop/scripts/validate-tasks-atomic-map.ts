import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs', 'reports', 'tasks-command-atomic-map.md');
const dogfoodReportPath = path.join(root, 'docs', 'reports', 'tasks-atomic-map-dogfood-report.md');
const report = readFileSync(reportPath, 'utf8');
const dogfoodReport = readFileSync(dogfoodReportPath, 'utf8');
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

const requiredDogfoodSections = [
  '## Scope',
  '## Line Count Summary',
  '## Atom Map As Data',
  '## Single Owner Check',
  '## Abnormal Release Regression Check',
  '## Validator Results',
  '## Residual Risk',
  '## Conclusion'
];

const extractedAtoms = [
  {
    task: 'TASK-CID-0054',
    atom: 'tasks.claim.lifecycle',
    owner: 'packages/cli/src/commands/tasks/lifecycle-state.ts',
    test: 'packages/cli/src/commands/tasks/__tests__/lifecycle-state.test.ts',
    commit: 'ec9d8be8',
    pattern: 'Policy Object'
  },
  {
    task: 'TASK-CID-0055',
    atom: 'tasks.reconcile.delivery',
    owner: 'packages/cli/src/commands/tasks/historical-delivery.ts',
    test: 'packages/cli/src/commands/tasks/__tests__/historical-delivery.test.ts',
    commit: '01d52402',
    pattern: 'Result Contract Object'
  },
  {
    task: 'TASK-CID-0056',
    atom: 'tasks.scope.locking',
    owner: 'packages/cli/src/commands/tasks/scope-lock-diagnostics.ts',
    test: 'packages/cli/src/commands/tasks/__tests__/scope-lock-diagnostics.test.ts',
    commit: 'e66a0335',
    pattern: 'Policy Object'
  },
  {
    task: 'TASK-CID-0057',
    atom: 'tasks.residue.diagnostics',
    owner: 'packages/cli/src/commands/tasks/residue-diagnostics.ts',
    test: 'packages/cli/src/commands/tasks/__tests__/residue-diagnostics.test.ts',
    commit: 'a699c87e',
    pattern: 'Strategy Map'
  },
  {
    task: 'TASK-CID-0058',
    atom: 'tasks.command.dispatch',
    owner: 'packages/cli/src/commands/tasks/command-dispatch.ts',
    test: 'packages/cli/src/commands/tasks/__tests__/command-dispatch.test.ts',
    commit: 'd9b5d46b',
    pattern: 'Facade'
  }
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

for (const section of requiredDogfoodSections) {
  if (!dogfoodReport.includes(section)) {
    fail(`missing required dogfood section: ${section}`);
  }
}

for (const extractedAtom of extractedAtoms) {
  for (const value of [
    extractedAtom.task,
    extractedAtom.atom,
    extractedAtom.owner,
    extractedAtom.test,
    extractedAtom.commit,
    extractedAtom.pattern
  ]) {
    if (!dogfoodReport.includes(value)) {
      fail(`dogfood report missing extracted atom data: ${value}`);
    }
  }
  if (!existsSync(path.join(root, extractedAtom.owner))) {
    fail(`missing extracted atom owner module: ${extractedAtom.owner}`);
  }
  if (!existsSync(path.join(root, extractedAtom.test))) {
    fail(`missing extracted atom focused test: ${extractedAtom.test}`);
  }
}

for (const requiredText of [
  'Atom Map As Data',
  'TASK-CID-0047',
  'Source/Test Delivery Commit',
  'Runner-Sync Evidence',
  'No separate runner-sync commit recorded for this atom',
  'packages/cli/src/commands/tasks/dependency-gate.ts',
  'packages/cli/src/commands/tasks/closeout-provenance.ts',
  'npm run typecheck',
  'node --strip-types scripts/validate-tasks-atomic-map.ts',
  'npm run validate:cli',
  'git diff --check',
  'Residual Risk'
]) {
  if (!dogfoodReport.includes(requiredText)) {
    fail(`dogfood report missing required evidence text: ${requiredText}`);
  }
}

if (dogfoodReport.includes('same delivery commit; build artifacts included')) {
  fail('dogfood report must not collapse runner-sync evidence into an ambiguous same-delivery phrase');
}

for (const pattern of ['Policy Object', 'Strategy Map', 'Result Contract Object', 'Facade', 'Adapter/Port']) {
  if (!dogfoodReport.includes(pattern)) {
    fail(`dogfood report missing atom pattern vocabulary: ${pattern}`);
  }
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

// ---------------------------------------------------------------------------
// TASK-RFT-0010 — assert the four new owner modules exist and are referenced
// by the atomic-map report.
// ---------------------------------------------------------------------------

const rftOwnerModules = [
  'packages/cli/src/commands/tasks/close-governance.ts',
  'packages/cli/src/commands/tasks/status-triangulation.ts',
  'packages/cli/src/commands/tasks/import-verify.ts',
  'packages/cli/src/commands/tasks/result-contracts.ts'
];

for (const ownerModule of rftOwnerModules) {
  if (!existsSync(path.join(root, ownerModule))) {
    fail(`TASK-RFT-0010 missing owner module file: ${ownerModule}`);
  }
  if (!report.includes(ownerModule)) {
    fail(`TASK-RFT-0010 report must reference owner module: ${ownerModule}`);
  }
}

const rftSpecModules = [
  'packages/cli/src/commands/tasks/__tests__/close-governance.spec.ts',
  'packages/cli/src/commands/tasks/__tests__/status-triangulation.spec.ts',
  'packages/cli/src/commands/tasks/__tests__/import-verify.spec.ts',
  'packages/cli/src/commands/tasks/__tests__/result-contracts.spec.ts'
];
for (const specModule of rftSpecModules) {
  if (!existsSync(path.join(root, specModule))) {
    fail(`TASK-RFT-0010 missing spec file: ${specModule}`);
  }
}

if (!tasksSource.includes("from './tasks/close-governance.ts'")) {
  fail('tasks.ts must import close-governance owner module');
}
if (!tasksSource.includes("from './tasks/status-triangulation.ts'")) {
  fail('tasks.ts must import status-triangulation owner module');
}
if (!tasksSource.includes("from './tasks/result-contracts.ts'")) {
  fail('tasks.ts must import result-contracts owner module for re-export');
}

// --- Merged from validate-tasks-orchestrator-atomic-map.ts (TASK-RFT-0012) ---
// runTasksClose / runTasksImport / runTasksVerify bodies must live in their
// orchestrator files, not tasks.ts, and tasks.ts stays under the size cap.

function bodyDefinesFunction(source: string, name: string): boolean {
  const re = new RegExp('^(?:export\\s+)?(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  return re.test(source);
}

const closeOrchestratorSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks/close-orchestrator.ts'), 'utf8');
const importOrchestratorSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks/import-orchestrator.ts'), 'utf8');
const verifyOrchestratorSource = readFileSync(path.join(root, 'packages/cli/src/commands/tasks/verify-orchestrator.ts'), 'utf8');

for (const name of ['runTasksClose', 'runTasksImport', 'runTasksVerify']) {
  if (bodyDefinesFunction(tasksSource, name)) {
    fail(`${name} function body still defined in tasks.ts; expected to live only in its orchestrator file.`);
  }
}
if (!bodyDefinesFunction(closeOrchestratorSource, 'runTasksClose')) {
  fail('runTasksClose not defined in tasks/close-orchestrator.ts.');
}
if (!bodyDefinesFunction(importOrchestratorSource, 'runTasksImport')) {
  fail('runTasksImport not defined in tasks/import-orchestrator.ts.');
}
if (!bodyDefinesFunction(verifyOrchestratorSource, 'runTasksVerify')) {
  fail('runTasksVerify not defined in tasks/verify-orchestrator.ts.');
}

// --- Merged from validate-tasks-close-helpers-atomic-map.ts (TASK-RFT-0013) ---
// Close-helper cluster split stays in place and tasks.ts stays under 6,000 lines.

const closeHelperModules = [
  'close-artifact-staging.ts',
  'task-transition-writer.ts',
  'broker-admission-explanation.ts',
  'close-window-diagnostics.ts'
];
for (const helper of closeHelperModules) {
  if (!existsSync(path.join(root, 'packages/cli/src/commands/tasks/close-helpers', helper))) {
    fail(`close-helper module missing: packages/cli/src/commands/tasks/close-helpers/${helper}`);
  }
}
for (const helper of ['close-artifact-staging', 'task-transition-writer', 'close-window-diagnostics']) {
  if (!closeOrchestratorSource.includes(`./close-helpers/${helper}`)) {
    fail(`close-orchestrator.ts does not import from ./close-helpers/${helper}.`);
  }
}
if (!tasksSource.includes('./tasks/close-helpers/broker-admission-explanation')) {
  fail('tasks.ts does not import from ./tasks/close-helpers/broker-admission-explanation.');
}

const tasksSourceLineCount = tasksSource.split('\n').length;
if (tasksSourceLineCount >= 6000) {
  fail(`tasks.ts has ${tasksSourceLineCount} lines; expected under 6000 after the orchestrator and close-helper splits.`);
}

console.log(`[tasks-atomic-map] ok (tasks.ts=${tasksSourceLineCount} lines, orchestrators and close helpers wired)`);

