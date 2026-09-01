import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { acknowledgeFreeze, createFreezeSignal, resolveFreezeDecision, resolveFreezeSnapshotDefaults } from '../../../../core/dist/broker/freeze.js';
import { comparePatchEnvelopes, createHandoffPatchEnvelope, summarizePatchEnvelope, validatePatchEnvelope } from '../../../../core/dist/broker/patch-envelope.js';
import { createRouteFreezeRuntimeRecord } from '../../../../core/dist/broker/types.js';
import { CliError } from '../shared.js';
import { relativePath, routeContextDir, routeFreezeRuntimePath, sanitizeRouteFileName, unique, writeJson } from './files.js';
export function buildRouteFreezeRuntime(route, options) {
    const now = Date.now();
    const actorId = options.actorId ?? route.actorId;
    const signal = createFreezeSignal({
        taskId: route.taskId,
        actorId,
        now,
        blockingRoute: route.routeId,
        blockingTask: route.blockedBy.find((entry) => entry.kind === 'task')?.id
    });
    const ack = acknowledgeFreeze(signal, { now });
    const resolution = resolveFreezeDecision({
        signal,
        acknowledgedAt: ack.acknowledgedAt,
        now
    });
    return createRouteFreezeRuntimeRecord({
        routeId: route.routeId,
        signal,
        ack,
        resolution,
        pauseReason: options.reason ?? 'route paused',
        updatedAt: new Date(now).toISOString()
    });
}
export function readRouteFreezeRuntime(cwd, routeId) {
    const freezePath = routeFreezeRuntimePath(cwd, routeId);
    if (!existsSync(freezePath)) {
        throw new CliError('ATM_ROUTE_FREEZE_RECORD_MISSING', `Route ${routeId} has no freeze protocol sidecar. Re-run route pause to create one before resume.`, {
            exitCode: 1,
            details: { routeId, freezePath: relativePath(cwd, freezePath) }
        });
    }
    const record = JSON.parse(readFileSync(freezePath, 'utf8'));
    if (record.schemaId !== 'atm.routeFreezeRuntime.v1' || record.routeId !== routeId) {
        throw new CliError('ATM_ROUTE_FREEZE_RECORD_INVALID', `Stored freeze protocol record for ${routeId} is invalid.`, {
            exitCode: 1,
            details: { routeId, freezePath: relativePath(cwd, freezePath) }
        });
    }
    return record;
}
export function writeRouteFreezeRuntime(cwd, record) {
    writeJson(routeFreezeRuntimePath(cwd, record.routeId), record);
}
export function clearRouteFreezeRuntime(cwd, routeId) {
    const freezePath = routeFreezeRuntimePath(cwd, routeId);
    if (existsSync(freezePath)) {
        rmSync(freezePath, { force: true });
    }
}
export function serializeFreezeProtocolEvidence(record) {
    return {
        schemaId: 'atm.routeFreezeProtocolEvidence.v1',
        routeId: record.routeId,
        signal: record.signal,
        ack: record.ack,
        resolution: record.resolution,
        pauseReason: record.pauseReason,
        snapshotDefaultsReserved: 'WIP snapshot apply to worktree remains deferred; handoff records metadata-only envelopes only'
    };
}
function routePatchEnvelopePath(cwd, routeId) {
    return path.join(routeContextDir(cwd), `${sanitizeRouteFileName(routeId)}.patch-envelope.json`);
}
export function writePatchEnvelopeFile(cwd, routeId, envelope) {
    writeJson(routePatchEnvelopePath(cwd, routeId), envelope);
}
function readPatchEnvelopeFile(cwd, routeId) {
    const envelopePath = routePatchEnvelopePath(cwd, routeId);
    if (!existsSync(envelopePath)) {
        throw new CliError('ATM_ROUTE_PATCH_ENVELOPE_MISSING', `Route ${routeId} has no patch envelope file.`, {
            exitCode: 1,
            details: { routeId, envelopePath: relativePath(cwd, envelopePath) }
        });
    }
    return JSON.parse(readFileSync(envelopePath, 'utf8'));
}
export function buildRoutePatchEnvelopeHandoff(route, freezeRuntime, options) {
    const actorId = options.actorId ?? route.actorId;
    const targetFiles = unique([
        ...route.declaredWriteSet.files,
        ...route.declaredReadSet.files
    ]);
    const envelope = createHandoffPatchEnvelope({
        taskId: route.taskId,
        actorId,
        freezeId: freezeRuntime.signal.freezeId,
        targetFiles,
        snapshotDir: resolveFreezeSnapshotDefaults().snapshotDir,
        partialReason: options.reason ?? 'route pause handoff metadata-only envelope'
    });
    const validation = validatePatchEnvelope(envelope);
    if (!validation.ok) {
        throw new CliError('ATM_ROUTE_PATCH_ENVELOPE_INVALID', validation.reason, {
            exitCode: 1,
            details: { routeId: route.routeId, envelopeId: envelope.envelopeId }
        });
    }
    const envelopeRef = relativePath(options.cwd, routePatchEnvelopePath(options.cwd, route.routeId));
    return {
        envelope,
        envelopeRef,
        evidence: serializePatchEnvelopeHandoffEvidence(envelope, envelopeRef, validation, null)
    };
}
export function runRoutePatchEnvelopeHandoff(route, options) {
    const freezeRuntime = readRouteFreezeRuntime(options.cwd, route.routeId);
    const envelope = buildRoutePatchEnvelopeHandoff(route, freezeRuntime, options);
    let comparison = null;
    if (options.patchEnvelopeRef) {
        const comparePath = path.resolve(options.cwd, options.patchEnvelopeRef);
        if (!existsSync(comparePath)) {
            throw new CliError('ATM_FILE_NOT_FOUND', `Patch envelope compare file not found: ${options.patchEnvelopeRef}`, { exitCode: 1 });
        }
        const baseline = JSON.parse(readFileSync(comparePath, 'utf8'));
        comparison = comparePatchEnvelopes(baseline, envelope.envelope);
    }
    return {
        ...envelope,
        evidence: serializePatchEnvelopeHandoffEvidence(envelope.envelope, envelope.envelopeRef, validatePatchEnvelope(envelope.envelope), comparison)
    };
}
function serializePatchEnvelopeHandoffEvidence(envelope, envelopeRef, validation, comparison) {
    return {
        schemaId: 'atm.routePatchEnvelopeHandoff.v1',
        envelopeRef,
        envelope,
        summary: summarizePatchEnvelope(envelope),
        validation,
        comparison,
        applyOutOfScope: 'Patch envelopes are handoff records only; worktree apply and steward merge remain separate lanes.'
    };
}
