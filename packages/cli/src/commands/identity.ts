import path from 'node:path';
import { clearRuntimeIdentityDefault, clearRuntimeIdentityForActor, findActorByResolvedId, readRuntimeIdentityDefault, readRuntimeIdentityForActor, runtimeIdentityActorRelativePath, runtimeIdentityRelativePath, sanitizeActorKind, type RuntimeIdentityDefaultDocument, upsertActorRecord, writeRuntimeIdentityDefault, writeRuntimeIdentityForActor } from './actor-registry.ts';
import { listActorWorkSessions, resolveActorWorkSession } from './actor-session.ts';
import { CliError, makeResult, message } from './shared.ts';

export async function runIdentity(argv: string[]) {
  const options = parseIdentityOptions(argv);
  if (options.action === 'show') {
    const current = options.actorId
      ? readRuntimeIdentityForActor(options.cwd, options.actorId)
      : readRuntimeIdentityDefault(options.cwd);
    const session = current?.activeSessionId ? resolveActorWorkSession(options.cwd, { sessionId: current.activeSessionId, includeNonActive: true }) : null;
    return makeResult({
      ok: true,
      command: 'identity',
      cwd: options.cwd,
      messages: [message('info', 'ATM_IDENTITY_SHOW', current
        ? options.actorId
          ? `Loaded actor identity for ${current.actorId}.`
          : `Loaded repo default identity for ${current.actorId}.`
        : options.actorId
          ? `No actor identity is configured yet for ${options.actorId}.`
          : 'No repo default identity is configured yet.')],
      evidence: {
        identity: current,
        identityPath: current
          ? options.actorId
            ? runtimeIdentityActorRelativePath(options.actorId)
            : runtimeIdentityRelativePath
          : null,
        activeSession: session,
        recentSessions: listActorWorkSessions(options.cwd).slice(0, 5)
      }
    });
  }

  if (options.action === 'clear') {
    const identityPath = options.actorId
      ? runtimeIdentityActorRelativePath(options.actorId)
      : runtimeIdentityRelativePath;
    const removed = options.actorId
      ? clearRuntimeIdentityForActor(options.cwd, options.actorId)
      : clearRuntimeIdentityDefault(options.cwd);
    return makeResult({
      ok: true,
      command: 'identity',
      cwd: options.cwd,
      messages: [message('info', 'ATM_IDENTITY_CLEARED', options.actorId
        ? `Actor runtime identity cleared for ${options.actorId}.`
        : 'Repo default runtime identity cleared.', {
        actorId: options.actorId,
        identityPath,
        removed,
        nextStep: 'Set an explicit editor/agent actor identity before governed work: node atm.mjs identity set --actor <actor-id> --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json'
      })],
      evidence: {
        action: 'clear',
        actorId: options.actorId,
        identityPath,
        removed
      }
    });
  }

  const existingDefault = readRuntimeIdentityDefault(options.cwd);
  const effectiveActorId = options.actorId ?? existingDefault?.actorId ?? null;
  if (!effectiveActorId) {
    throw new CliError('ATM_CLI_USAGE', 'identity set requires --actor <actor-id> or an existing repo default identity.', { exitCode: 2 });
  }

  const existingActor = findActorByResolvedId(options.cwd, { actorId: effectiveActorId, source: 'option' });
  const nowIso = new Date().toISOString();
  const existingIdentity = options.actorId
    ? readRuntimeIdentityForActor(options.cwd, effectiveActorId)
    : existingDefault;
  const document: RuntimeIdentityDefaultDocument = {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: effectiveActorId,
    gitName: options.gitName ?? existingIdentity?.gitName ?? existingActor?.gitName ?? null,
    gitEmail: options.gitEmail ?? existingIdentity?.gitEmail ?? existingActor?.gitEmail ?? null,
    editor: options.editor ?? existingIdentity?.editor ?? existingActor?.editor ?? null,
    provider: options.provider ?? existingIdentity?.provider ?? existingActor?.provider ?? null,
    activeSessionId: options.activeSessionId ?? existingIdentity?.activeSessionId ?? null,
    updatedAt: nowIso
  };
  const identityPath = options.actorId
    ? writeRuntimeIdentityForActor(options.cwd, effectiveActorId, document)
    : writeRuntimeIdentityDefault(options.cwd, document);

  let registryPath: string | null = null;
  const actorKind = sanitizeActorKind(options.actorKind) ?? existingActor?.actorKind ?? null;
  const displayName = options.displayName ?? existingActor?.displayName ?? null;
  if (actorKind && displayName) {
    registryPath = upsertActorRecord(options.cwd, {
      actorId: effectiveActorId,
      actorKind,
      displayName,
      provider: options.provider ?? existingActor?.provider ?? undefined,
      editor: options.editor ?? existingActor?.editor ?? undefined,
      gitName: options.gitName ?? existingActor?.gitName ?? undefined,
      gitEmail: options.gitEmail ?? existingActor?.gitEmail ?? undefined,
      contact: options.contact ?? existingActor?.contact ?? undefined,
      capabilities: options.capabilities.length > 0 ? options.capabilities : existingActor?.capabilities
    }).path;
  }

  return makeResult({
    ok: true,
    command: 'identity',
    cwd: options.cwd,
    messages: [message('info', 'ATM_IDENTITY_SET', options.actorId
      ? `Actor identity set to ${effectiveActorId}.`
      : `Repo default identity set to ${effectiveActorId}.`, {
      actorId: effectiveActorId,
      actorScoped: Boolean(options.actorId),
      registryUpdated: Boolean(registryPath)
    })],
    evidence: {
      identity: document,
      identityPath,
      registryPath,
      actorRegistered: Boolean(registryPath)
    }
  });
}

