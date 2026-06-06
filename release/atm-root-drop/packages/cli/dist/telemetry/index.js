import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const telemetryConfigRelativePath = path.join('.atm', 'runtime', 'telemetry.json');
export const telemetryAllowedFields = Object.freeze([
    'cliVersion',
    'nodeVersion',
    'osFamily',
    'chartStatus',
    'commandName',
    'result'
]);
export function defaultTelemetryState(now = new Date().toISOString()) {
    return {
        schemaVersion: 'atm.telemetry.v0.1',
        enabled: false,
        endpoint: null,
        updatedAt: now,
        allowedFields: telemetryAllowedFields
    };
}
export function readTelemetryState(cwd) {
    const configPath = path.join(cwd, telemetryConfigRelativePath);
    if (!existsSync(configPath)) {
        return defaultTelemetryState();
    }
    try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
        return normalizeTelemetryState(parsed);
    }
    catch {
        return defaultTelemetryState();
    }
}
export function writeTelemetryState(cwd, state) {
    const configPath = path.join(cwd, telemetryConfigRelativePath);
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return state;
}
export function setTelemetryEnabled(cwd, enabled, endpoint = null, now = new Date().toISOString()) {
    const current = readTelemetryState(cwd);
    return writeTelemetryState(cwd, {
        schemaVersion: 'atm.telemetry.v0.1',
        enabled,
        endpoint: endpoint ?? current.endpoint,
        updatedAt: now,
        allowedFields: telemetryAllowedFields
    });
}
export function createTelemetryPayload(input) {
    return {
        schemaVersion: 'atm.telemetryPayload.v0.1',
        cliVersion: input.cliVersion ?? '0.0.0',
        nodeVersion: process.version,
        osFamily: os.platform(),
        chartStatus: input.chartStatus ?? 'unknown',
        commandName: input.commandName,
        result: input.result
    };
}
export async function recordTelemetryEvent(cwd, payload, sender) {
    const state = readTelemetryState(cwd);
    if (!state.enabled) {
        return { sent: false, reason: 'telemetry-disabled', payload: null };
    }
    await sender(payload, state);
    return { sent: true, reason: 'telemetry-sent', payload };
}
function normalizeTelemetryState(input) {
    return {
        schemaVersion: 'atm.telemetry.v0.1',
        enabled: input.enabled === true,
        endpoint: typeof input.endpoint === 'string' && input.endpoint.length > 0 ? input.endpoint : null,
        updatedAt: typeof input.updatedAt === 'string' && input.updatedAt.length > 0 ? input.updatedAt : new Date().toISOString(),
        allowedFields: telemetryAllowedFields
    };
}
