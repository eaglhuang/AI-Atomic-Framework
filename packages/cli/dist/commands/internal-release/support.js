import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
export function createSkipMatcher(skips, cwd) {
    const normalized = skips.map((entry) => ({
        raw: entry,
        name: entry.trim().toLowerCase(),
        path: path.resolve(cwd, entry).toLowerCase()
    }));
    return (repoPath) => {
        const resolved = path.resolve(repoPath).toLowerCase();
        const name = path.basename(repoPath).toLowerCase();
        const match = normalized.find((entry) => entry.name === name || entry.path === resolved);
        return match ? `matched --skip ${match.raw}` : null;
    };
}
export function normalizePaths(paths) {
    return [...new Set(paths.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))].sort();
}
export function normalizeActiveCaptains(values) {
    return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort();
}
export function normalizeOptionalText(value) {
    const text = String(value ?? '').trim();
    return text ? text : null;
}
export function readActiveReleaseCaptainsFromEnv(stewardActorId) {
    const raw = process.env.ATM_RELEASE_ARTIFACT_OWNERS ?? process.env.ATM_RELEASE_ARTIFACT_CAPTAINS ?? '';
    const owners = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
    return owners.length > 0 ? owners : [stewardActorId];
}
export function runNodeAtm(cwd, args) {
    return runCommand(cwd, process.execPath, ['atm.mjs', ...args]);
}
export function runCommand(cwd, command, args) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    const stdout = result.stdout ?? '';
    const stderr = [result.stderr ?? '', result.error?.message ?? ''].filter(Boolean).join('\n');
    return {
        command: [path.basename(command), ...args].join(' '),
        cwd,
        exitCode: result.status ?? 1,
        stdoutSha256: sha256Text(stdout),
        stderrSha256: sha256Text(stderr),
        ok: !result.error && result.status === 0
    };
}
export function readGitScalar(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return !result.error && result.status === 0 ? result.stdout.trim() : null;
}
export function readGitDirtyFiles(cwd) {
    const result = spawnSync('git', ['status', '--porcelain'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0 || result.error)
        return [];
    return result.stdout
        .split(/\r?\n/)
        .map((line) => line.length >= 4 ? line.slice(3).trim() : '')
        .map((entry) => entry.includes(' -> ') ? entry.split(' -> ').at(-1) ?? entry : entry)
        .filter(Boolean);
}
export function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
    }
    return value;
}
export function sha256File(filePath) {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
export function sha256Text(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
