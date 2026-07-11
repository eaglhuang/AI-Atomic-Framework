import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { detectFrameworkRepoIdentity, type FrameworkRepoIdentity } from '../framework-development.ts';
import { relativePathFrom } from '../shared.ts';
import { CliError } from '../shared.ts';
import { runGit, runGitScalar, normalizeRelativePath } from './git-index-diagnostics.ts';

export const hookContractVersion = 'atm.integration-hooks/v1' as const;
export const hookProvider = 'atm-framework-development-hooks/v1' as const;
export const hookMarker = 'ATM_INTEGRATION_HOOK_CONTRACT_V1' as const;

export interface GitHookInspectionReport {
  readonly schemaId: 'atm.gitHooksInspection.v1';
  readonly generatedAt: string;
  readonly repoIdentity: ReturnType<typeof detectFrameworkRepoIdentity>;
  readonly required: boolean;
  readonly hooksPath: string | null;
  readonly expectedHooksPath: string;
  readonly hooksPathOk: boolean;
  readonly installedHookFiles: readonly HookFileInspection[];
  readonly ok: boolean;
}

export interface HookFileInspection {
  readonly path: string;
  readonly present: boolean;
  readonly markerPresent: boolean;
  readonly sha256: string | null;
}

interface ParsedGitHooksArgs {
  readonly cwd: string;
  readonly action: 'install' | 'verify';
  readonly frameworkRequired: boolean;
}

const hookFileNames = ['pre-commit', 'pre-push'] as const;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `hook command requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}

export function inspectGitHooks(cwd: string, options: { frameworkRequired?: boolean } = {}): GitHookInspectionReport {
  const root = path.resolve(cwd);
  const repoIdentity = detectFrameworkRepoIdentity(root);
  const required = options.frameworkRequired === true || repoIdentity.isFrameworkRepo;
  const hooksPath = runGitScalar(root, ['config', '--get', 'core.hooksPath']);
  const expectedHooksPath = '.atm/git-hooks';
  const installedHookFiles = hookFileNames.map((hookName) => inspectHookFile(root, hookName));
  const hooksPathOk = normalizeGitConfigPath(hooksPath) === expectedHooksPath;
  const filesOk = installedHookFiles.every((entry) => entry.present && entry.markerPresent);
  return {
    schemaId: 'atm.gitHooksInspection.v1',
    generatedAt: new Date().toISOString(),
    repoIdentity,
    required,
    hooksPath,
    expectedHooksPath,
    hooksPathOk,
    installedHookFiles,
    ok: required ? hooksPathOk && filesOk : true
  };
}

export function installGitHooks(cwd: string, options: { frameworkRequired?: boolean } = {}) {
  const root = path.resolve(cwd);
  const repoIdentity = detectFrameworkRepoIdentity(root);
  const required = options.frameworkRequired === true || repoIdentity.isFrameworkRepo;
  const hooksDir = path.join(root, '.atm', 'git-hooks');
  mkdirSync(hooksDir, { recursive: true });

  const writtenFiles = hookFileNames.map((hookName) => {
    const hookPath = path.join(hooksDir, hookName);
    writeFileSync(hookPath, createGitHookScript(hookName, repoIdentity), 'utf8');
    try {
      chmodSync(hookPath, 0o755);
    } catch {
      // chmod is best-effort on Windows filesystems.
    }
    return relativePathFrom(root, hookPath);
  });

  const configResult = runGit(root, ['config', 'core.hooksPath', '.atm/git-hooks']);
  const inspection = inspectGitHooks(root, { frameworkRequired: required });
  return {
    schemaId: 'atm.gitHooksInstallReport.v1',
    generatedAt: new Date().toISOString(),
    repoIdentity,
    required,
    writtenFiles,
    gitConfigExitCode: configResult.exitCode,
    gitConfigStderr: configResult.stderr.trim(),
    ok: inspection.ok && configResult.exitCode === 0,
    inspection
  };
}
export function createGitHookScript(hookName: 'pre-commit' | 'pre-push', repoIdentity: FrameworkRepoIdentity) {
  const action = hookName === 'pre-commit' ? 'pre-commit' : 'pre-push';
  const command = `node atm.mjs hook ${action} --json`;
  if (!repoIdentity.isFrameworkRepo) {
    return [
      '#!/usr/bin/env sh',
      'set -eu',
      `# ${hookMarker}`,
      '',
      'repo_root="$(git rev-parse --show-toplevel)"',
      'cd "$repo_root"',
      '',
      command,
      ''
    ].join('\n');
  }
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    `# ${hookMarker}`,
    '',
    'repo_root="$(git rev-parse --show-toplevel)"',
    'cd "$repo_root"',
    '',
    'runner="atm.mjs"',
    'if [ -f "atm.dev.mjs" ] && [ -f "packages/cli/src/atm.ts" ] && [ -f "packages/core/src/index.ts" ]; then',
    '  runner="atm.dev.mjs"',
    'fi',
    '',
    `node "$runner" hook ${action} --json`,
    ''
  ].join('\n');
}

export function inspectHookFile(cwd: string, hookName: 'pre-commit' | 'pre-push'): HookFileInspection {
  const relativePath = `.atm/git-hooks/${hookName}`;
  const absolutePath = path.join(cwd, relativePath);
  if (!existsSync(absolutePath)) {
    return { path: relativePath, present: false, markerPresent: false, sha256: null };
  }
  const text = readFileSync(absolutePath, 'utf8');
  return {
    path: relativePath,
    present: true,
    markerPresent: text.includes(hookMarker) && (
      text.includes(`node atm.mjs hook ${hookName}`)
      || text.includes(`node "$runner" hook ${hookName} --json`)
    ),
    sha256: sha256(readFileSync(absolutePath))
  };
}
export function parseGitHooksArgs(argv: string[]): ParsedGitHooksArgs {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedGitHooksArgs['action'] | null,
    frameworkRequired: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      state.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--framework-required') {
      state.frameworkRequired = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    if (arg !== 'install' && arg !== 'verify') {
      throw new CliError('ATM_CLI_USAGE', 'git-hooks supports only: install, verify', { exitCode: 2 });
    }
    state.action = arg;
  }
  if (!state.action) {
    throw new CliError('ATM_CLI_USAGE', 'git-hooks requires an action: install | verify', { exitCode: 2 });
  }
  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    frameworkRequired: state.frameworkRequired
  };
}
export function normalizeGitConfigPath(value: string | null): string | null {
  return value ? value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') : null;
}
