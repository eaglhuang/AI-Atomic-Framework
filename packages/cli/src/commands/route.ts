import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { RouteClaimIntent, RouteContext, RouteContextState, RouteResourceSet } from '../../../core/src/routing/index.ts';
import { applyStewardPlan } from '../../../core/src/broker/steward.ts';
import {
  acknowledgeFreeze,
  createFreezeSignal,
  resolveFreezeDecision,
  resumeFreeze
} from '../../../core/src/broker/freeze.ts';
import type { RouteFreezeRuntimeRecord } from '../../../core/src/broker/types.ts';
import { createRouteFreezeRuntimeRecord } from '../../../core/src/broker/types.ts';
import type { StewardIdentity } from '../../../core/src/broker/steward.ts';
import type { MergePlan, PatchProposal } from '../../../core/src/broker/types.ts';
import { CliError, makeResult, message } from './shared.ts';

type RouteLifecycleAction = 'open' | 'status' | 'list' | 'pause' | 'resume' | 'abandon';
type RouteAction = RouteLifecycleAction | 'takeover';

const lifecycleActions = new Set<RouteLifecycleAction>(['open', 'status', 'list', 'pause', 'resume', 'abandon']);
const routeFileNamePattern = /^route-[A-Za-z0-9._:-]+\.json$/;

export async function runRoute(argv: string[]) {
  const options = parseRouteArgs(argv);

  if (options.action === 'takeover') {
    return runTakeover(options);
  }

  return runLifecycleRoute(options);
}

