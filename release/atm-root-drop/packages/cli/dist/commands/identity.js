import path from 'node:path';
import { findActorByResolvedId, readRuntimeIdentityDefault, sanitizeActorKind, upsertActorRecord, writeRuntimeIdentityDefault } from './actor-registry.js';
import { listActorWorkSessions, resolveActorWorkSession } from './actor-session.js';
import { CliError, makeResult, message } from './shared.js';
export async function runIdentity(argv) {
    const options = parseIdentityOptions(argv);
    if (options.action === 'show') {
        const current = readRuntimeIdentityDefault(options.cwd);
        const session = current?.activeSessionId ? resolveActorWorkSession(options.cwd, { sessionId: current.activeSessionId, includeNonActive: true }) : null;
        return makeResult({
            ok: true,
            command: 'identity',
            cwd: options.cwd,
            messages: [message('info', 'ATM_IDENTITY_SHOW', current
                    ? `Loaded repo default identity for ${current.actorId}.`
                    : 'No repo default identity is configured yet.')],
            evidence: {
                identity: current,
                activeSession: session,
                recentSessions: listActorWorkSessions(options.cwd).slice(0, 5)
            }
        });
    }
    if (!options.actorId) {
        throw new CliError('ATM_CLI_USAGE', 'identity set requires --actor <actor-id>.', { exitCode: 2 });
    }
    const existingActor = findActorByResolvedId(options.cwd, { actorId: options.actorId, source: 'option' });
    const nowIso = new Date().toISOString();
    const document = {
        schemaId: 'atm.identityDefault.v1',
        specVersion: '0.1.0',
        actorId: options.actorId,
        gitName: options.gitName ?? existingActor?.gitName ?? null,
        gitEmail: options.gitEmail ?? existingActor?.gitEmail ?? null,
        editor: options.editor ?? existingActor?.editor ?? null,
        provider: options.provider ?? existingActor?.provider ?? null,
        activeSessionId: options.activeSessionId ?? readRuntimeIdentityDefault(options.cwd)?.activeSessionId ?? null,
        updatedAt: nowIso
    };
    const identityPath = writeRuntimeIdentityDefault(options.cwd, document);
    let registryPath = null;
    const actorKind = sanitizeActorKind(options.actorKind) ?? existingActor?.actorKind ?? null;
    const displayName = options.displayName ?? existingActor?.displayName ?? null;
    if (actorKind && displayName) {
        registryPath = upsertActorRecord(options.cwd, {
            actorId: options.actorId,
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
        messages: [message('info', 'ATM_IDENTITY_SET', `Repo default identity set to ${options.actorId}.`, {
                actorId: options.actorId,
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
function parseIdentityOptions(argv) {
    const state = {
        cwd: process.cwd(),
        action: null,
        actorId: null,
        displayName: null,
        actorKind: null,
        provider: null,
        editor: null,
        gitName: null,
        gitEmail: null,
        contact: null,
        capabilities: [],
        activeSessionId: null
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
        state.action = arg;
    }
    if (!state.action || (state.action !== 'set' && state.action !== 'show')) {
        throw new CliError('ATM_CLI_USAGE', 'identity supports: set, show', { exitCode: 2 });
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
function requireValue(argv, optionIndex, optionName) {
    const value = argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `identity requires a value for ${optionName}`, { exitCode: 2 });
    }
    return value;
}
