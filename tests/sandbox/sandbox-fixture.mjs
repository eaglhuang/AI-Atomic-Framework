#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const repoCopyEntries = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'docs',
  'examples',
  'eslint.config.mjs',
  'package-lock.json',
  'package.json',
  'packages',
  'schemas',
  'scripts',
  'templates',
  'tests',
  'tsconfig.build.json',
  'tsconfig.json',
  'turbo.json'
];

const agentsMarkdownTokens = {
  RECOMMENDED_PROMPT: 'Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action.',
  BOOTSTRAP_TASK_PATH: '.atm/history/tasks/BOOTSTRAP-0001.json',
  BOOTSTRAP_LOCK_PATH: '.atm/runtime/locks/BOOTSTRAP-0001.lock.json',
  BOOTSTRAP_PROFILE_PATH: '.atm/runtime/profile/default.md',
  PROJECT_PROBE_PATH: '.atm/runtime/project-probe.json',
  DEFAULT_GUARDS_PATH: '.atm/runtime/default-guards.json',
  BOOTSTRAP_EVIDENCE_PATH: '.atm/history/evidence/BOOTSTRAP-0001.json',
  HOST_WORKFLOW: 'npm-workspace',
  REPOSITORY_KIND: 'workspace',
  PACKAGE_MANAGER: 'npm'
};

function printHelp() {
  console.log('Usage: node tests/sandbox/sandbox-fixture.mjs <setup|verify> [sandbox-root] [source-root] [expected-output.json]');
}

function main() {
  const [command, sandboxArg = '', sourceArg = '', expectedArg = ''] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'setup') {
    const sandboxRoot = resolveSandboxRoot(sandboxArg);
    const sourceRoot = resolveSourceRoot(sourceArg);
    const report = setupSandbox(sandboxRoot, sourceRoot);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === 'verify') {
    const sandboxRoot = resolveSandboxRoot(sandboxArg, false);
    const expectedPath = expectedArg ? path.resolve(expectedArg) : path.join(scriptDir, 'expected-output.json');
    const report = verifySandbox(sandboxRoot, expectedPath);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function resolveSandboxRoot(inputPath, createIfMissing = true) {
  if (inputPath) {
    const resolved = path.resolve(inputPath);
    if (createIfMissing) {
      mkdirSync(resolved, { recursive: true });
    }
    return resolved;
  }

  return mkTempDir('atm-sandbox-fixture-');
}

function mkTempDir(prefix) {
  return createTempWorkspace(prefix);
}

function resolveSourceRoot(inputPath) {
  return inputPath ? path.resolve(inputPath) : repoRoot;
}

function setupSandbox(sandboxRoot, sourceRoot) {
  rmSync(sandboxRoot, { recursive: true, force: true });
  mkdirSync(sandboxRoot, { recursive: true });
  runGit(['init'], sandboxRoot);

  copyRepositorySubset(sourceRoot, sandboxRoot);
  renderAgentsMarkdown(sourceRoot, sandboxRoot);

  const nodeModulesMode = ensureNodeModules(sourceRoot, sandboxRoot);
  return {
    ok: true,
    sandboxRoot: path.relative(repoRoot, sandboxRoot).replace(/\\/g, '/'),
    sourceRoot: path.relative(repoRoot, sourceRoot).replace(/\\/g, '/'),
    nodeModulesMode,
    copiedEntries: repoCopyEntries.filter((entry) => existsSync(path.join(sourceRoot, entry)))
  };
}

function verifySandbox(sandboxRoot, expectedPath) {
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const cliPath = path.join(sandboxRoot, 'packages', 'cli', 'src', 'atm.mjs');
  if (!existsSync(cliPath)) {
    throw new Error(`sandbox CLI entrypoint not found: ${path.relative(sandboxRoot, cliPath)}`);
  }

  const result = spawnSync(process.execPath, [cliPath, 'self-host-alpha', '--verify', '--json'], {
    cwd: sandboxRoot,
    encoding: 'utf8'
  });

  const payload = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (!payload) {
    throw new Error('self-host-alpha produced no JSON output');
  }

  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(`self-host-alpha output is not valid JSON: ${error.message}\n${payload}`);
  }

  if ((result.status ?? 0) !== 0) {
    throw new Error(`self-host-alpha exited with ${result.status ?? 'unknown'}\n${payload}`);
  }

  const normalized = summarizeSelfHostAlpha(parsed);
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error([
      'normalized self-host-alpha output does not match expected-output.json',
      `expected: ${JSON.stringify(expected, null, 2)}`,
      `actual: ${JSON.stringify(normalized, null, 2)}`,
      `raw: ${JSON.stringify(parsed, null, 2)}`
    ].join('\n\n'));
  }

  return {
    ok: true,
    exitCode: result.status,
    sandboxRoot: path.relative(repoRoot, sandboxRoot).replace(/\\/g, '/'),
    expectedPath: path.relative(repoRoot, expectedPath).replace(/\\/g, '/'),
    output: normalized
  };
}

function summarizeSelfHostAlpha(parsed) {
  return {
    ok: parsed.ok === true,
    criteria1: parsed.criteria1 === true,
    criteria2: parsed.criteria2 === true,
    criteria3: parsed.criteria3 === true,
    criteria4: parsed.criteria4 === true
  };
}

function copyRepositorySubset(sourceRoot, targetRoot) {
  for (const entry of repoCopyEntries) {
    const sourcePath = path.join(sourceRoot, entry);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const targetPath = path.join(targetRoot, entry);
    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function renderAgentsMarkdown(sourceRoot, targetRoot) {
  const templatePath = path.join(sourceRoot, 'templates', 'root-drop', 'AGENTS.md');
  if (!existsSync(templatePath)) {
    throw new Error(`missing AGENTS template: ${path.relative(sourceRoot, templatePath)}`);
  }

  const rendered = renderTemplate(readFileSync(templatePath, 'utf8'), agentsMarkdownTokens);
  writeFileSync(path.join(targetRoot, 'AGENTS.md'), rendered, 'utf8');
}

function renderTemplate(template, tokens) {
  let rendered = template;
  for (const [token, value] of Object.entries(tokens)) {
    rendered = rendered.replaceAll(`{{${token}}}`, value);
  }
  return rendered;
}

function ensureNodeModules(sourceRoot, targetRoot) {
  const sourceNodeModules = path.join(sourceRoot, 'node_modules');
  const targetNodeModules = path.join(targetRoot, 'node_modules');

  if (existsSync(targetNodeModules)) {
    rmSync(targetNodeModules, { recursive: true, force: true });
  }

  if (existsSync(sourceNodeModules)) {
    try {
      symlinkSync(sourceNodeModules, targetNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
      return 'linked';
    } catch {
      // Fall back to a local install if the platform blocks symlink creation.
    }
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const install = spawnSync(npmCommand, ['ci'], {
    cwd: targetRoot,
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if ((install.status ?? 0) !== 0) {
    throw new Error(`npm ci failed with exit code ${install.status ?? 'unknown'}`);
  }

  return 'installed';
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'ignore'
  });

  if ((result.status ?? 0) !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

main();
