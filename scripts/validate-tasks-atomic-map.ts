import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs', 'reports', 'tasks-command-atomic-map.md');
const report = readFileSync(reportPath, 'utf8');

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
  'packages/cli/src/commands/next.ts',
  'packages/cli/src/commands/next/route-predicates.ts'
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

if (!/read-only/i.test(report)) {
  fail('report must explicitly state it is read-only');
}

console.log('[tasks-atomic-map] ok');
