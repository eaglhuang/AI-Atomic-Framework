import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const facadePath = path.join(root, 'packages', 'cli', 'src', 'commands', 'evidence.ts');
const reportPath = path.join(root, 'docs', 'reports', 'evidence-command-atomic-map.md');

const verbModules = [
  'packages/cli/src/commands/evidence/verbs/add.ts',
  'packages/cli/src/commands/evidence/verbs/run.ts',
  'packages/cli/src/commands/evidence/verbs/verify.ts',
  'packages/cli/src/commands/evidence/verbs/diff.ts',
  'packages/cli/src/commands/evidence/verbs/validators.ts',
  'packages/cli/src/commands/evidence/verbs/missing.ts',
  'packages/cli/src/commands/evidence/verbs/git-head-backfill.ts'
] as const;

const sharedModules = [
  'packages/cli/src/commands/evidence/validator-classification.ts',
  'packages/cli/src/commands/evidence/command-runs.ts',
  'packages/cli/src/commands/evidence/missing-report.ts'
] as const;

const specs = [
  'packages/cli/src/commands/evidence/__tests__/add.spec.ts',
  'packages/cli/src/commands/evidence/__tests__/run.spec.ts',
  'packages/cli/src/commands/evidence/__tests__/verify.spec.ts',
  'packages/cli/src/commands/evidence/__tests__/diff.spec.ts',
  'packages/cli/src/commands/evidence/__tests__/validators.spec.ts',
  'packages/cli/src/commands/evidence/__tests__/missing.spec.ts',
  'packages/cli/src/commands/evidence/__tests__/git-head-backfill.spec.ts',
  'packages/cli/src/commands/evidence/__tests__/validator-classification.spec.ts',
  'packages/cli/src/commands/evidence/__tests__/command-runs.spec.ts'
] as const;

const facadeCap = 250;
const facadeBaseline = 2822;

function fail(message: string): never {
  console.error(`[evidence-atomic-map] ${message}`);
  process.exit(1);
}

if (!existsSync(reportPath)) fail(`missing report: ${reportPath}`);
const report = readFileSync(reportPath, 'utf8');
for (const section of ['## Scope', '## Atom List', '## Line Count Summary', '## Validator Notes']) {
  if (!report.includes(section)) fail(`report missing section: ${section}`);
}

for (const mod of [...verbModules, ...sharedModules]) {
  if (!existsSync(path.join(root, mod))) fail(`missing module: ${mod}`);
  if (!report.includes(mod)) fail(`report must reference ${mod}`);
}
for (const spec of specs) {
  if (!existsSync(path.join(root, spec))) fail(`missing spec: ${spec}`);
}

const facade = readFileSync(facadePath, 'utf8');
const facadeLines = facade.split('\n').length;
if (facadeLines >= facadeCap) fail(`evidence.ts has ${facadeLines} lines; facade must stay below ${facadeCap}`);
if (facadeLines >= facadeBaseline) fail(`evidence.ts still has ${facadeLines} lines; expected reduction from ${facadeBaseline}`);

for (const exportName of ['export async function runEvidence', 'verifyTaskEvidence', 'computeMissingValidatorReport']) {
  if (!facade.includes(exportName)) fail(`evidence.ts must export/re-export ${exportName}`);
}

console.log(`[evidence-atomic-map] ok (evidence.ts=${facadeLines}, verbs=${verbModules.length}, shared=${sharedModules.length}, facade-cap<${facadeCap})`);
