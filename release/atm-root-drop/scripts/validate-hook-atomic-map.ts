import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAtomizationLinePolicy } from '../packages/cli/src/commands/tasks/task-import-validators.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hookFacadePath = path.join(root, 'packages', 'cli', 'src', 'commands', 'hook.ts');
const reportPath = path.join(root, 'docs', 'reports', 'hook-command-atomic-map.md');

const phaseModules = [
  'packages/cli/src/commands/hook/pre-commit.ts',
  'packages/cli/src/commands/hook/pre-push.ts',
  'packages/cli/src/commands/hook/commit-range-guard.ts',
  'packages/cli/src/commands/hook/git-hooks-installer.ts',
  'packages/cli/src/commands/hook/git-index-diagnostics.ts'
] as const;

const phaseSpecs = [
  'packages/cli/src/commands/hook/__tests__/pre-commit.spec.ts',
  'packages/cli/src/commands/hook/__tests__/pre-push.spec.ts',
  'packages/cli/src/commands/hook/__tests__/commit-range-guard.spec.ts',
  'packages/cli/src/commands/hook/__tests__/git-hooks-installer.spec.ts',
  'packages/cli/src/commands/hook/__tests__/git-index-diagnostics.spec.ts'
] as const;

const hookFacadeLineCap = resolveAtomizationLinePolicy({ config: readRepoConfig(root) }).maxLines;
const hookFacadeBaseline = 3429;

function fail(message: string): never {
  console.error(`[hook-atomic-map] ${message}`);
  process.exit(1);
}

function readRepoConfig(cwd: string): { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } } | null {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, 'utf8')) as { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } };
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

for (const phaseModule of phaseModules) {
  const absolute = path.join(root, phaseModule);
  if (!existsSync(absolute)) {
    fail(`missing phase owner module: ${phaseModule}`);
  }
  if (!report.includes(phaseModule)) {
    fail(`report must reference phase owner: ${phaseModule}`);
  }
}

for (const spec of phaseSpecs) {
  if (!existsSync(path.join(root, spec))) {
    fail(`missing focused spec: ${spec}`);
  }
}

const hookSource = readFileSync(hookFacadePath, 'utf8');
const hookLineCount = hookSource.split('\n').length;
if (hookLineCount >= hookFacadeLineCap) {
  fail(`hook.ts has ${hookLineCount} lines; facade must stay below ${hookFacadeLineCap}`);
}
if (hookLineCount >= hookFacadeBaseline) {
  fail(`hook.ts still has ${hookLineCount} lines; expected reduction from baseline ${hookFacadeBaseline}`);
}

const requiredImports = [
  "from './hook/pre-commit.ts'",
  "from './hook/pre-push.ts'",
  "from './hook/commit-range-guard.ts'",
  "from './hook/git-hooks-installer.ts'"
];
for (const importSnippet of requiredImports) {
  if (!hookSource.includes(importSnippet)) {
    fail(`hook.ts must import phase module via ${importSnippet}`);
  }
}

const requiredExports = [
  'export function runHook',
  'export function runGitHooks',
  'export function runCommitRangeGuard',
  'inspectGitHooks',
  'installGitHooks'
];
for (const exportSnippet of requiredExports) {
  if (!hookSource.includes(exportSnippet)) {
    fail(`hook.ts must continue exporting ${exportSnippet}`);
  }
}

const forbiddenLocalDefinitions = [
  'function runPreCommitHook',
  'function runPrePushHook',
  'function createCommitRangeGuardReport',
  'function inspectGitHooks',
  'function installGitHooks',
  'function inspectGitIndexAccess'
];
for (const signature of forbiddenLocalDefinitions) {
  if (hookSource.includes(signature)) {
    fail(`hook.ts still defines extracted phase logic locally: ${signature}`);
  }
}

console.log(`[hook-atomic-map] ok (hook.ts=${hookLineCount}, phases=${phaseModules.length}, facade-cap<${hookFacadeLineCap})`);