function runLifecycleRoute(options: ReturnType<typeof parseRouteArgs>) {
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
    const updated = transitionRoute(route, 'frozen', options, freezeRuntime.resolution);
    const routePath = routeContextPath(options.cwd, route.routeId);
    writeJson(routePath, updated);
    writeRouteFreezeRuntime(options.cwd, freezeRuntime);
    return makeLifecycleResult(options.cwd, 'pause', 'ATM_ROUTE_PAUSED', `Paused route ${route.routeId}.`, {
      route: updated,
      freezeProtocol: serializeFreezeProtocolEvidence(freezeRuntime)
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

  throw new CliError('ATM_CLI_USAGE', 'route supports open, status, list, pause, resume, abandon, and takeover.', { exitCode: 2 });
}

function runTakeover(options: ReturnType<typeof parseRouteArgs>) {
  if (!options.mergePlanFile) {
    throw new CliError('ATM_CLI_USAGE', 'route takeover requires --merge-plan-file <path>.', { exitCode: 2 });
  }
  if (!options.proposalFile) {
    throw new CliError('ATM_CLI_USAGE', 'route takeover requires --proposal-file <path>.', { exitCode: 2 });
  }

  const mergePlanPath = path.resolve(options.cwd, options.mergePlanFile);
  if (!existsSync(mergePlanPath)) {
    throw new CliError('ATM_FILE_NOT_FOUND', `Merge plan file not found: ${options.mergePlanFile}`, { exitCode: 1 });
  }

  const proposalPath = path.resolve(options.cwd, options.proposalFile);
  if (!existsSync(proposalPath)) {
    throw new CliError('ATM_FILE_NOT_FOUND', `Proposal file not found: ${options.proposalFile}`, { exitCode: 1 });
  }

  const mergePlan = JSON.parse(readFileSync(mergePlanPath, 'utf8')) as MergePlan;
  if (mergePlan.verdict === 'blocked-cid-conflict' || mergePlan.verdict === 'blocked-shared-surface') {
    throw new CliError('ATM_ROUTE_UNSAFE_TAKEOVER', `Steward takeover is blocked because the conflict verdict is unsafe: '${mergePlan.verdict}'.`, {
      exitCode: 1,
      details: { verdict: mergePlan.verdict }
    });
  }
  if (mergePlan.verdict === 'human-required') {
    return makeResult({
      ok: false,
      command: 'route',
      cwd: options.cwd,
      messages: [
        message('warn', 'ATM_ROUTE_HUMAN_REQUIRED', 'Steward takeover cannot proceed: merge plan verdict is human-required. Human intervention needed.', {
          verdict: mergePlan.verdict,
          stewardId: options.stewardId ?? 'neutral-write-steward',
          owningRouteId: options.routeId ?? null,
          owningTaskId: options.taskId ?? null
        })
      ],
      evidence: {
        action: 'takeover',
        verdict: 'human-required',
        stewardId: options.stewardId ?? 'neutral-write-steward',
        owningRouteId: options.routeId ?? null,
        owningTaskId: options.taskId ?? null
      }
    });
  }

  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8')) as PatchProposal;
  const proposals = [proposal];
  const stewardId = options.stewardId ?? 'neutral-write-steward';
  const scopeFiles = options.scopeFiles.length > 0 ? options.scopeFiles : proposals.map((entry) => entry.targetFile);
  const backups: Record<string, string | null> = {};

  for (const file of scopeFiles) {
    const fullPath = path.resolve(options.cwd, file);
    backups[file] = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : null;
  }

  const evidenceOutPath = options.evidenceOutPath ? path.resolve(options.cwd, options.evidenceOutPath) : null;
  const applyResult = applyStewardPlan({
    cwd: options.cwd,
    stewardId,
    mergePlan,
    proposals,
    scopeFiles,
    evidenceOutPath
  });

  if (!applyResult.ok) {
    restoreBackups(options.cwd, backups);
    return makeResult({
      ok: false,
      command: 'route',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ROUTE_TAKEOVER_FAILED', 'Steward takeover merge failed.', {
          blockedReasons: applyResult.evidence.blockedReasons,
          stewardId,
          owningRouteId: options.routeId ?? null,
          owningTaskId: options.taskId ?? null
        })
      ],
      evidence: {
        action: 'takeover',
        applyResult,
        stewardId,
        owningRouteId: options.routeId ?? null,
        owningTaskId: options.taskId ?? null
      }
    });
  }

  const validators = proposal.validators && proposal.validators.length > 0 ? proposal.validators : ['npm run typecheck'];
  const validatorResults = [];
  let allPassed = true;

  for (const validator of validators) {
    const parts = validator.split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    const result = spawnSync(command, args, { cwd: options.cwd, shell: true, encoding: 'utf8' });
    const passed = result.status === 0;
    validatorResults.push({
      validator,
      passed,
      stdout: result.stdout,
      stderr: result.stderr
    });
    if (!passed) {
      allPassed = false;
      break;
    }
  }

  if (!allPassed) {
    restoreBackups(options.cwd, backups);
    return makeResult({
      ok: false,
      command: 'route',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ROUTE_VALIDATOR_FAILED', 'Validator-gated apply failed. Changes rolled back.', {
          validatorResults
        })
      ],
      evidence: {
        action: 'takeover',
        applyResult,
        validatorResults,
        rolledBack: true
      }
    });
  }

  return makeResult({
    ok: true,
    command: 'route',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_ROUTE_TAKEOVER_SUCCESS', 'Steward takeover successfully applied and verified via validator gates.', {
        stewardId,
        owningRouteId: options.routeId ?? null,
        owningTaskId: options.taskId ?? null
      })
    ],
    evidence: {
      action: 'takeover',
      applyResult,
      validatorResults,
      rolledBack: false,
      stewardId,
      owningRouteId: options.routeId ?? null,
      owningTaskId: options.taskId ?? null
    }
  });
}

function buildOpenedRoute(options: ReturnType<typeof parseRouteArgs>): RouteContext {
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
  options: ReturnType<typeof parseRouteArgs>,
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

function readRequiredRoute(options: ReturnType<typeof parseRouteArgs>): RouteContext {
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

function parseResourceSet(input: string[]): RouteResourceSet {
  return {
    files: unique(input),
    atomCids: [],
    virtualAtomCids: [],
    validators: [],
    artifacts: []
  };
}

function validateRouteContext(value: unknown): { readonly ok: true; readonly value: RouteContext } | { readonly ok: false; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') {
    return { ok: false, errors: ['/ must be object'] };
  }

  const record = value as Partial<RouteContext>;
  if (record.schemaId !== 'atm.routeContext.v1') {
    errors.push('/schemaId must be atm.routeContext.v1');
  }
  if (record.specVersion !== '0.1.0') {
    errors.push('/specVersion must be 0.1.0');
  }
  for (const [field, fieldValue] of Object.entries({
    routeId: record.routeId,
    taskId: record.taskId,
    actorId: record.actorId,
    openedAt: record.openedAt
  })) {
    if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
      errors.push(`/${field} must be a non-empty string`);
    }
  }
  if (typeof record.routeId === 'string' && !/^route-[A-Za-z0-9._:-]+$/.test(record.routeId)) {
    errors.push('/routeId must start with route- and contain only route id characters');
  }
  if (!['read', 'write', 'review', 'steward', 'release-sync'].includes(String(record.claimIntent))) {
    errors.push('/claimIntent must be a supported route claim intent');
  }
  if (!['open', 'admitted', 'frozen', 'waiting', 'blocked', 'ready-to-apply', 'closed', 'abandoned'].includes(String(record.state))) {
    errors.push('/state must be a supported route context state');
  }
  if (!record.lease || typeof record.lease !== 'object') {
    errors.push('/lease must be an object');
  }
  if (!isResourceSet(record.declaredReadSet)) {
    errors.push('/declaredReadSet must be a route resource set');
  }
  if (!isResourceSet(record.declaredWriteSet)) {
    errors.push('/declaredWriteSet must be a route resource set');
  }
  if (!Array.isArray(record.targetAtomCids)) {
    errors.push('/targetAtomCids must be an array');
  }
  if (!Array.isArray(record.targetVirtualAtomCids)) {
    errors.push('/targetVirtualAtomCids must be an array');
  }
  if (!Array.isArray(record.blockedBy)) {
    errors.push('/blockedBy must be an array');
  }
  if (record.patchEnvelopeRef !== null && typeof record.patchEnvelopeRef !== 'string') {
    errors.push('/patchEnvelopeRef must be string or null');
  }

  return errors.length === 0
    ? { ok: true, value: record as RouteContext }
    : { ok: false, errors };
}

