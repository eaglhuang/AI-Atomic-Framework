import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextSourcePath = path.join(root, 'packages', 'cli', 'src', 'commands', 'next.ts');
const reportPath = path.join(root, 'docs', 'reports', 'next-command-atomic-map.md');

const atomModules = [
  'packages/cli/src/commands/next/channel-strategy.ts',
  'packages/cli/src/commands/next/claim-admission.ts',
  'packages/cli/src/commands/next/task-scoped-claim-command.ts',
  'packages/cli/src/commands/next/runner-mode.ts'
] as const;

const atomSpecs = [
  'packages/cli/src/commands/next/__tests__/channel-strategy.spec.ts',
  'packages/cli/src/commands/next/__tests__/claim-admission.spec.ts',
  'packages/cli/src/commands/next/__tests__/task-scoped-claim-command.spec.ts',
  'packages/cli/src/commands/next/__tests__/runner-mode.spec.ts'
] as const;

const atomLineCap = 600;
const nextFacadeLineTarget = 1200;
const nextFacadeBaseline = 5156;

function fail(message: string): never {
  console.error(`[next-atomic-map] ${message}`);
  process.exit(1);
}

if (!existsSync(reportPath)) {
  fail(`missing atomic-map report: ${reportPath}`);
}

const report = readFileSync(reportPath, 'utf8');
for (const section of ['## Scope', '## Atom List', '## Line Count Summary', '## Validator Notes']) {
  if (!report.includes(section)) {
    fail(`report missing section: ${section}`);
  }
}

for (const atomModule of atomModules) {
  const absolute = path.join(root, atomModule);
  if (!existsSync(absolute)) {
    fail(`missing atom owner module: ${atomModule}`);
  }
  if (!report.includes(atomModule)) {
    fail(`report must reference atom owner: ${atomModule}`);
  }
  const lineCount = readFileSync(absolute, 'utf8').split('\n').length;
  if (lineCount >= atomLineCap) {
    fail(`${atomModule} has ${lineCount} lines; each extracted atom must stay below ${atomLineCap}`);
  }
}

for (const spec of atomSpecs) {
  if (!existsSync(path.join(root, spec))) {
    fail(`missing focused spec: ${spec}`);
  }
}

const nextSource = readFileSync(nextSourcePath, 'utf8');
const nextLineCount = nextSource.split('\n').length;
if (nextLineCount >= nextFacadeBaseline) {
  fail(`next.ts still has ${nextLineCount} lines; expected reduction from baseline ${nextFacadeBaseline}`);
}
if (nextLineCount >= nextFacadeLineTarget) {
  console.warn(`[next-atomic-map] warn: next.ts=${nextLineCount} lines; long-term facade target is ${nextFacadeLineTarget}`);
}

const requiredImports = [
  "from './next/channel-strategy.ts'",
  "from './next/claim-admission.ts'",
  "from './next/task-scoped-claim-command.ts'",
  "from './next/runner-mode.ts'"
];
for (const importSnippet of requiredImports) {
  if (!nextSource.includes(importSnippet)) {
    fail(`next.ts must import atom module via ${importSnippet}`);
  }
}

const forbiddenLocalDefinitions = [
  'function withRunnerMode',
  'function describeRunnerMode',
  'function classifyRunnerMode',
  'function decideNextAction',
  'function allowedGuidanceBootstrapCommands',
  'function blockedMutationCommands'
];
for (const signature of forbiddenLocalDefinitions) {
  if (nextSource.includes(signature)) {
    fail(`next.ts still defines extracted atom locally: ${signature}`);
  }
}

if (!nextSource.includes('export async function runNext')) {
  fail('next.ts must continue exporting runNext');
}

console.log(`[next-atomic-map] ok (next.ts=${nextLineCount}, atoms=${atomModules.length}, atom-line-cap<${atomLineCap})`);
