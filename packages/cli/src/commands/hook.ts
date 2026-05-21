import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditTasks,
  createFrameworkModeStatus,
  detectFrameworkRepoIdentity,
  isAtmCriticalNonDocSurface
} from './framework-development.ts';
import { gitHeadEvidencePath } from './git-head-evidence.ts';
import { CliError, makeResult, message, readFrameworkVersion, relativePathFrom } from './shared.ts';

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

interface ParsedHookArgs {
  readonly cwd: string;
  readonly action: 'pre-commit' | 'pre-push';
  readonly base: string | null;
  readonly head: string | null;
}

interface ParsedGitHooksArgs {
  readonly cwd: string;
  readonly action: 'install' | 'verify';
  readonly frameworkRequired: boolean;
}

interface ParsedCommitRangeArgs {
  readonly cwd: string;
  readonly base: string;
  readonly head: string;
}

interface CommandRunReport {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
}

interface CommitEvidenceMatch {
  readonly commitSha: string;
  readonly criticalChangedFiles: readonly string[];
  readonly evidencePath: string;
  readonly matched: boolean;
  readonly matchedBy: 'commitSha' | 'treeSha+parentCommitShas' | null;
}

const textFileExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ps1',
  '.sh',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml'
]);

const hookFileNames = ['pre-commit', 'pre-push'] as const;

export function runHook(argv: string[]) {
  const options = parseHookArgs(argv);
  if (options.action === 'pre-commit') {
    return runPreCommitHook(options.cwd);
  }
  return runPrePushHook(options.cwd, options.base, options.head);
}

export function runGitHooks(argv: string[]) {
  const options = parseGitHooksArgs(argv);
  if (options.action === 'install') {
    const installReport = installGitHooks(options.cwd, { frameworkRequired: options.frameworkRequired });
    return makeResult({
      ok: installReport.ok,
      command: 'git-hooks',
      cwd: options.cwd,
      messages: [
        installReport.ok
          ? message('info', 'ATM_GIT_HOOKS_INSTALLED', 'ATM Git hooks are installed and configured.', installReport)
          : message('error', 'ATM_GIT_HOOKS_INSTALL_FAILED', 'ATM Git hooks could not be fully installed.', installReport)
      ],
      evidence: {
        action: 'install',
        report: installReport
      }
    });
  }

  const verifyReport = inspectGitHooks(options.cwd, { frameworkRequired: options.frameworkRequired });
  return makeResult({
    ok: verifyReport.ok,
    command: 'git-hooks',
    cwd: options.cwd,
    messages: [
      verifyReport.ok
        ? message('info', 'ATM_GIT_HOOKS_VERIFY_OK', 'ATM Git hook installation is healthy.', verifyReport)
        : message('error', 'ATM_GIT_HOOKS_VERIFY_FAILED', 'ATM Git hook installation is missing or drifted.', verifyReport)
    ],
    evidence: {
      action: 'verify',
      report: verifyReport
    }
  });
}

