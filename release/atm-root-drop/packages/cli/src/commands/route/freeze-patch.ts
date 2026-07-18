import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { RouteContext } from '../../../../core/src/routing/index.ts';
import { acknowledgeFreeze, createFreezeSignal, resolveFreezeDecision, resumeFreeze, resolveFreezeSnapshotDefaults } from '../../../../core/src/broker/freeze.ts';
import { comparePatchEnvelopes, createHandoffPatchEnvelope, summarizePatchEnvelope, validatePatchEnvelope, type PatchEnvelope } from '../../../../core/src/broker/patch-envelope.ts';
import { createRouteFreezeRuntimeRecord, type RouteFreezeRuntimeRecord } from '../../../../core/src/broker/types.ts';
import { CliError } from '../shared.ts';
import { relativePath, routeContextDir, routeFreezeRuntimePath, sanitizeRouteFileName, unique, writeJson } from './files.ts';
import { validateRouteContext } from './validation.ts';
import type { RouteOptions } from './types.ts';

export function buildRouteFreezeRuntime(route: RouteContext, options: RouteOptions): RouteFreezeRuntimeRecord {
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

export function readRouteFreezeRuntime(cwd: string, routeId: string): RouteFreezeRuntimeRecord {
  const freezePath = routeFreezeRuntimePath(cwd, routeId);
  if (!existsSync(freezePath)) {
    throw new CliError('ATM_ROUTE_FREEZE_RECORD_MISSING', `Route ${routeId} has no freeze protocol sidecar. Re-run route pause to create one before resume.`, {
      exitCode: 1,
      details: { routeId, freezePath: relativePath(cwd, freezePath) }
    });
  }
  const record = JSON.parse(readFileSync(freezePath, 'utf8')) as RouteFreezeRuntimeRecord;
  if (record.schemaId !== 'atm.routeFreezeRuntime.v1' || record.routeId !== routeId) {
    throw new CliError('ATM_ROUTE_FREEZE_RECORD_INVALID', `Stored freeze protocol record for ${routeId} is invalid.`, {
      exitCode: 1,
      details: { routeId, freezePath: relativePath(cwd, freezePath) }
    });
  }
  return record;
}

export function writeRouteFreezeRuntime(cwd: string, record: RouteFreezeRuntimeRecord) {
  writeJson(routeFreezeRuntimePath(cwd, record.routeId), record);
}

export function clearRouteFreezeRuntime(cwd: string, routeId: string) {
  const freezePath = routeFreezeRuntimePath(cwd, routeId);
  if (existsSync(freezePath)) {
    rmSync(freezePath, { force: true });
  }
}

export function serializeFreezeProtocolEvidence(record: RouteFreezeRuntimeRecord) {
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

function routePatchEnvelopePath(cwd: string, routeId: string) {
  return path.join(routeContextDir(cwd), `${sanitizeRouteFileName(routeId)}.patch-envelope.json`);
}

export function writePatchEnvelopeFile(cwd: string, routeId: string, envelope: PatchEnvelope) {
  writeJson(routePatchEnvelopePath(cwd, routeId), envelope);
}

function readPatchEnvelopeFile(cwd: string, routeId: string): PatchEnvelope {
  const envelopePath = routePatchEnvelopePath(cwd, routeId);
  if (!existsSync(envelopePath)) {
    throw new CliError('ATM_ROUTE_PATCH_ENVELOPE_MISSING', `Route ${routeId} has no patch envelope file.`, {
      exitCode: 1,
      details: { routeId, envelopePath: relativePath(cwd, envelopePath) }
    });
  }
  return JSON.parse(readFileSync(envelopePath, 'utf8')) as PatchEnvelope;
}

export function buildRoutePatchEnvelopeHandoff(
  route: RouteContext,
  freezeRuntime: RouteFreezeRuntimeRecord,
  options: RouteOptions
) {
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

export function runRoutePatchEnvelopeHandoff(route: RouteContext, options: RouteOptions) {
  const freezeRuntime = readRouteFreezeRuntime(options.cwd, route.routeId);
  const envelope = buildRoutePatchEnvelopeHandoff(route, freezeRuntime, options);
  let comparison: { readonly equal: boolean; readonly divergences: readonly { field: string; left: unknown; right: unknown }[] } | null = null;
  if (options.patchEnvelopeRef) {
    const comparePath = path.resolve(options.cwd, options.patchEnvelopeRef);
    if (!existsSync(comparePath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Patch envelope compare file not found: ${options.patchEnvelopeRef}`, { exitCode: 1 });
    }
    const baseline = JSON.parse(readFileSync(comparePath, 'utf8')) as PatchEnvelope;
    comparison = comparePatchEnvelopes(baseline, envelope.envelope);
  }
  return {
    ...envelope,
    evidence: serializePatchEnvelopeHandoffEvidence(
      envelope.envelope,
      envelope.envelopeRef,
      validatePatchEnvelope(envelope.envelope),
      comparison
    )
  };
}

function serializePatchEnvelopeHandoffEvidence(
  envelope: PatchEnvelope,
  envelopeRef: string,
  validation: ReturnType<typeof validatePatchEnvelope>,
  comparison: ReturnType<typeof comparePatchEnvelopes> | null
) {
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
