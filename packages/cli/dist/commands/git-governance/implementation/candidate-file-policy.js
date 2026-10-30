import { assertActiveCloseLease } from '../../taskflow/close-transaction-mutex.js';
import { execFileSync } from 'node:child_process';
import { closeSync, lstatSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CliError } from '../../shared.js';
import { createSanitizedGitEnv, resolveGitExecutable } from './git-process-port.js';
export function candidateGit(cwd, args, env, input) {
    assertActiveCloseLease();
    const dir = input === undefined ? null : mkdtempSync(path.join(os.tmpdir(), 'atm-candidate-input-'));
    let fd;
    try {
        if (dir) {
            const file = path.join(dir, 'paths');
            writeFileSync(file, input);
            fd = openSync(file, 'r');
        }
        return execFileSync(resolveGitExecutable(), [...args], {
            cwd, env: createSanitizedGitEnv({ ...env, GIT_LITERAL_PATHSPECS: args[0] === 'check-ignore' ? '0' : '1', GIT_GLOB_PATHSPECS: '0', GIT_NOGLOB_PATHSPECS: '0', GIT_ICASE_PATHSPECS: '0' }),
            encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: [fd ?? 'ignore', 'pipe', 'pipe']
        });
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
        if (dir)
            rmSync(dir, { recursive: true, force: true });
    }
}
export const nulPaths = (output) => output.split('\0').filter(Boolean);
function hasCandidateHead(cwd, env) {
    try {
        candidateGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], env);
        return true;
    }
    catch (error) {
        if (error.status === 1)
            return false;
        throw error;
    }
}
export function ignoredCandidatePaths(cwd, paths) {
    if (!paths.length)
        return new Set();
    try {
        return new Set(nulPaths(candidateGit(cwd, ['check-ignore', '--stdin', '-z', '--no-index'], undefined, `${paths.join('\0')}\0`)));
    }
    catch (error) {
        if (error.status === 1)
            return new Set();
        throw error;
    }
}
function stat(file) { try {
    return lstatSync(file);
}
catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(String(error.code)))
        return null;
    throw error;
} }
/** Declarations are patterns only at discovery; all Git writes receive literal files. */
export function matchesCandidateScope(file, scope) {
    const root = scope.replace(/\/\*\*$/, '').replace(/\/$/, '');
    if (file === root || file.startsWith(`${root}/`))
        return true;
    const expression = scope.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002')
        .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
        .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
    return new RegExp(`^${expression}$`, 'u').test(file);
}
export function isDeclaredCandidate(file, policy, cwd) {
    return Boolean(policy.declaredPaths?.includes(file))
        && withinCandidateBoundary(file, policy, cwd);
}
function withinCandidateBoundary(file, policy, cwd) {
    return (policy.scopePaths === undefined || policy.scopePaths.some((scope) => matchesCandidateScope(file, scope)))
        && !policy.readOnlyPaths?.some((scope) => matchesCandidateScope(file, cwd && path.isAbsolute(scope) ? path.relative(cwd, scope).split(path.sep).join('/') : scope));
}
export function safeCandidatePath(cwd, file, gitlinks) {
    if (!file || path.isAbsolute(file) || file.includes('\0') || file.split('/').some((part) => part === '..' || part === '.git'))
        return false;
    const parts = file.split('/');
    for (let i = 1; i <= parts.length; i++) {
        const relative = parts.slice(0, i).join('/');
        const info = stat(path.join(cwd, relative));
        if (gitlinks.has(relative) || (info?.isSymbolicLink() && i < parts.length))
            return false;
        if (info?.isDirectory() && stat(path.join(cwd, relative, '.git')))
            return false;
    }
    return true;
}
export function candidateGitlinks(cwd, env, baseRef = 'HEAD') {
    const args = baseRef === 'HEAD' && !hasCandidateHead(cwd, env) ? ['ls-files', '-s', '-z'] : ['ls-tree', '-rz', baseRef];
    return new Set(nulPaths(candidateGit(cwd, args, env))
        .filter((record) => record.startsWith('160000 ')).map((record) => record.slice(record.indexOf('\t') + 1)));
}
export function resolveCandidateFiles(cwd, candidates, policy = {}, env) {
    policy = { ...policy, readOnlyPaths: policy.readOnlyPaths?.map((scope) => path.isAbsolute(scope) ? path.relative(cwd, scope).split(path.sep).join('/') : scope) };
    const headFiles = hasCandidateHead(cwd, env) ? nulPaths(candidateGit(cwd, ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], env)) : [];
    const tracked = [...new Set([...nulPaths(candidateGit(cwd, ['ls-files', '-z'], env)), ...headFiles])];
    const gitlinks = candidateGitlinks(cwd, env);
    const files = new Set();
    const visit = (file) => {
        if (!safeCandidatePath(cwd, file, gitlinks))
            return;
        if (policy.scopePaths && !policy.scopePaths.some((scope) => matchesCandidateScope(file, scope)) && !stat(path.join(cwd, file))?.isDirectory())
            return;
        if (policy.readOnlyPaths?.some((scope) => matchesCandidateScope(file, scope)))
            return;
        const info = stat(path.join(cwd, file));
        if (info?.isDirectory()) {
            for (const child of readdirSync(path.join(cwd, file)))
                visit(`${file}/${child}`);
        }
        else if (info?.isFile() || (info?.isSymbolicLink() && isDeclaredCandidate(file, policy, cwd)) || (!info && tracked.includes(file)))
            files.add(file);
    };
    for (const candidate of candidates) {
        const literal = Boolean(stat(path.join(cwd, candidate))) || tracked.includes(candidate) || Boolean(policy.declaredPaths?.includes(candidate));
        if (literal)
            visit(candidate);
        else if (/[*?[]/.test(candidate)) {
            const prefix = candidate.slice(0, candidate.search(/[*?[]/));
            const root = prefix.slice(0, prefix.lastIndexOf('/'));
            const discover = (dir) => {
                if (dir && !safeCandidatePath(cwd, dir, gitlinks))
                    return;
                for (const child of readdirSync(path.join(cwd, dir))) {
                    const file = dir ? `${dir}/${child}` : child;
                    if (matchesCandidateScope(file, candidate))
                        visit(file);
                    else if (stat(path.join(cwd, file))?.isDirectory() && safeCandidatePath(cwd, file, gitlinks))
                        discover(file);
                }
            };
            if (stat(path.join(cwd, root || '.'))?.isDirectory())
                discover(root);
        }
        else
            visit(candidate);
        for (const file of tracked)
            if (literal ? file === candidate || file.startsWith(`${candidate}/`) : matchesCandidateScope(file, candidate))
                visit(file);
    }
    // `check-ignore --no-index` also matches tracked files (e.g. committed
    // packages/cli/dist under `dist/`); Git itself never ignores tracked paths.
    const trackedSet = new Set(tracked);
    const ignored = ignoredCandidatePaths(cwd, [...files]);
    return [...files].filter((file) => !ignored.has(file) || trackedSet.has(file) || isDeclaredCandidate(file, policy, cwd) || !stat(path.join(cwd, file))).sort();
}
export function stageExactCandidateFiles(cwd, files, env) {
    if (files.some((file) => stat(path.join(cwd, file))?.isDirectory()))
        throw new CliError('ATM_COMMIT_DIRECTORY_PATHSPEC', 'Candidate staging requires exact file paths.', { exitCode: 1 });
    if (files.length)
        candidateGit(cwd, ['add', '-A', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], env, `${files.join('\0')}\0`);
}
export function assertFinalCandidateIndex(cwd, env, policy = {}, baseRef = 'HEAD') {
    const changed = nulPaths(candidateGit(cwd, ['diff', '--cached', '--name-only', '--no-renames', '-z', baseRef], env));
    const outsideBoundary = changed.filter((file) => !withinCandidateBoundary(file, policy, cwd));
    if (outsideBoundary.length)
        throw new CliError('ATM_COMMIT_CANDIDATE_SCOPE_VIOLATION', 'Final candidate index violates scope or read-only paths.', { exitCode: 1, details: { paths: outsideBoundary } });
    const present = nulPaths(candidateGit(cwd, ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMRT', '-z', baseRef], env));
    const ignored = ignoredCandidatePaths(cwd, present);
    const gitlinks = candidateGitlinks(cwd, env, baseRef);
    const indexed = nulPaths(candidateGit(cwd, ['ls-files', '-s', '-z'], env));
    for (const record of indexed)
        if (record.startsWith('160000 '))
            gitlinks.add(record.slice(record.indexOf('\t') + 1));
    const symlinks = new Set(indexed.filter((record) => record.startsWith('120000 ')).map((record) => record.slice(record.indexOf('\t') + 1)));
    // Only newly added ignored paths need an exact declaration; a modified
    // path is already tracked at baseRef, so Git does not ignore it.
    const added = new Set(nulPaths(candidateGit(cwd, ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=A', '-z', baseRef], env)));
    const bad = present.filter((file) => (((ignored.has(file) && added.has(file)) || symlinks.has(file)) && !isDeclaredCandidate(file, policy, cwd)) || !safeCandidatePath(cwd, file, gitlinks));
    if (bad.length)
        throw new CliError('ATM_COMMIT_UNDECLARED_IGNORED_PATH', 'Final candidate index contains undeclared ignored or unsafe paths.', { exitCode: 1, details: { paths: bad } });
}