export function runCommitRangeGuard(argv: string[]) {
  const options = parseCommitRangeArgs(argv);
  const report = createCommitRangeGuardReport(options.cwd, options.base, options.head);
  return makeResult({
    ok: report.ok,
    command: 'guard',
    cwd: options.cwd,
    messages: [
      report.ok
        ? message('info', 'ATM_GUARD_COMMIT_RANGE_OK', 'Commit range guard passed.', {
          base: options.base,
          head: options.head,
          criticalCommitCount: report.criticalCommits.length
        })
        : message('error', 'ATM_GUARD_COMMIT_RANGE_FAILED', 'Commit range guard found commits that bypassed ATM evidence or task closure gates.', {
          base: options.base,
          head: options.head,
          findings: report.findings
        })
    ],
    evidence: {
      guard: 'commit-range',
      report
    }
  });
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
    writeFileSync(hookPath, createGitHookScript(hookName), 'utf8');
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

function runPreCommitHook(cwd: string) {
  const root = path.resolve(cwd);
  const stagedFiles = readStagedFiles(root).filter((entry) => entry !== gitHeadEvidencePath);
  const encodingReport = scanEncoding(root, stagedFiles);
  const frameworkStatus = createFrameworkModeStatus({ cwd: root, files: stagedFiles });
  const blockingFrameworkIssues = frameworkStatus.blockers.filter((entry) => entry !== 'git-head-evidence-missing');
  const taskAudit = auditTasks(root);
  const commandRuns = frameworkStatus.criticalChangedFiles.length > 0
    ? runRequiredFrameworkValidators(root, frameworkStatus.criticalChangedFiles)
    : [];
  const failedValidatorRuns = commandRuns.filter((entry) => entry.exitCode !== 0);
  const ok = encodingReport.ok
    && blockingFrameworkIssues.length === 0
    && taskAudit.ok
    && failedValidatorRuns.length === 0;
  const evidenceWrite = ok && stagedFiles.length > 0
    ? writeStagedGitHeadEvidence(root, stagedFiles, commandRuns)
    : null;

  return makeResult({
    ok,
    command: 'hook',
    cwd: root,
    messages: [
      ok
        ? message('info', 'ATM_HOOK_PRE_COMMIT_OK', 'ATM pre-commit hook passed and staged git-head evidence when needed.', {
          stagedFileCount: stagedFiles.length,
          criticalChangedFileCount: frameworkStatus.criticalChangedFiles.length,
          evidencePath: evidenceWrite?.evidencePath ?? null
        })
        : message('error', 'ATM_HOOK_PRE_COMMIT_FAILED', 'ATM pre-commit hook blocked this commit.', {
          encodingFindings: encodingReport.findings.length,
          frameworkBlockers: blockingFrameworkIssues,
          taskAuditFindings: taskAudit.findings.length,
          failedValidators: failedValidatorRuns.map((entry) => entry.command)
        })
    ],
    evidence: {
      action: 'pre-commit',
      stagedFiles,
      encodingReport,
      frameworkStatus,
      blockingFrameworkIssues,
      taskAudit,
      commandRuns,
      evidenceWrite
    }
  });
}

function runPrePushHook(cwd: string, base: string | null, head: string | null) {
  const root = path.resolve(cwd);
  const resolvedHead = head ?? 'HEAD';
  const resolvedBase = base ?? resolveDefaultPushBase(root);
  if (!resolvedBase) {
    return makeResult({
      ok: true,
      command: 'hook',
      cwd: root,
      messages: [message('warning', 'ATM_HOOK_PRE_PUSH_BASE_UNRESOLVED', 'ATM pre-push hook could not resolve a base ref; commit-range guard was skipped.')],
      evidence: {
        action: 'pre-push',
        base,
        head: resolvedHead,
        skipped: true
      }
    });
  }
  const report = createCommitRangeGuardReport(root, resolvedBase, resolvedHead);
  return makeResult({
    ok: report.ok,
    command: 'hook',
    cwd: root,
    messages: [
      report.ok
        ? message('info', 'ATM_HOOK_PRE_PUSH_OK', 'ATM pre-push commit-range guard passed.', {
          base: resolvedBase,
          head: resolvedHead,
          criticalCommitCount: report.criticalCommits.length
        })
        : message('error', 'ATM_HOOK_PRE_PUSH_FAILED', 'ATM pre-push commit-range guard blocked this push.', {
          base: resolvedBase,
          head: resolvedHead,
          findings: report.findings
        })
    ],
    evidence: {
      action: 'pre-push',
      report
    }
  });
}

function createCommitRangeGuardReport(cwd: string, base: string, head: string) {
  const root = path.resolve(cwd);
  const repoIdentity = detectFrameworkRepoIdentity(root);
  const changedFiles = runGitLines(root, ['diff', '--name-only', `${base}..${head}`]).map(normalizeRelativePath);
  const criticalChangedFiles = repoIdentity.isFrameworkRepo
    ? changedFiles.filter(isAtmCriticalNonDocSurface)
    : [];
  const commits = repoIdentity.isFrameworkRepo
    ? runGitLines(root, ['rev-list', '--reverse', `${base}..${head}`])
    : [];
  const criticalCommits = commits
    .map((commitSha) => ({
      commitSha,
      criticalChangedFiles: readCommitChangedFiles(root, commitSha).filter(isAtmCriticalNonDocSurface)
    }))
    .filter((entry) => entry.criticalChangedFiles.length > 0);
  const evidenceMatches = criticalCommits.map((entry) => inspectCommitGitHeadEvidence(root, entry.commitSha, entry.criticalChangedFiles));
  const taskAudit = auditTasks(root);
  const findings = [
    ...evidenceMatches
      .filter((entry) => !entry.matched)
      .map((entry) => ({
        level: 'error' as const,
        code: 'ATM_COMMIT_RANGE_GIT_HEAD_EVIDENCE_MISSING',
        commitSha: entry.commitSha,
        detail: `Critical framework commit ${entry.commitSha} has no matching git-head evidence.`
      })),
    ...taskAudit.findings
      .filter((entry) => entry.level === 'error')
      .map((entry) => ({
        level: 'error' as const,
        code: entry.code,
        commitSha: null,
        detail: entry.detail
      }))
  ];
  return {
    schemaId: 'atm.commitRangeGuardReport.v1',
    generatedAt: new Date().toISOString(),
    base,
    head,
    repoIdentity,
    changedFiles,
    criticalChangedFiles,
    criticalCommits,
    evidenceMatches,
    taskAudit,
    findings,
    ok: findings.length === 0
  };
}

function runRequiredFrameworkValidators(cwd: string, criticalChangedFiles: readonly string[]): readonly CommandRunReport[] {
  if (criticalChangedFiles.length === 0) return [];
  const commands: Array<readonly [string, readonly string[]]> = [
    ['npm', ['run', 'typecheck']]
  ];
  if (criticalChangedFiles.some((entry) => /^(packages\/cli|scripts|atm\.mjs|templates|integrations)\//.test(entry) || entry === 'atm.mjs')) {
    commands.push(['npm', ['run', 'validate:cli']]);
  }
  if (criticalChangedFiles.some((entry) => /^(templates|integrations)\//.test(entry))) {
    commands.push(['npm', ['run', 'validate:integration-adapter']]);
  }
  return commands.map(([command, args]) => runCommandForReport(cwd, command, args));
}

function runCommandForReport(cwd: string, command: string, args: readonly string[]): CommandRunReport {
  const result = spawnSync(command, [...args], { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  const stdout = String(result.stdout ?? '');
  const stderr = [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n');
  return {
    command: [command, ...args].join(' '),
    cwd,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    stdoutPreview: stdout.slice(-2000),
    stderrPreview: stderr.slice(-2000)
  };
}

function readStagedFiles(cwd: string): readonly string[] {
  return uniqueSorted(runGitLines(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'])
    .map(normalizeRelativePath)
    .filter(Boolean));
}

function scanEncoding(cwd: string, files: readonly string[]) {
  const findings: Array<{ readonly file: string; readonly issue: string }> = [];
  for (const file of files) {
    if (!isTextFile(file)) continue;
    const absolutePath = path.join(cwd, file);
    if (!existsSync(absolutePath)) continue;
    const buffer = readFileSync(absolutePath);
    const text = buffer.toString('utf8');
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      findings.push({ file, issue: 'utf8-bom' });
    }
    if (text.includes('\uFFFD')) {
      findings.push({ file, issue: 'replacement-character' });
    }
    if (/[\u00c3\u00e2\u00e5].|\u749d.|\u7587.|\u765f./.test(text)) {
      findings.push({ file, issue: 'possible-mojibake' });
    }
  }
  return {
    schemaId: 'atm.encodingHookReport.v1',
    inspectedFileCount: files.filter(isTextFile).length,
    findings,
    ok: findings.length === 0
  };
}

function writeStagedGitHeadEvidence(cwd: string, stagedFiles: readonly string[], commandRuns: readonly CommandRunReport[]) {
  const treeSha = readStagedTreeWithoutEvidence(cwd);
  const parentCommitShas = readCurrentHeadForFutureCommit(cwd);
  const generatedAt = new Date().toISOString();
  const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
  mkdirSync(path.dirname(evidenceAbsolute), { recursive: true });
  const payload = {
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Git commit tree is covered by ATM Integration Hook Contract v1.',
        artifactPaths: [],
        createdAt: generatedAt,
        producedBy: hookProvider,
        commandRuns,
        details: {
          git: {
            treeSha,
            parentCommitShas,
            stagedPathCount: stagedFiles.length,
            evidencePath: gitHeadEvidencePath,
            generatedAt
          },
          hookContractVersion,
          runnerVersion: readFrameworkVersion(cwd)
        }
      }
    ]
  };
  writeFileSync(evidenceAbsolute, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const addResult = runGit(cwd, ['add', '--', gitHeadEvidencePath]);
  return {
    evidencePath: gitHeadEvidencePath,
    treeSha,
    parentCommitShas,
    gitAddExitCode: addResult.exitCode,
    ok: addResult.exitCode === 0
  };
}

function readStagedTreeWithoutEvidence(cwd: string): string | null {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-index-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    const gitIndexPath = runGitScalar(cwd, ['rev-parse', '--git-path', 'index']);
    if (gitIndexPath) {
      const absoluteIndex = path.resolve(cwd, gitIndexPath);
      if (existsSync(absoluteIndex)) {
        writeFileSync(tempIndex, readFileSync(absoluteIndex));
      }
    }
    runGit(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', gitHeadEvidencePath], { GIT_INDEX_FILE: tempIndex });
    const tree = runGit(cwd, ['write-tree'], { GIT_INDEX_FILE: tempIndex });
    return tree.exitCode === 0 ? tree.stdout.trim() : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function inspectCommitGitHeadEvidence(cwd: string, commitSha: string, criticalChangedFiles: readonly string[]): CommitEvidenceMatch {
  const evidenceText = runGitScalar(cwd, ['show', `${commitSha}:${gitHeadEvidencePath}`]);
  const evidence = evidenceText ? readJsonText(evidenceText) : null;
  const records = extractEvidenceRecords(evidence);
  const commitTreeSha = runGitScalar(cwd, ['rev-parse', `${commitSha}^{tree}`]);
  const governedTreeSha = readCommitTreeWithoutEvidence(cwd, commitSha);
  const parentCommitShas = readParentCommitShas(cwd, commitSha);
  for (const record of records) {
    const git = normalizeGitDetails(record?.details?.git);
    if (!git) continue;
    if (git.commitSha === commitSha) {
      return {
        commitSha,
        criticalChangedFiles,
        evidencePath: gitHeadEvidencePath,
        matched: true,
        matchedBy: 'commitSha'
      };
    }
    if (git.treeSha && (git.treeSha === governedTreeSha || git.treeSha === commitTreeSha) && sameStringSet(git.parentCommitShas, parentCommitShas)) {
      return {
        commitSha,
        criticalChangedFiles,
        evidencePath: gitHeadEvidencePath,
        matched: true,
        matchedBy: 'treeSha+parentCommitShas'
      };
    }
  }
  return {
    commitSha,
    criticalChangedFiles,
    evidencePath: gitHeadEvidencePath,
    matched: false,
    matchedBy: null
  };
}

function readCommitTreeWithoutEvidence(cwd: string, commitSha: string): string | null {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-range-index-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    const readTree = runGit(cwd, ['read-tree', commitSha], { GIT_INDEX_FILE: tempIndex });
    if (readTree.exitCode !== 0) return null;
    runGit(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', gitHeadEvidencePath], { GIT_INDEX_FILE: tempIndex });
    const tree = runGit(cwd, ['write-tree'], { GIT_INDEX_FILE: tempIndex });
    return tree.exitCode === 0 ? tree.stdout.trim() : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readCommitChangedFiles(cwd: string, commitSha: string): readonly string[] {
  const args = hasParent(cwd, commitSha)
    ? ['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha]
    : ['show', '--name-only', '--format=', '--root', commitSha];
  return runGitLines(cwd, args).map(normalizeRelativePath).filter(Boolean);
}

function hasParent(cwd: string, commitSha: string): boolean {
  return readParentCommitShas(cwd, commitSha).length > 0;
}

function readParentCommitShas(cwd: string, commitSha: string): readonly string[] {
  const row = runGitScalar(cwd, ['rev-list', '--parents', '-n', '1', commitSha]);
  return row ? row.split(/\s+/).slice(1).filter(Boolean) : [];
}

function readCurrentHeadForFutureCommit(cwd: string): readonly string[] {
  const head = runGitScalar(cwd, ['rev-parse', '--verify', 'HEAD']);
  return head ? [head] : [];
}

function resolveDefaultPushBase(cwd: string): string | null {
  const upstream = runGitScalar(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstream) return upstream;
  const parent = runGitScalar(cwd, ['rev-parse', '--verify', 'HEAD~1']);
  return parent ?? null;
}

function createGitHookScript(hookName: 'pre-commit' | 'pre-push') {
  const command = hookName === 'pre-commit'
    ? 'node atm.mjs hook pre-commit --json'
    : 'node atm.mjs hook pre-push --json';
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

function inspectHookFile(cwd: string, hookName: 'pre-commit' | 'pre-push'): HookFileInspection {
  const relativePath = `.atm/git-hooks/${hookName}`;
  const absolutePath = path.join(cwd, relativePath);
  if (!existsSync(absolutePath)) {
    return { path: relativePath, present: false, markerPresent: false, sha256: null };
  }
  const text = readFileSync(absolutePath, 'utf8');
  return {
    path: relativePath,
    present: true,
    markerPresent: text.includes(hookMarker) && text.includes(`node atm.mjs hook ${hookName}`),
    sha256: sha256(readFileSync(absolutePath))
  };
}

function parseHookArgs(argv: string[]): ParsedHookArgs {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedHookArgs['action'] | null,
    base: null as string | null,
    head: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      state.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--base') {
      state.base = requireValue(argv, index, '--base');
      index += 1;
      continue;
    }
    if (arg === '--head') {
      state.head = requireValue(argv, index, '--head');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    if (arg !== 'pre-commit' && arg !== 'pre-push') {
      throw new CliError('ATM_CLI_USAGE', 'hook supports only: pre-commit, pre-push', { exitCode: 2 });
    }
    state.action = arg;
  }
  if (!state.action) {
    throw new CliError('ATM_CLI_USAGE', 'hook requires an action: pre-commit | pre-push', { exitCode: 2 });
  }
  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    base: state.base,
    head: state.head
  };
}

function parseGitHooksArgs(argv: string[]): ParsedGitHooksArgs {
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

function parseCommitRangeArgs(argv: string[]): ParsedCommitRangeArgs {
  const state = {
    cwd: process.cwd(),
    base: null as string | null,
    head: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === 'commit-range') {
      continue;
    }
    if (arg === '--cwd' || arg === '--repo') {
      state.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--base') {
      state.base = requireValue(argv, index, '--base');
      index += 1;
      continue;
    }
    if (arg === '--head') {
      state.head = requireValue(argv, index, '--head');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    throw new CliError('ATM_CLI_USAGE', `guard commit-range does not support argument ${arg}`, { exitCode: 2 });
  }
  if (!state.base || !state.head) {
    throw new CliError('ATM_CLI_USAGE', 'guard commit-range requires --base <ref> and --head <ref>.', { exitCode: 2 });
  }
  return {
    cwd: path.resolve(state.cwd),
    base: state.base,
    head: state.head
  };
}

function isTextFile(filePath: string): boolean {
  return textFileExtensions.has(path.extname(filePath).toLowerCase())
    || path.basename(filePath).includes('AGENTS')
    || path.basename(filePath).includes('README');
}

function extractEvidenceRecords(value: unknown): readonly any[] {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === 'object');
  if (!value || typeof value !== 'object') return [];
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.evidence)) return candidate.evidence.filter((entry) => entry && typeof entry === 'object');
  return candidate.evidenceKind || candidate.details ? [candidate] : [];
}

function normalizeGitDetails(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  return {
    commitSha: typeof candidate.commitSha === 'string' ? candidate.commitSha.trim() : null,
    treeSha: typeof candidate.treeSha === 'string' ? candidate.treeSha.trim() : null,
    parentCommitShas: Array.isArray(candidate.parentCommitShas)
      ? candidate.parentCommitShas.map((entry) => String(entry).trim()).filter(Boolean)
      : []
  };
}

function readJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function runGitLines(cwd: string, args: readonly string[]): readonly string[] {
  const result = runGit(cwd, args);
  if (result.exitCode !== 0) return [];
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function runGitScalar(cwd: string, args: readonly string[]): string | null {
  const result = runGit(cwd, args);
  return result.exitCode === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : null;
}

function runGit(cwd: string, args: readonly string[], env: Record<string, string> = {}) {
  const result = spawnSync('git', [...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout ?? ''),
    stderr: [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n')
  };
}

function normalizeGitConfigPath(value: string | null): string | null {
  return value ? value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') : null;
}

function normalizeRelativePath(value: string): string {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  const normalize = (values: readonly string[]) => [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `hook command requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}
