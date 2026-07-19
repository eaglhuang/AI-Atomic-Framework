import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const gateTelemetrySpecVersion = 'atm.gateTelemetry.v1';
export const gateTelemetryRuntimeRelativePath = path.join('.atm', 'runtime', 'telemetry');
export const gateTelemetryHistoryRelativePath = path.join('.atm', 'history', 'telemetry');
export const gateTelemetryEvidenceRelativePath = path.join('.atm', 'history', 'evidence', 'governance-telemetry');
export const canonicalGateCheckRegistry = Object.freeze([
    { checkId: 'next.route-resolution', checkVersion: '1.0.0', gate: 'next', owner: 'atm-core', summary: 'Prompt and task scope route resolution.' },
    { checkId: 'doctor.readiness', checkVersion: '1.0.0', gate: 'doctor', owner: 'atm-core', summary: 'Repository readiness doctor check.' },
    { checkId: 'guard.framework-mode', checkVersion: '1.0.0', gate: 'guard', owner: 'atm-core', summary: 'Framework development guard decision.' },
    { checkId: 'tasks.claim-admission', checkVersion: '1.0.0', gate: 'tasks', owner: 'atm-core', summary: 'Task claim admission and ownership check.' },
    { checkId: 'taskflow.close-readiness', checkVersion: '1.0.0', gate: 'taskflow', owner: 'atm-core', summary: 'Task close readiness check.' },
    { checkId: 'batch.checkpoint-readiness', checkVersion: '1.0.0', gate: 'batch', owner: 'atm-core', summary: 'Batch checkpoint readiness check.' },
    { checkId: 'broker.shared-surface-admission', checkVersion: '1.0.0', gate: 'broker', owner: 'atm-core', summary: 'Shared surface broker admission check.' }
]);
export function emitGateTelemetryEvent(cwd, input) {
    try {
        const now = input.observedAt ?? new Date().toISOString();
        const runId = input.runId ?? process.env.ATM_RUN_ID ?? `run-${process.pid}`;
        const sequence = input.sequence ?? Date.now();
        const lane = sanitizePathPart(input.laneSessionId ?? process.env.ATM_LANE_SESSION_ID ?? `process-${process.pid}`);
        const dir = path.join(cwd, gateTelemetryRuntimeRelativePath, 'gate-events', sanitizePathPart(runId));
        mkdirSync(dir, { recursive: true });
        const entry = registryEntryFor(input.checkId);
        const event = {
            specVersion: gateTelemetrySpecVersion,
            eventId: input.eventId ?? `gte-${randomUUID()}`,
            sequence,
            observedAt: now,
            gate: input.gate,
            checkId: input.checkId,
            checkVersion: input.checkVersion ?? entry?.checkVersion ?? '1.0.0',
            policyVersion: input.policyVersion ?? '1.0.0',
            eligible: input.eligible ?? true,
            result: input.result,
            reasonClass: input.reasonClass ?? input.result,
            durationMs: Math.max(0, Math.trunc(input.durationMs ?? 0)),
            actorId: input.actorId ?? process.env.ATM_ACTOR_ID ?? 'unknown',
            runId,
            correlationId: input.correlationId ?? `corr-${randomUUID()}`,
            laneSessionId: input.laneSessionId ?? process.env.ATM_LANE_SESSION_ID ?? null,
            taskId: input.taskId ?? null,
            batchId: input.batchId ?? null,
            waveId: input.waveId ?? null,
            command: input.command ?? 'unknown',
            inputDigest: input.inputDigest ?? digestJson({ command: input.command ?? 'unknown', checkId: input.checkId }),
            configDigest: input.configDigest ?? digestJson({ registry: canonicalGateCheckRegistry.map((check) => check.checkId) }),
            source: input.source ?? 'runtime',
            redactionClass: input.redactionClass ?? 'none',
            failureEnvelopeRef: input.failureEnvelopeRef ?? null,
            evidenceReadRef: input.evidenceReadRef ?? null
        };
        const target = path.join(dir, `${lane}.jsonl`);
        writeFileSync(target, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
        return { ok: true, event, path: target };
    }
    catch (error) {
        return { ok: false, warning: error instanceof Error ? error.message : String(error) };
    }
}
export function sealGateTelemetry(cwd, input) {
    const sealedAt = new Date().toISOString();
    const windowId = input.windowId ?? sealedAt.replace(/[:.]/g, '-');
    const watermark = input.watermark ?? sealedAt;
    const runtimeRoot = path.join(cwd, gateTelemetryRuntimeRelativePath, 'gate-events');
    const events = readRuntimeEvents(runtimeRoot, watermark);
    const historyDir = path.join(cwd, gateTelemetryHistoryRelativePath);
    const evidenceDir = path.join(cwd, gateTelemetryEvidenceRelativePath);
    mkdirSync(historyDir, { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    const historyPath = path.join(historyDir, `gate-events-${sanitizePathPart(input.taskId)}-${sanitizePathPart(windowId)}.jsonl`);
    const body = events.valid.map((event) => JSON.stringify(event)).join('\n');
    writeFileSync(historyPath, body.length > 0 ? `${body}\n` : '', 'utf8');
    const historyDigest = digestText(readFileSync(historyPath, 'utf8'));
    const digest = {
        schemaId: 'atm.gateTelemetrySealDigest.v1',
        taskId: input.taskId,
        windowId,
        sealedAt,
        watermark,
        eventCount: events.valid.length,
        historyPath: path.relative(cwd, historyPath).replace(/\\/g, '/'),
        historyDigest,
        metaHealth: {
            droppedEvents: 0,
            malformedEvents: events.malformed,
            warnings: events.warnings
        }
    };
    writeFileSync(path.join(evidenceDir, `${sanitizePathPart(windowId)}.json`), `${JSON.stringify(digest, null, 2)}\n`, 'utf8');
    return digest;
}
export function reportGateTelemetry(cwd, includeRuntime = false) {
    const historyEvents = readHistoryEvents(path.join(cwd, gateTelemetryHistoryRelativePath));
    const runtimeEvents = includeRuntime ? readRuntimeEvents(path.join(cwd, gateTelemetryRuntimeRelativePath, 'gate-events')).valid : [];
    const events = [...historyEvents.valid, ...runtimeEvents];
    const byCheckId = {};
    const uniqueBlocks = new Set();
    for (const event of events) {
        const bucket = byCheckId[event.checkId] ?? {
            eligible: 0,
            resultCounts: {},
            durationP50: null,
            durationP95: null,
            evidenceReadbacks: 0
        };
        const durations = events.filter((candidate) => candidate.checkId === event.checkId).map((candidate) => candidate.durationMs).sort((a, b) => a - b);
        byCheckId[event.checkId] = {
            eligible: bucket.eligible + (event.eligible ? 1 : 0),
            resultCounts: { ...bucket.resultCounts, [event.result]: (bucket.resultCounts[event.result] ?? 0) + 1 },
            durationP50: percentile(durations, 0.5),
            durationP95: percentile(durations, 0.95),
            evidenceReadbacks: bucket.evidenceReadbacks + (event.evidenceReadRef ? 1 : 0)
        };
        if (event.result === 'block')
            uniqueBlocks.add(`${event.checkId}:${event.reasonClass}:${event.inputDigest}`);
    }
    return {
        schemaId: 'atm.gateTelemetryReport.v1',
        generatedAt: new Date().toISOString(),
        source: includeRuntime ? 'sealed-history+runtime' : 'sealed-history',
        eventCount: events.length,
        byCheckId,
        uniqueBlocks: [...uniqueBlocks].sort(),
        truePositiveStatus: 'unclassified',
        metaHealth: {
            droppedEvents: 0,
            malformedEvents: historyEvents.malformed,
            warnings: historyEvents.warnings
        }
    };
}
function registryEntryFor(checkId) {
    return canonicalGateCheckRegistry.find((entry) => entry.checkId === checkId) ?? null;
}
function readRuntimeEvents(root, watermark) {
    return readEventTree(root, watermark);
}
function readHistoryEvents(root) {
    return readEventTree(root);
}
function readEventTree(root, watermark) {
    if (!existsSync(root))
        return { valid: [], malformed: 0, warnings: [] };
    const files = listJsonlFiles(root);
    const valid = [];
    let malformed = 0;
    const warnings = [];
    for (const file of files) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0);
        for (const line of lines) {
            try {
                const event = JSON.parse(line);
                if (event.specVersion !== gateTelemetrySpecVersion) {
                    malformed += 1;
                    continue;
                }
                if (watermark && event.observedAt > watermark)
                    continue;
                valid.push(event);
            }
            catch {
                malformed += 1;
            }
        }
    }
    valid.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.sequence - b.sequence);
    return { valid, malformed, warnings };
}
function listJsonlFiles(root) {
    const out = [];
    for (const name of readdirSync(root)) {
        const full = path.join(root, name);
        const stats = statSync(full);
        if (stats.isDirectory()) {
            out.push(...listJsonlFiles(full));
        }
        else if (name.endsWith('.jsonl')) {
            out.push(full);
        }
    }
    return out;
}
function percentile(values, p) {
    if (values.length === 0)
        return null;
    const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
    return values[index] ?? null;
}
function sanitizePathPart(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'unknown';
}
function digestJson(value) {
    return digestText(JSON.stringify(value));
}
function digestText(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
