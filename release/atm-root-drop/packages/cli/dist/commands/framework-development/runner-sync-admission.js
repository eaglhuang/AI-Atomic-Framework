import { spawnSync } from 'node:child_process';
export function inspectRunnerSyncAdmission(input) {
    const dirtyFiles = normalizePaths(input.dirtyFiles ?? readGitDirtyFiles(input.cwd));
    const releaseWip = dirtyFiles.filter(isReleasePath);
    const foreignNonReleaseWip = dirtyFiles.filter((file) => !isReleasePath(file));
    return {
        schemaId: 'atm.runnerSyncAdmission.v1',
        ok: foreignNonReleaseWip.length === 0,
        stewardActorId: input.stewardActorId,
        sealedSourceSha: input.sealedSourceSha ?? null,
        runnerSyncSteward: input.runnerSyncSteward ?? null,
        foreignNonReleaseWip,
        releaseWip,
        ordinaryTaskReleaseAutoStageAllowed: false,
        requiredCommand: foreignNonReleaseWip.length > 0
            ? 'commit, stash, or close the foreign non-release WIP before runner sync; do not publish release/** from an ordinary task'
            : null
    };
}
export function assertRunnerSyncAdmission(report) {
    if (!report.ok) {
        const error = new Error(`Runner sync refused foreign non-release WIP: ${report.foreignNonReleaseWip.join(', ')}`);
        Object.assign(error, {
            code: 'ATM_RUNNER_SYNC_FOREIGN_WIP_BLOCKED',
            details: report
        });
        throw error;
    }
}
export function ordinaryTaskCanAutoStageRelease(input) {
    void input;
    return false;
}
function readGitDirtyFiles(cwd) {
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
function normalizePaths(paths) {
    return [...new Set(paths.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))].sort();
}
function isReleasePath(file) {
    return file === 'release' || file.startsWith('release/');
}
