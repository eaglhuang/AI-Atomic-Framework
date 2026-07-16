import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { RouteContext, RouteContextState } from '../../../../core/src/routing/index.ts';
import { resolveFreezeDecision, resumeFreeze } from '../../../../core/src/broker/freeze.ts';
import { CliError, makeResult, message } from '../shared.ts';
import { buildRouteFreezeRuntime, buildRoutePatchEnvelopeHandoff, clearRouteFreezeRuntime, readRouteFreezeRuntime, runRoutePatchEnvelopeHandoff, serializeFreezeProtocolEvidence, writePatchEnvelopeFile, writeRouteFreezeRuntime } from './freeze-patch.ts';
import { parseResourceSet, validateRouteContext } from './validation.ts';
import { relativePath, routeContextDir, routeContextPath, sanitizeRouteToken, unique, writeJson } from './files.ts';
import { routeFileNamePattern, type RouteLifecycleAction, type RouteOptions } from './types.ts';

export function runLifecycleRoute(options: RouteOptions) {
  if (options.action === 'open') {
    const route = buildOpenedRoute(options);
    const validation = validateRouteContext(route);
    if (!validation.ok) {
      throw new CliError('ATM_ROUTE_CONTEXT_INVALID', 'Route context failed validation.', {
        exitCode: 1,
        details: { errors: validation.errors }
      });
    }

    const routePath = routeContextPath(options.cwd, route.routeId);
    if (existsSync(routePath)) {
      throw new CliError('ATM_ROUTE_ALREADY_EXISTS', `Route already exists: ${route.routeId}`, { exitCode: 1 });
    }

    mkdirSync(path.dirname(routePath), { recursive: true });
    writeJson(routePath, route);
    return makeLifecycleResult(options.cwd, 'open', 'ATM_ROUTE_OPENED', `Opened route ${route.routeId}.`, { route, routePath: relativePath(options.cwd, routePath) });
  }

  if (options.action === 'list') {
    const routes = listRouteContexts(options.cwd);
    return makeLifecycleResult(options.cwd, 'list', 'ATM_ROUTE_LIST', `Found ${routes.length} route context record(s).`, { routes });
  }

  const route = readRequiredRoute(options);
  if (options.action === 'status') {
    return makeLifecycleResult(options.cwd, 'status', 'ATM_ROUTE_STATUS', `Route ${route.routeId} is ${route.state}.`, { route });
  }

  if (options.action === 'pause') {
    const freezeRuntime = buildRouteFreezeRuntime(route, options);
    const handoff = buildRoutePatchEnvelopeHandoff(route, freezeRuntime, options);
    const updated = {
      ...transitionRoute(route, 'frozen', options, freezeRuntime.resolution),
      patchEnvelopeRef: handoff.envelopeRef
    };
    const routePath = routeContextPath(options.cwd, route.routeId);
    writeJson(routePath, updated);
    writeRouteFreezeRuntime(options.cwd, freezeRuntime);
    writePatchEnvelopeFile(options.cwd, route.routeId, handoff.envelope);
    return makeLifecycleResult(options.cwd, 'pause', 'ATM_ROUTE_PAUSED', `Paused route ${route.routeId}.`, {
      route: updated,
      freezeProtocol: serializeFreezeProtocolEvidence(freezeRuntime),
      patchEnvelopeHandoff: handoff.evidence
    });
  }

  if (options.action === 'handoff') {
    const handoff = runRoutePatchEnvelopeHandoff(route, options);
    const updated = {
      ...route,
      patchEnvelopeRef: handoff.envelopeRef,
      updatedAt: new Date().toISOString()
    };
    writeJson(routeContextPath(options.cwd, route.routeId), updated);
    writePatchEnvelopeFile(options.cwd, route.routeId, handoff.envelope);
    return makeLifecycleResult(options.cwd, 'handoff', 'ATM_ROUTE_PATCH_ENVELOPE_HANDOFF', `Recorded patch envelope handoff for route ${route.routeId}.`, {
      route: updated,
      patchEnvelopeHandoff: handoff.evidence
    });
  }

  if (options.action === 'resume') {
    const freezeRuntime = readRouteFreezeRuntime(options.cwd, route.routeId);
    const resumeResolution = resumeFreeze(freezeRuntime.signal, {
      admissionRechecked: options.admissionRechecked
    });
    const updated = transitionRoute(route, 'open', options, resumeResolution);
    const routePath = routeContextPath(options.cwd, route.routeId);
    writeJson(routePath, updated);
    clearRouteFreezeRuntime(options.cwd, route.routeId);
    return makeLifecycleResult(options.cwd, 'resume', 'ATM_ROUTE_RESUMED', `Resumed route ${route.routeId}.`, {
      route: updated,
      freezeProtocol: {
        ...serializeFreezeProtocolEvidence(freezeRuntime),
        resume: resumeResolution
      }
    });
  }

  if (options.action === 'abandon') {
    const updated = transitionRoute(route, 'abandoned', options);
    writeJson(routeContextPath(options.cwd, route.routeId), updated);
    clearRouteFreezeRuntime(options.cwd, route.routeId);
    return makeLifecycleResult(options.cwd, 'abandon', 'ATM_ROUTE_ABANDONED', `Abandoned route ${route.routeId}.`, { route: updated });
  }

  throw new CliError('ATM_CLI_USAGE', 'route supports open, status, list, pause, resume, abandon, handoff, and takeover.', { exitCode: 2 });
}

