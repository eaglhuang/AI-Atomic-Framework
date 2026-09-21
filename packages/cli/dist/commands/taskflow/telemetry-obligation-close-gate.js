import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildGateTelemetryTaskSummary } from '../../_vendor/core/dist/telemetry/index.js';
import { evaluateTelemetryObligationSeal } from '../../_vendor/core/dist/broker/replay/lifecycle-receipts.js';
const TELEMETRY_SUMMARY_SCHEMA = 'atm.gateTelemetryTaskSummary.v1';
const TELEMETRY_SEAL_SCHEMA = 'atm.gateTelemetrySealDigest.v1';
export function evaluateTaskflowTelemetryObligationGate(input) {
    const declaredObligations = readDeclaredObligations(input.taskDocument);
    if (declaredObligations.length === 0) {
        return { declared: false, result: null, summary: null };
    }
    const unavailableReceiptDigest = readUnavailableReceiptDigest(input.taskDocument);
    const seal = readTaskSeal(input.cwd, input.taskId);
    let summary = null;
    let sealedSummaryDigest = null;
    let historyDigest = null;
    let configDigest = null;
    if (seal) {
        try {
            summary = buildGateTelemetryTaskSummary(input.cwd, { taskId: input.taskId });
            sealedSummaryDigest = summary.sealedDigest;
            historyDigest = summary.historyDigest;
            configDigest = summary.configDigest;
        }
        catch {
            summary = null;
        }
    }
    return {
        declared: true,
        summary,
        result: evaluateTelemetryObligationSeal({
            taskId: input.taskId,
            declaredObligations,
            sealedSummaryDigest,
            unavailableReceiptDigest,
            historyDigest,
            configDigest
        })
    };
}
function readDeclaredObligations(taskDocument) {
    const candidates = [
        taskDocument.telemetryObligations,
        taskDocument.telemetryContract && typeof taskDocument.telemetryContract === 'object'
            ? taskDocument.telemetryContract.declaredObligations
            : null,
        taskDocument.telemetry && typeof taskDocument.telemetry === 'object'
            ? taskDocument.telemetry.declaredObligations
            : null
    ];
    const explicit = candidates.flatMap((value) => Array.isArray(value) ? value : [])
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean);
    if (explicit.length > 0)
        return [...new Set(explicit)];
    // Imported planning cards predate the machine-readable projection. Preserve
    // their declared contract without treating arbitrary telemetry prose as a
    // close obligation: only the canonical summary schema is recognized.
    const text = [taskDocument.description, taskDocument.intent, taskDocument.notes, taskDocument.acceptance]
        .map((value) => typeof value === 'string' ? value : JSON.stringify(value ?? ''))
        .join('\n');
    return text.includes(TELEMETRY_SUMMARY_SCHEMA) ? [TELEMETRY_SUMMARY_SCHEMA] : [];
}
function readUnavailableReceiptDigest(taskDocument) {
    const telemetry = taskDocument.telemetryObligationSeal;
    const candidates = [
        taskDocument.telemetryUnavailableReceiptDigest,
        telemetry && typeof telemetry === 'object'
            ? telemetry.unavailableReceiptDigest
            : null
    ];
    const digest = candidates.find((value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value));
    return digest ?? null;
}
function readTaskSeal(cwd, taskId) {
    const root = path.join(cwd, '.atm', 'runtime', 'telemetry', 'evidence');
    if (!existsSync(root))
        return null;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json'))
            continue;
        try {
            const value = JSON.parse(readFileSync(path.join(root, entry.name), 'utf8'));
            if (value.schemaId === TELEMETRY_SEAL_SCHEMA && value.taskId === taskId)
                return value;
        }
        catch {
            // A malformed or unrelated runtime artifact is not evidence of a seal.
        }
    }
    return null;
}
