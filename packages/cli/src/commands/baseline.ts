import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectGitHooks } from './hook.ts';
import { CliError, makeResult, message, readFrameworkVersion, relativePathFrom } from './shared.ts';

type BaselineAction = 'create' | 'status' | 'restore';

interface ParsedBaselineArgs {
  readonly cwd: string;
  readonly action: BaselineAction;
  readonly name: string;
  readonly worktreeOnly: boolean;
  readonly force: boolean;
}

export function runBaseline(argv: string[]) {
  const options = parseBaselineArgs(argv);
  if (options.action === 'create') {
    return runBaselineCreate(options);
  }
  if (options.action === 'status') {
    return runBaselineStatus(options);
  }
  return runBaselineRestore(options);
}

function runBaselineCreate(options: ParsedBaselineArgs) {
  const root = options.cwd;
  const existingCommit = gitScalar(root, ['rev-parse', `${options.name}^{commit}`]);
  const commitSha = existingCommit || gitScalar(root, ['rev-parse', 'HEAD']);
  const shortCommit = gitScalar(root, ['rev-parse', '--short', commitSha]);
  const tagResult = git(root, ['tag', options.name, commitSha]);
  if (tagResult.exitCode !== 0 && !/already exists/i.test(tagResult.stderr)) {
    throw new CliError('ATM_BASELINE_TAG_FAILED', `Could not create baseline tag ${options.name}.`, {
      details: { stderr: tagResult.stderr.trim() }
    });
  }
  const report = createBaselineReport(root, options.name, commitSha);
  const reportPath = baselineReportPath(root, options.name);
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return makeResult({
    ok: true,
    command: 'baseline',
    cwd: root,
    messages: [message('info', 'ATM_BASELINE_CREATED', `Baseline ${options.name} points to ${shortCommit}.`, {
      name: options.name,
      commitSha,
      alreadyTagged: tagResult.exitCode !== 0
    })],
    evidence: {
      action: 'create',
      name: options.name,
      commitSha,
      reportPath: relativePathFrom(root, reportPath),
      report
    }
  });
}

function runBaselineStatus(options: ParsedBaselineArgs) {
  const root = options.cwd;
  const commitSha = resolveBaselineCommit(root, options.name);
  const report = createBaselineReport(root, options.name, commitSha);
  return makeResult({
    ok: report.ok,
    command: 'baseline',
    cwd: root,
    messages: [
      report.ok
        ? message('info', 'ATM_BASELINE_STATUS_OK', `Baseline ${options.name} is healthy.`, report.summary)
        : message('error', 'ATM_BASELINE_STATUS_FAILED', `Baseline ${options.name} is not healthy.`, report.summary)
    ],
    evidence: {
      action: 'status',
      name: options.name,
      commitSha,
      report
    }
  });
}

function runBaselineRestore(options: ParsedBaselineArgs) {
  const root = options.cwd;
  if (!options.worktreeOnly) {
    throw new CliError('ATM_BASELINE_RESTORE_WORKTREE_ONLY_REQUIRED', 'baseline restore requires --worktree-only in v1.', { exitCode: 2 });
  }
  const branch = currentBranch(root);
  if (!options.force && ['main', 'master', 'trunk'].includes(branch)) {
    throw new CliError('ATM_BASELINE_RESTORE_REFUSED_ON_MAIN', 'baseline restore refuses to reset main/master/trunk without --force.', {
      exitCode: 1,
      details: {
        branch,
        saferPath: 'create a redteam/<agent>/<timestamp> branch or disposable worktree first'
      }
    });
  }
  const commitSha = resolveBaselineCommit(root, options.name);
  const reset = git(root, ['reset', '--hard', commitSha]);
  if (reset.exitCode !== 0) {
    throw new CliError('ATM_BASELINE_RESTORE_FAILED', `Could not restore baseline ${options.name}.`, {
      details: { stderr: reset.stderr.trim() }
    });
  }
  return makeResult({
    ok: true,
    command: 'baseline',
    cwd: root,
    messages: [message('info', 'ATM_BASELINE_RESTORED', `Working tree restored to baseline ${options.name}.`, {
      name: options.name,
      commitSha,
      branch
    })],
    evidence: {
      action: 'restore',
      name: options.name,
      commitSha,
      branch,
      resetStdout: reset.stdout.trim()
    }
  });
}

