// @ts-nocheck
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.js';
import { emptyRunnerSyncStewardQueue } from '../../../../core/dist/broker/runner-sync-steward-queue.js';
import { emptyGeneratedProjectionSteward } from '../../../../core/dist/broker/generated-projection-steward.js';
function readSharedSurfaceFreezeRecords(filePath) {
    if (!existsSync(filePath))
        return [];
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed.records) ? parsed.records : [];
    }
    catch {
        return [];
    }
}
function writeSharedSurfaceFreezeRecords(filePath, records) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify({ schemaId: 'atm.brokerSharedSurfaceFreezes.v1', records }, null, 2)}\n`, 'utf8');
}
function readSharedSurfaceQueues(filePath) {
    if (!existsSync(filePath))
        return [];
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed.queues) ? parsed.queues : [];
    }
    catch {
        return [];
    }
}
function writeSharedSurfaceQueues(filePath, queues) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify({ schemaId: 'atm.brokerSharedSurfaceQueues.v1', queues }, null, 2)}\n`, 'utf8');
}
function readRunnerSyncStewardQueue(filePath) {
    if (!existsSync(filePath))
        return emptyRunnerSyncStewardQueue();
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return emptyRunnerSyncStewardQueue();
    }
}
function writeRunnerSyncStewardQueue(filePath, queue) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}
function toRunnerSyncReleaseCliError(error) {
    const messageText = error instanceof Error ? error.message : String(error ?? '');
    const match = /^(ATM_[A-Z0-9_]+):\s*(.+)$/.exec(messageText);
    if (match) {
        return new CliError(match[1], match[2], { exitCode: 1 });
    }
    return new CliError('ATM_RUNNER_SYNC_STEWARD_RELEASE_FAILED', messageText || 'Runner-sync steward release failed.', { exitCode: 1 });
}
function readGeneratedProjectionSteward(filePath) {
    if (!existsSync(filePath))
        return emptyGeneratedProjectionSteward();
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return emptyGeneratedProjectionSteward();
    }
}
function writeGeneratedProjectionSteward(filePath, queue) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}
export { readSharedSurfaceFreezeRecords, writeSharedSurfaceFreezeRecords, readSharedSurfaceQueues, writeSharedSurfaceQueues, readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward };
