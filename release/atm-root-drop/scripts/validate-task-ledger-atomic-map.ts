import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const facadePath = path.join(root, 'scripts', 'validate-task-ledger-governance.ts');
const reportPath = path.join(root, 'docs', 'reports', 'task-ledger-governance-atomic-map.md');
const registryPath = path.join(root, 'scripts', 'lib', 'task-ledger-invariant-registry.ts');

const invariants = [
  'residue-classification',
  'taskflow-close-orchestration',
  'planning-only-audit-boundary',
  'closure-packet-dirty-tree-hygiene',
  'task-import-dispatch-metadata',
  'task-import-refresh-claim-preservation',
  'tasks-roster-update-contract',
  'tasks-new-rejects-root-output',
  'taskflow-host-opener-fallback',
  'sandbox-diagnostics-actionable',
  'last-transition-hash',
  'emergency-use-pre-commit-audit',
  'ledger-readers-atomization'
] as const;

function fail(message: string): never {
  console.error(`[task-ledger-atomic-map] ${message}`);
  process.exit(1);
}

if (!existsSync(reportPath)) fail(`missing report: ${reportPath}`);
const report = readFileSync(reportPath, 'utf8');
for (const section of ['## Scope', '## Atom List', '## Line Count Summary', '## Validator Notes']) {
  if (!report.includes(section)) fail(`report missing section: ${section}`);
}

if (!existsSync(registryPath)) fail('missing registry module');
const registry = readFileSync(registryPath, 'utf8');
for (const id of invariants) {
  const mod = `scripts/validators/task-ledger/${id}.ts`;
  if (!existsSync(path.join(root, mod))) fail(`missing invariant module: ${mod}`);
  if (!registry.includes(`id: '${id}'`)) fail(`registry missing id ${id}`);
  if (!report.includes(mod)) fail(`report must reference ${mod}`);
}

for (const helper of [
  'scripts/lib/task-ledger-invariant-registry.ts',
  'scripts/lib/task-ledger-fixture-builder.ts',
  'scripts/lib/task-ledger-assertions.ts'
]) {
  if (!existsSync(path.join(root, helper))) fail(`missing helper: ${helper}`);
}

for (const spec of [
  'scripts/validators/task-ledger/__tests__/registry.spec.ts',
  'scripts/validators/task-ledger/__tests__/residue-classification.spec.ts',
  'scripts/validators/task-ledger/__tests__/taskflow-close-orchestration.spec.ts'
]) {
  if (!existsSync(path.join(root, spec))) fail(`missing spec: ${spec}`);
}

const facadeLines = readFileSync(facadePath, 'utf8').split('\n').length;
if (facadeLines >= 200) fail(`validate-task-ledger-governance.ts has ${facadeLines} lines; must stay below 200`);

console.log(`[task-ledger-atomic-map] ok (facade=${facadeLines}, invariants=${invariants.length})`);