function createBaselineReport(root: string, name: string, commitSha: string) {
  const head = gitScalar(root, ['rev-parse', 'HEAD']);
  const branch = currentBranch(root);
  const porcelain = gitScalar(root, ['status', '--porcelain']);
  const commandRuns = [
    runCommand(root, 'npm run typecheck'),
    runCommand(root, 'npm run validate:cli'),
    runCommand(root, 'node atm.mjs doctor --json')
  ];
  const gitHooks = inspectGitHooks(root, { frameworkRequired: true });
  const ok = head === commitSha
    && porcelain.length === 0
    && gitHooks.ok
    && commandRuns.every((entry) => entry.exitCode === 0);
  return {
    schemaId: 'atm.redteamBaseline.v1',
    generatedAt: new Date().toISOString(),
    name,
    frameworkVersion: readFrameworkVersion(root),
    commitSha,
    head,
    branch,
    summary: {
      headMatchesBaseline: head === commitSha,
      workingTreeClean: porcelain.length === 0,
      gitHooksOk: gitHooks.ok,
      validatorsOk: commandRuns.every((entry) => entry.exitCode === 0)
    },
    gitHooks,
    commandRuns,
    ok
  };
}

function baselineReportPath(root: string, name: string) {
  return path.join(root, '.atm', 'history', 'baselines', `${safeName(name)}.json`);
}

function resolveBaselineCommit(root: string, name: string) {
  const commit = gitScalar(root, ['rev-parse', `${name}^{commit}`]);
  if (!commit) {
    throw new CliError('ATM_BASELINE_NOT_FOUND', `Baseline ${name} was not found as a git tag or commit reference.`, {
      exitCode: 1,
      details: { name }
    });
  }
  return commit;
}

function parseBaselineArgs(argv: string[]): ParsedBaselineArgs {
  const state = {
    cwd: process.cwd(),
    action: null as BaselineAction | null,
    name: null as string | null,
    worktreeOnly: false,
    force: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      state.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--name') {
      state.name = requireValue(argv, index, '--name');
      index += 1;
      continue;
    }
    if (arg === '--worktree-only') {
      state.worktreeOnly = true;
      continue;
    }
    if (arg === '--force') {
      state.force = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `baseline does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'baseline accepts only one action.', { exitCode: 2 });
    }
    if (arg !== 'create' && arg !== 'status' && arg !== 'restore') {
      throw new CliError('ATM_CLI_USAGE', 'baseline supports only: create, status, restore.', { exitCode: 2 });
    }
    state.action = arg;
  }
  if (!state.action) {
    throw new CliError('ATM_CLI_USAGE', 'baseline requires an action: create | status | restore.', { exitCode: 2 });
  }
  if (!state.name) {
    throw new CliError('ATM_CLI_USAGE', 'baseline requires --name <name>.', { exitCode: 2 });
  }
  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    name: state.name,
    worktreeOnly: state.worktreeOnly,
    force: state.force
  };
}

function gitScalar(cwd: string, args: readonly string[]) {
  const result = git(cwd, args);
  return result.exitCode === 0 ? result.stdout.trim() : '';
}

function git(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? '')
  };
}

function runCommand(cwd: string, command: string) {
  const result = spawnSync(command, { cwd, encoding: 'utf8', shell: true });
  return {
    command,
    cwd,
    exitCode: result.status ?? 1,
    stdoutSha256: sha256(String(result.stdout ?? '')),
    stderrSha256: sha256(String(result.stderr ?? result.error?.message ?? '')),
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr || result.error?.message)
  };
}

function currentBranch(root: string) {
  return gitScalar(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'UNKNOWN';
}

function safeName(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'baseline';
}

function sha256(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function preview(value: unknown) {
  return String(value ?? '').slice(0, 800);
}

function requireValue(argv: readonly string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `baseline requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