function buildOpenedRoute(options: RouteOptions): RouteContext {
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'route open requires --task <id>.', { exitCode: 2 });
  }
  if (!options.actorId) {
    throw new CliError('ATM_CLI_USAGE', 'route open requires --actor <id>.', { exitCode: 2 });
  }

  const now = new Date().toISOString();
  const routeId = options.routeId ?? `route-${options.taskId}-${sanitizeRouteToken(options.actorId)}`;
  return {
    schemaId: 'atm.routeContext.v1',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial route context lifecycle record.'
    },
    routeId,
    taskId: options.taskId,
    actorId: options.actorId,
    claimIntent: options.claimIntent,
    state: 'open',
    openedAt: now,
    updatedAt: now,
    lease: {
      leaseId: options.leaseId ?? `lease-${routeId}`,
      issuedAt: now,
      heartbeatAt: now,
      ttlSeconds: options.ttlSeconds,
      maxSeconds: options.maxSeconds
    },
    declaredReadSet: parseResourceSet(options.readSet),
    declaredWriteSet: parseResourceSet(options.writeSet),
    targetAtomCids: options.targetAtomCids,
    targetVirtualAtomCids: options.targetVirtualAtomCids,
    patchEnvelopeRef: options.patchEnvelopeRef,
    blockedBy: [],
    admission: {
      verdict: 'watch',
      reason: 'Lifecycle route is open; broker admission is handled by later MAO tasks.'
    }
  };
}

function transitionRoute(
  route: RouteContext,
  state: RouteContextState,
  options: RouteOptions,
  freezeResolution?: ReturnType<typeof resolveFreezeDecision> | ReturnType<typeof resumeFreeze>
): RouteContext {
  const now = new Date().toISOString();
  const freezeReason = freezeResolution?.decision.reason ?? options.reason ?? null;
  const next: RouteContext = {
    ...route,
    state,
    updatedAt: now,
    closedAt: state === 'abandoned' ? now : route.closedAt,
    blockedBy: state === 'frozen'
      ? [{ kind: 'steward', id: options.actorId ?? 'route-operator', reason: freezeReason ?? 'route paused' }]
      : route.blockedBy,
    admission: state === 'frozen'
      ? {
        verdict: 'freeze',
        reason: freezeReason ?? options.reason ?? 'route paused via freeze protocol'
      }
      : state === 'abandoned'
        ? { verdict: 'blocked', reason: options.reason ?? 'route abandoned' }
        : {
          verdict: 'watch',
          reason: freezeResolution?.decision.reason ?? options.reason ?? 'route resumed via freeze protocol'
        }
  };
  const validation = validateRouteContext(next);
  if (!validation.ok) {
    throw new CliError('ATM_ROUTE_CONTEXT_INVALID', 'Route context transition failed validation.', {
      exitCode: 1,
      details: { errors: validation.errors }
    });
  }
  return next;
}

function readRequiredRoute(options: RouteOptions): RouteContext {
  if (!options.routeId) {
    throw new CliError('ATM_CLI_USAGE', `route ${options.action} requires --route <id>.`, { exitCode: 2 });
  }
  const routePath = routeContextPath(options.cwd, options.routeId);
  if (!existsSync(routePath)) {
    throw new CliError('ATM_ROUTE_NOT_FOUND', `Route not found: ${options.routeId}`, { exitCode: 1 });
  }
  const route = JSON.parse(readFileSync(routePath, 'utf8'));
  const validation = validateRouteContext(route);
  if (!validation.ok) {
    throw new CliError('ATM_ROUTE_CONTEXT_INVALID', 'Stored route context failed validation.', {
      exitCode: 1,
      details: { errors: validation.errors }
    });
  }
  return validation.value;
}

function listRouteContexts(cwd: string): RouteContext[] {
  const dir = routeContextDir(cwd);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => routeFileNamePattern.test(entry))
    .map((entry) => JSON.parse(readFileSync(path.join(dir, entry), 'utf8')))
    .filter((entry) => validateRouteContext(entry).ok) as RouteContext[];
}

function makeLifecycleResult(cwd: string, action: RouteLifecycleAction, code: string, text: string, evidence: Record<string, unknown>) {
  return makeResult({
    ok: true,
    command: 'route',
    cwd,
    messages: [message('info', code, text)],
    evidence: {
      schemaId: 'atm.routeLifecycle.v1',
      action,
      ...evidence
    }
  });
}
