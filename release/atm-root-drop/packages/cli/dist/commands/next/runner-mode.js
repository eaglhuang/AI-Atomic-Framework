import path from 'node:path';
import { describeBuildReleaseHygienePolicy } from '../build-release-hygiene.js';
import { message } from '../shared.js';
export function normalizeRelativePath(root, entryPath) {
    const relative = path.relative(root, entryPath).replace(/\\/g, '/');
    return relative && !relative.startsWith('..') ? relative : entryPath.replace(/\\/g, '/');
}
export function classifyRunnerMode(entrypoint) {
    if (!entrypoint)
        return 'unknown';
    const normalized = entrypoint.replace(/\\/g, '/');
    if (normalized === 'atm.dev.mjs')
        return 'source-first';
    if (normalized === 'atm.mjs'
        || normalized === 'release/atm-onefile/atm.mjs'
        || normalized === 'packages/cli/dist/atm.js'
        || normalized === 'release/atm-root-drop/atm.mjs'
        || normalized.includes('/atm-onefile-cache/')) {
        return 'frozen';
    }
    if (normalized.startsWith('scripts/') || normalized.includes('/scripts/') || normalized.includes('/packages/cli/src/')) {
        return 'source-import';
    }
    return 'unknown';
}
export function describeRunnerMode(cwd) {
    const releaseHygienePolicy = describeBuildReleaseHygienePolicy();
    const root = path.resolve(cwd);
    const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
    const entrypoint = entrypointPath ? normalizeRelativePath(root, entrypointPath) : null;
    const mode = classifyRunnerMode(entrypoint);
    return {
        schemaId: 'atm.runnerMode.v1',
        mode,
        entrypoint,
        normalGovernanceCommand: 'node atm.mjs ...',
        sourceFirstCommand: 'node atm.dev.mjs ...',
        sourceFirstOnlyWhen: 'explicit source-first framework validation is requested for unbuilt source changes',
        syncCommand: releaseHygienePolicy.runnerSyncCommand,
        frozenRunnerSources: [
            'release/atm-onefile/atm.mjs',
            'packages/cli/dist/atm.js'
        ],
        guidance: mode === 'source-first' || mode === 'source-import'
            ? `Use this only for explicit source-first framework validation. Run ${releaseHygienePolicy.runnerSyncCommand} before release-like validation through node atm.mjs.`
            : `Use node atm.mjs for normal governance routing. If ATM_RUNNER_SYNC_REQUIRED appears, run ${releaseHygienePolicy.runnerSyncCommand} and rerun the frozen entrypoint.`
    };
}
export function withRunnerMode(result, cwd) {
    const runnerMode = describeRunnerMode(cwd);
    const evidenceRecord = result.evidence && typeof result.evidence === 'object'
        ? result.evidence
        : null;
    if (evidenceRecord) {
        evidenceRecord.runnerMode = runnerMode;
        const nextActionRecord = evidenceRecord.nextAction && typeof evidenceRecord.nextAction === 'object' && !Array.isArray(evidenceRecord.nextAction)
            ? evidenceRecord.nextAction
            : null;
        if (nextActionRecord) {
            nextActionRecord.runnerMode = runnerMode;
        }
    }
    const importedTaskQueue = evidenceRecord?.importedTaskQueue && typeof evidenceRecord.importedTaskQueue === 'object' && !Array.isArray(evidenceRecord.importedTaskQueue)
        ? evidenceRecord.importedTaskQueue
        : null;
    const planningRootWarnings = importedTaskQueue?.planningRootWarnings;
    if (Array.isArray(planningRootWarnings) && Array.isArray(result.messages)) {
        for (const warning of planningRootWarnings) {
            if (result.messages.some((entry) => {
                const record = entry && typeof entry === 'object' && !Array.isArray(entry)
                    ? entry
                    : null;
                const data = record?.data && typeof record.data === 'object' && !Array.isArray(record.data)
                    ? record.data
                    : null;
                const siblingRepoDirs = Array.isArray(data?.siblingRepoDirs) ? data.siblingRepoDirs : [];
                return record?.code === warning.code && siblingRepoDirs.join(',') === warning.siblingRepoDirs.join(',');
            })) {
                continue;
            }
            result.messages.unshift(message('warning', warning.code, warning.detail, {
                siblingRepoDirs: warning.siblingRepoDirs
            }));
        }
    }
    if (Array.isArray(result.messages) && !result.messages.some((entry) => {
        const record = entry && typeof entry === 'object' && !Array.isArray(entry)
            ? entry
            : null;
        return record?.code === 'ATM_RUNNER_MODE';
    })) {
        result.messages.push(message('info', 'ATM_RUNNER_MODE', `ATM next is running in ${runnerMode.mode} mode.`, runnerMode));
    }
    return result;
}