function isResourceSet(value: unknown): value is RouteResourceSet {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<RouteResourceSet>;
  return Array.isArray(record.files)
    && Array.isArray(record.atomCids)
    && Array.isArray(record.virtualAtomCids)
    && Array.isArray(record.validators)
    && Array.isArray(record.artifacts);
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

function routeContextDir(cwd: string) {
  return path.join(cwd, '.atm', 'runtime', 'routes');
}

function routeContextPath(cwd: string, routeId: string) {
  return path.join(routeContextDir(cwd), `${sanitizeRouteFileName(routeId)}.json`);
}

function routeFreezeRuntimePath(cwd: string, routeId: string) {
  return path.join(routeContextDir(cwd), `${sanitizeRouteFileName(routeId)}.freeze.json`);
}

function buildRouteFreezeRuntime(route: RouteContext, options: ReturnType<typeof parseRouteArgs>): RouteFreezeRuntimeRecord {
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

function readRouteFreezeRuntime(cwd: string, routeId: string): RouteFreezeRuntimeRecord {
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

function writeRouteFreezeRuntime(cwd: string, record: RouteFreezeRuntimeRecord) {
  writeJson(routeFreezeRuntimePath(cwd, record.routeId), record);
}

function clearRouteFreezeRuntime(cwd: string, routeId: string) {
  const freezePath = routeFreezeRuntimePath(cwd, routeId);
  if (existsSync(freezePath)) {
    rmSync(freezePath, { force: true });
  }
}

function serializeFreezeProtocolEvidence(record: RouteFreezeRuntimeRecord) {
  return {
    schemaId: 'atm.routeFreezeProtocolEvidence.v1',
    routeId: record.routeId,
    signal: record.signal,
    ack: record.ack,
    resolution: record.resolution,
    pauseReason: record.pauseReason,
    snapshotDefaultsReserved: 'patch-envelope submission and WIP snapshot apply remain deferred to later MAO tasks'
  };
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relativePath(cwd: string, filePath: string) {
  return path.relative(cwd, filePath).replace(/\\/g, '/');
}

function sanitizeRouteToken(value: string) {
  return value.replace(/[^A-Za-z0-9._:-]+/g, '-');
}

function sanitizeRouteFileName(routeId: string) {
  if (!routeId.startsWith('route-')) {
    throw new CliError('ATM_CLI_USAGE', 'route id must start with route-.', { exitCode: 2 });
  }
  return sanitizeRouteToken(routeId);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function restoreBackups(cwd: string, backups: Record<string, string | null>) {
  for (const [file, content] of Object.entries(backups)) {
    const fullPath = path.resolve(cwd, file);
    if (content === null) {
      rmSync(fullPath, { force: true });
    } else {
      writeFileSync(fullPath, content, 'utf8');
    }
  }
}

function parseRouteArgs(argv: string[]) {
  const state = {
    cwd: process.cwd(),
    action: null as RouteAction | null,
    routeId: null as string | null,
    taskId: null as string | null,
    actorId: null as string | null,
    claimIntent: 'write' as RouteClaimIntent,
    leaseId: null as string | null,
    ttlSeconds: 1800,
    maxSeconds: 7200,
    readSet: [] as string[],
    writeSet: [] as string[],
    targetAtomCids: [] as string[],
    targetVirtualAtomCids: [] as string[],
    patchEnvelopeRef: null as string | null,
    reason: null as string | null,
    admissionRechecked: false,
    mergePlanFile: null as string | null,
    proposalFile: null as string | null,
    stewardId: null as string | null,
    evidenceOutPath: null as string | null,
    scopeFiles: [] as string[]
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--route' || arg === '--route-id') {
      state.routeId = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      state.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      state.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--claim-intent') {
      state.claimIntent = parseClaimIntent(requireValue(argv, index, '--claim-intent'));
      index += 1;
      continue;
    }
    if (arg === '--lease-id') {
      state.leaseId = requireValue(argv, index, '--lease-id');
      index += 1;
      continue;
    }
    if (arg === '--ttl-seconds') {
      state.ttlSeconds = parsePositiveInteger(requireValue(argv, index, '--ttl-seconds'), '--ttl-seconds');
      index += 1;
      continue;
    }
    if (arg === '--max-seconds') {
      state.maxSeconds = parsePositiveInteger(requireValue(argv, index, '--max-seconds'), '--max-seconds');
      index += 1;
      continue;
    }
    if (arg === '--read-set') {
      state.readSet = parseCsv(requireValue(argv, index, '--read-set'));
      index += 1;
      continue;
    }
    if (arg === '--write-set') {
      state.writeSet = parseCsv(requireValue(argv, index, '--write-set'));
      index += 1;
      continue;
    }
    if (arg === '--atom-cids') {
      state.targetAtomCids = parseCsv(requireValue(argv, index, '--atom-cids'));
      index += 1;
      continue;
    }
    if (arg === '--virtual-atom-cids') {
      state.targetVirtualAtomCids = parseCsv(requireValue(argv, index, '--virtual-atom-cids'));
      index += 1;
      continue;
    }
    if (arg === '--patch-envelope-ref') {
      state.patchEnvelopeRef = requireValue(argv, index, '--patch-envelope-ref');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      state.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--admission-rechecked') {
      state.admissionRechecked = true;
      continue;
    }
    if (arg === '--merge-plan-file') {
      state.mergePlanFile = requireValue(argv, index, '--merge-plan-file');
      index += 1;
      continue;
    }
    if (arg === '--proposal-file') {
      state.proposalFile = requireValue(argv, index, '--proposal-file');
      index += 1;
      continue;
    }
    if (arg === '--steward-id') {
      state.stewardId = requireValue(argv, index, '--steward-id');
      index += 1;
      continue;
    }
    if (arg === '--evidence-out-path') {
      state.evidenceOutPath = requireValue(argv, index, '--evidence-out-path');
      index += 1;
      continue;
    }
    if (arg === '--scope-files') {
      state.scopeFiles = parseCsv(requireValue(argv, index, '--scope-files'));
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `route does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'route accepts only one action', { exitCode: 2 });
    }
    state.action = parseAction(arg);
  }

  if (!state.action) {
    throw new CliError('ATM_CLI_USAGE', 'route requires an action: open, status, list, pause, resume, abandon, or takeover.', { exitCode: 2 });
  }

  return {
    ...state,
    cwd: path.resolve(state.cwd),
    action: state.action
  };
}

function parseAction(value: string): RouteAction {
  if (value === 'takeover' || lifecycleActions.has(value as RouteLifecycleAction)) {
    return value as RouteAction;
  }
  throw new CliError('ATM_CLI_USAGE', 'route supports open, status, list, pause, resume, abandon, and takeover.', { exitCode: 2 });
}

function parseClaimIntent(value: string): RouteClaimIntent {
  if (value === 'read' || value === 'write' || value === 'review' || value === 'steward' || value === 'release-sync') {
    return value;
  }
  throw new CliError('ATM_CLI_USAGE', `unsupported route claim intent: ${value}`, { exitCode: 2 });
}

function parsePositiveInteger(value: string, optionName: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError('ATM_CLI_USAGE', `${optionName} must be a positive integer.`, { exitCode: 2 });
  }
  return parsed;
}

function parseCsv(value: string) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function requireValue(argv: string[], optionIndex: number, optionName: string): string {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `route requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