interface ParsedIdentityOptions {
  readonly cwd: string;
  readonly action: 'set' | 'show' | 'clear';
  readonly actorId: string | null;
  readonly displayName: string | null;
  readonly actorKind: string | null;
  readonly provider: string | null;
  readonly editor: string | null;
  readonly gitName: string | null;
  readonly gitEmail: string | null;
  readonly contact: string | null;
  readonly capabilities: readonly string[];
  readonly activeSessionId: string | null;
}

function parseIdentityOptions(argv: string[]): ParsedIdentityOptions {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedIdentityOptions['action'] | null,
    actorId: null as string | null,
    displayName: null as string | null,
    actorKind: null as string | null,
    provider: null as string | null,
    editor: null as string | null,
    gitName: null as string | null,
    gitEmail: null as string | null,
    contact: null as string | null,
    capabilities: [] as string[],
    activeSessionId: null as string | null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      state.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--name') {
      state.displayName = requireValue(argv, index, '--name');
      index += 1;
      continue;
    }
    if (arg === '--kind') {
      state.actorKind = requireValue(argv, index, '--kind');
      index += 1;
      continue;
    }
    if (arg === '--provider') {
      state.provider = requireValue(argv, index, '--provider');
      index += 1;
      continue;
    }
    if (arg === '--editor') {
      state.editor = requireValue(argv, index, '--editor');
      index += 1;
      continue;
    }
    if (arg === '--git-name') {
      state.gitName = requireValue(argv, index, '--git-name');
      index += 1;
      continue;
    }
    if (arg === '--git-email') {
      state.gitEmail = requireValue(argv, index, '--git-email');
      index += 1;
      continue;
    }
    if (arg === '--contact') {
      state.contact = requireValue(argv, index, '--contact');
      index += 1;
      continue;
    }
    if (arg === '--capabilities') {
      state.capabilities = requireValue(argv, index, '--capabilities').split(',').map((entry) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--active-session') {
      state.activeSessionId = requireValue(argv, index, '--active-session');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `identity does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'identity accepts only one action.', { exitCode: 2 });
    }
    state.action = arg as ParsedIdentityOptions['action'];
  }

  if (!state.action || (state.action !== 'set' && state.action !== 'show' && state.action !== 'clear')) {
    throw new CliError('ATM_CLI_USAGE', 'identity supports: set, show, clear', { exitCode: 2 });
  }

  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    actorId: state.actorId,
    displayName: state.displayName,
    actorKind: state.actorKind,
    provider: state.provider,
    editor: state.editor,
    gitName: state.gitName,
    gitEmail: state.gitEmail,
    contact: state.contact,
    capabilities: state.capabilities,
    activeSessionId: state.activeSessionId
  };
}

function requireValue(argv: string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `identity requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
