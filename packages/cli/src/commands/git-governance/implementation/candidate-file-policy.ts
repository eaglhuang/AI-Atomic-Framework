import { execFileSync } from 'node:child_process';
import { closeSync, lstatSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CliError } from '../../shared.ts';
import { createSanitizedGitEnv, resolveGitExecutable } from './git-process-port.ts';

export interface CandidateFilePolicy {
  /** Only exact file declarations authorize ignored files and symlinks. */
  readonly declaredPaths?: readonly string[];
  readonly scopePaths?: readonly string[];
  readonly readOnlyPaths?: readonly string[];
}

export function candidateGit(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv, input?: string): string {
  const dir = input === undefined ? null : mkdtempSync(path.join(os.tmpdir(), 'atm-candidate-input-'));
  let fd: number | undefined;
  try {
    if (dir) { const file = path.join(dir, 'paths'); writeFileSync(file, input!); fd = openSync(file, 'r'); }
    return execFileSync(resolveGitExecutable(), [...args], {
      cwd, env: createSanitizedGitEnv({ ...env, GIT_LITERAL_PATHSPECS: args[0] === 'check-ignore' ? '0' : '1', GIT_GLOB_PATHSPECS: '0', GIT_NOGLOB_PATHSPECS: '0', GIT_ICASE_PATHSPECS: '0' }),
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: [fd ?? 'ignore', 'pipe', 'pipe']
    });
  } finally { if (fd !== undefined) closeSync(fd); if (dir) rmSync(dir, { recursive: true, force: true }); }

}

export const nulPaths = (output: string): string[] => output.split('\0').filter(Boolean);

export function ignoredCandidatePaths(cwd: string, paths: readonly string[]): Set<string> {
  if (!paths.length) return new Set();
  try { return new Set(nulPaths(candidateGit(cwd, ['check-ignore', '--stdin', '-z', '--no-index'], undefined, `${paths.join('\0')}\0`))); }
  catch (error) { if ((error as { status?: number }).status === 1) return new Set(); throw error; }

}

function stat(file: string) { try { return lstatSync(file); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code))) return null; throw error; } }

/** Declarations are patterns only at discovery; all Git writes receive literal files. */
export function matchesCandidateScope(file: string, scope: string): boolean {
  const root = scope.replace(/\/\*\*$/, '').replace(/\/$/, '');
  if (file === root || file.startsWith(`${root}/`)) return true;
  const expression = scope.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
  return new RegExp(`^${expression}$`, 'u').test(file);
}

export function isDeclaredCandidate(file: string, policy: CandidateFilePolicy, cwd?: string): boolean {
  return Boolean(policy.declaredPaths?.includes(file))
    && withinCandidateBoundary(file, policy, cwd);
}

function withinCandidateBoundary(file: string, policy: CandidateFilePolicy, cwd?: string): boolean {
  return (policy.scopePaths === undefined || policy.scopePaths.some((scope) => matchesCandidateScope(file, scope)))
    && !policy.readOnlyPaths?.some((scope) => matchesCandidateScope(file, cwd && path.isAbsolute(scope) ? path.relative(cwd, scope).split(path.sep).join('/') : scope));
}

export function safeCandidatePath(cwd: string, file: string, gitlinks: ReadonlySet<string>): boolean {
  if (!file || path.isAbsolute(file) || file.includes('\0') || file.split('/').some((part) => part === '..' || part === '.git')) return false;
  const parts = file.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const relative = parts.slice(0, i).join('/');
    const info = stat(path.join(cwd, relative));
    if (gitlinks.has(relative) || (info?.isSymbolicLink() && i < parts.length)) return false;
    if (info?.isDirectory() && stat(path.join(cwd, relative, '.git'))) return false;
  }
  return true;
}

export function candidateGitlinks(cwd: string, env?: NodeJS.ProcessEnv, baseRef = 'HEAD'): Set<string> {
  return new Set(nulPaths(candidateGit(cwd, ['ls-tree', '-rz', baseRef], env))
    .filter((record) => record.startsWith('160000 ')).map((record) => record.slice(record.indexOf('\t') + 1)));
}

export function resolveCandidateFiles(cwd: string, candidates: readonly string[], policy: CandidateFilePolicy = {}, env?: NodeJS.ProcessEnv): string[] {
  policy = { ...policy, readOnlyPaths: policy.readOnlyPaths?.map((scope) => path.isAbsolute(scope) ? path.relative(cwd, scope).split(path.sep).join('/') : scope) };
  const tracked = [...new Set([...nulPaths(candidateGit(cwd, ['ls-files', '-z'], env)), ...nulPaths(candidateGit(cwd, ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], env))])];
  const gitlinks = candidateGitlinks(cwd, env);
  const files = new Set<string>();
  const visit = (file: string) => {
    if (!safeCandidatePath(cwd, file, gitlinks)) return;
    if (policy.scopePaths && !policy.scopePaths.some((scope) => matchesCandidateScope(file, scope)) && !stat(path.join(cwd, file))?.isDirectory()) return;
    if (policy.readOnlyPaths?.some((scope) => matchesCandidateScope(file, scope))) return;
    const info = stat(path.join(cwd, file));
    if (info?.isDirectory()) { for (const child of readdirSync(path.join(cwd, file))) visit(`${file}/${child}`); }
    else if (info?.isFile() || (info?.isSymbolicLink() && isDeclaredCandidate(file, policy, cwd)) || (!info && tracked.includes(file))) files.add(file);
  };
  for (const candidate of candidates) {
    const literal = Boolean(stat(path.join(cwd, candidate))) || tracked.includes(candidate) || Boolean(policy.declaredPaths?.includes(candidate));
    if (literal) visit(candidate);
    else if (/[*?[]/.test(candidate)) {
      const prefix = candidate.slice(0, candidate.search(/[*?[]/));
      const root = prefix.slice(0, prefix.lastIndexOf('/'));
      const discover = (dir: string) => {
        if (dir && !safeCandidatePath(cwd, dir, gitlinks)) return;
        for (const child of readdirSync(path.join(cwd, dir))) {
          const file = dir ? `${dir}/${child}` : child;
          if (matchesCandidateScope(file, candidate)) visit(file);
          else if (stat(path.join(cwd, file))?.isDirectory() && safeCandidatePath(cwd, file, gitlinks)) discover(file);
        }
      };
      if (stat(path.join(cwd, root || '.'))?.isDirectory()) discover(root);
    } else visit(candidate);
    for (const file of tracked) if (literal ? file === candidate || file.startsWith(`${candidate}/`) : matchesCandidateScope(file, candidate)) visit(file);
  }
  const ignored = ignoredCandidatePaths(cwd, [...files]);
  return [...files].filter((file) => !ignored.has(file) || isDeclaredCandidate(file, policy, cwd) || !stat(path.join(cwd, file))).sort();
}

export function stageExactCandidateFiles(cwd: string, files: readonly string[], env?: NodeJS.ProcessEnv): void {
  if (files.some((file) => stat(path.join(cwd, file))?.isDirectory())) throw new CliError('ATM_COMMIT_DIRECTORY_PATHSPEC', 'Candidate staging requires exact file paths.', { exitCode: 1 });
  if (files.length) candidateGit(cwd, ['add', '-A', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], env, `${files.join('\0')}\0`);
}

export function assertFinalCandidateIndex(cwd: string, env: NodeJS.ProcessEnv, policy: CandidateFilePolicy = {}, baseRef = 'HEAD'): void {
  const changed = nulPaths(candidateGit(cwd, ['diff', '--cached', '--name-only', '--no-renames', '-z', baseRef], env));
  const outsideBoundary = changed.filter((file) => !withinCandidateBoundary(file, policy, cwd));
  if (outsideBoundary.length) throw new CliError('ATM_COMMIT_CANDIDATE_SCOPE_VIOLATION', 'Final candidate index violates scope or read-only paths.', { exitCode: 1, details: { paths: outsideBoundary } });
  const present = nulPaths(candidateGit(cwd, ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMRT', '-z', baseRef], env));
  const ignored = ignoredCandidatePaths(cwd, present);
  const gitlinks = candidateGitlinks(cwd, env, baseRef);
  const indexed = nulPaths(candidateGit(cwd, ['ls-files', '-s', '-z'], env));
  for (const record of indexed) if (record.startsWith('160000 ')) gitlinks.add(record.slice(record.indexOf('\t') + 1));
  const symlinks = new Set(indexed.filter((record) => record.startsWith('120000 ')).map((record) => record.slice(record.indexOf('\t') + 1)));
  const bad = present.filter((file) => ((ignored.has(file) || symlinks.has(file)) && !isDeclaredCandidate(file, policy, cwd)) || !safeCandidatePath(cwd, file, gitlinks));
  if (bad.length) throw new CliError('ATM_COMMIT_UNDECLARED_IGNORED_PATH', 'Final candidate index contains undeclared ignored or unsafe paths.', { exitCode: 1, details: { paths: bad } });
}
