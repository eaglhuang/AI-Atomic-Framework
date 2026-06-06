import { execSync } from 'node:child_process';
import path from 'node:path';
import { CliError, makeResult, message } from './shared.js';
import { actorIdEnvVar, actorRegistryRelativePath, composeAdoptSlug, findActorByResolvedId, readActorRegistry, readRuntimeIdentityDefault, resolveActorId, restoreGitLocalIdentity, runtimeIdentityRelativePath, sanitizeActorKind, snapshotGitLocalIdentity, upsertActorRecord, writeGitLocalIdentity, writeRuntimeIdentityDefault } from './actor-registry.js';
export async function runActor(argv) {
    const options = parseActorArgs(argv);
    if (options.action === 'register') {
        const actorKind = sanitizeActorKind(options.actorKind);
        if (!options.actorId) {
            throw new CliError('ATM_CLI_USAGE', 'actor register requires --id <actor-id>.', { exitCode: 2 });
        }
        if (!actorKind) {
            throw new CliError('ATM_CLI_USAGE', 'actor register requires --kind <human|ai-agent|automation>.', { exitCode: 2 });
        }
        if (!options.displayName) {
            throw new CliError('ATM_CLI_USAGE', 'actor register requires --name <display-name>.', { exitCode: 2 });
        }
        const written = upsertActorRecord(options.cwd, {
            actorId: options.actorId,
            actorKind,
            displayName: options.displayName,
            provider: options.provider ?? undefined,
            editor: options.editor ?? undefined,
            gitName: options.gitName ?? undefined,
            gitEmail: options.gitEmail ?? undefined,
            contact: options.contact ?? undefined,
            capabilities: options.capabilities
        });
        return makeResult({
            ok: true,
            command: 'actor',
            cwd: options.cwd,
            messages: [message('info', 'ATM_ACTOR_REGISTERED', 'Actor identity has been registered.', {
                    actorId: written.actor.actorId,
                    actorKind: written.actor.actorKind
                })],
            evidence: {
                actor: written.actor,
                registryPath: written.path
            }
        });
    }
    if (options.action === 'adopt') {
        return runActorAdopt(options);
    }
    if (options.action === 'list') {
        const registry = readActorRegistry(options.cwd);
        return makeResult({
            ok: true,
            command: 'actor',
            cwd: options.cwd,
            messages: [message('info', 'ATM_ACTOR_LIST', `Loaded ${registry.actors.length} actor identity record(s).`)],
            evidence: {
                registryPath: actorRegistryRelativePath,
                actors: registry.actors
            }
        });
    }
    const resolved = requireResolvedActor(options.actorId);
    const actor = findActorByResolvedId(options.cwd, resolved);
    if (!actor) {
        throw new CliError('ATM_ACTOR_NOT_FOUND', `Actor ${resolved.actorId} is not registered in ${actorRegistryRelativePath}.`, {
            exitCode: 1,
            details: {
                actorId: resolved.actorId,
                source: resolved.source
            }
        });
    }
    if (options.action === 'resolve') {
        return makeResult({
            ok: true,
            command: 'actor',
            cwd: options.cwd,
            messages: [message('info', 'ATM_ACTOR_RESOLVED', 'Resolved actor identity from explicit option or environment.')],
            evidence: {
                resolvedFrom: resolved.source,
                actorId: resolved.actorId,
                actor,
                envPriority: [actorIdEnvVar, 'AGENT_IDENTITY']
            }
        });
    }
    const gitName = readGitLocalConfig(options.cwd, 'user.name');
    const gitEmail = readGitLocalConfig(options.cwd, 'user.email');
    const expectedName = actor.gitName ?? null;
    const expectedEmail = actor.gitEmail ?? null;
    const nameMatches = expectedName !== null && gitName === expectedName;
    const emailMatches = expectedEmail !== null && gitEmail === expectedEmail;
    const ok = nameMatches && emailMatches;
    return makeResult({
        ok,
        command: 'actor',
        cwd: options.cwd,
        messages: [ok
                ? message('info', 'ATM_ACTOR_VERIFY_GIT_OK', 'Git identity matches the resolved actor.')
                : message('error', 'ATM_ACTOR_VERIFY_GIT_MISMATCH', 'Git identity does not match the resolved actor.', {
                    actorId: actor.actorId,
                    expectedName,
                    expectedEmail,
                    actualName: gitName,
                    actualEmail: gitEmail
                })],
        evidence: {
            actorId: actor.actorId,
            resolvedFrom: resolved.source,
            expected: {
                gitName: expectedName,
                gitEmail: expectedEmail
            },
            actual: {
                gitName,
                gitEmail
            },
            matches: {
                gitName: nameMatches,
                gitEmail: emailMatches
            }
        }
    });
}
function runActorAdopt(options) {
    if (!options.editor) {
        throw new CliError('ATM_CLI_USAGE', 'actor adopt requires --editor <editor-slug>.', { exitCode: 2 });
    }
    if (!options.model) {
        throw new CliError('ATM_CLI_USAGE', 'actor adopt requires --model <model-slug>.', { exitCode: 2 });
    }
    const actorKind = sanitizeActorKind(options.actorKind ?? 'ai-agent');
    if (!actorKind) {
        throw new CliError('ATM_CLI_USAGE', 'actor adopt --kind must be human | ai-agent | automation.', { exitCode: 2 });
    }
    const slug = composeAdoptSlug(options.editor, options.model);
    const gitName = options.gitName ?? slug;
    const gitEmail = options.gitEmail ?? `${slug}@atm.local`;
    const displayName = options.displayName ?? slug;
    const previousIdentity = readRuntimeIdentityDefault(options.cwd);
    const previousActorId = previousIdentity?.actorId ?? null;
    const gitSnapshot = snapshotGitLocalIdentity(options.cwd);
    let actorRegistryPath = null;
    let gitConfigChanged = false;
    try {
        const written = upsertActorRecord(options.cwd, {
            actorId: slug,
            actorKind,
            displayName,
            provider: options.provider ?? undefined,
            editor: options.editor,
            gitName,
            gitEmail,
            contact: options.contact ?? undefined,
            capabilities: options.capabilities
        });
        actorRegistryPath = written.path;
        writeGitLocalIdentity(options.cwd, gitName, gitEmail);
        gitConfigChanged = gitSnapshot.name !== gitName || gitSnapshot.email !== gitEmail;
        writeRuntimeIdentityDefault(options.cwd, {
            schemaId: 'atm.identityDefault.v1',
            specVersion: '0.1.0',
            actorId: slug,
            gitName,
            gitEmail,
            editor: options.editor,
            provider: options.provider ?? null,
            activeSessionId: options.session ?? null,
            updatedAt: new Date().toISOString()
        });
    }
    catch (error) {
        try {
            restoreGitLocalIdentity(options.cwd, gitSnapshot);
        }
        catch { /* best-effort */ }
        const errMessage = error instanceof Error ? error.message : String(error);
        throw new CliError('ATM_ACTOR_ADOPT_FAILED', `actor adopt transaction failed and git config was rolled back: ${errMessage}`, {
            exitCode: 1,
            details: {
                actorId: slug,
                gitSnapshot
            }
        });
    }
    return makeResult({
        ok: true,
        command: 'actor',
        cwd: options.cwd,
        messages: [message('info', 'ATM_ACTOR_ADOPTED', 'Actor identity adopted; registry, git config, and runtime default are in sync.', {
                actorId: slug,
                previousActorId,
                gitConfigChanged
            })],
        evidence: {
            actorId: slug,
            previousActorId,
            gitConfigChanged,
            runtimeDefaultPath: runtimeIdentityRelativePath,
            registryPath: actorRegistryPath,
            editor: options.editor,
            model: options.model,
            activeSessionId: options.session ?? null
        }
    });
}
function parseActorArgs(argv) {
    const state = {
        cwd: process.cwd(),
        action: null,
        actorId: null,
        actorKind: null,
        displayName: null,
        provider: null,
        editor: null,
        model: null,
        session: null,
        gitName: null,
        gitEmail: null,
        contact: null,
        capabilities: []
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            state.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--id') {
            state.actorId = requireValue(argv, index, '--id');
            index += 1;
            continue;
        }
        if (arg === '--kind') {
            state.actorKind = requireValue(argv, index, '--kind');
            index += 1;
            continue;
        }
        if (arg === '--name') {
            state.displayName = requireValue(argv, index, '--name');
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
        if (arg === '--model') {
            state.model = requireValue(argv, index, '--model');
            index += 1;
            continue;
        }
        if (arg === '--session') {
            state.session = requireValue(argv, index, '--session');
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
            state.capabilities = requireValue(argv, index, '--capabilities')
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean);
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        if (arg.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `actor does not support option ${arg}`, { exitCode: 2 });
        }
        if (state.action) {
            throw new CliError('ATM_CLI_USAGE', 'actor accepts only one action.', { exitCode: 2 });
        }
        state.action = arg;
    }
    if (!state.action || !['register', 'list', 'resolve', 'verify-git', 'adopt'].includes(state.action)) {
        throw new CliError('ATM_CLI_USAGE', 'actor supports: register, list, resolve, verify-git, adopt', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(state.cwd),
        action: state.action,
        actorId: state.actorId,
        actorKind: state.actorKind,
        displayName: state.displayName,
        provider: state.provider,
        editor: state.editor,
        model: state.model,
        session: state.session,
        gitName: state.gitName,
        gitEmail: state.gitEmail,
        contact: state.contact,
        capabilities: state.capabilities
    };
}
function requireValue(argv, optionIndex, optionName) {
    const value = argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `actor requires a value for ${optionName}`, { exitCode: 2 });
    }
    return value;
}
function requireResolvedActor(inputActorId) {
    const resolved = resolveActorId(inputActorId);
    if (resolved)
        return resolved;
    throw new CliError('ATM_ACTOR_ID_MISSING', `No actor identity was provided. Use --id or set ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, {
        exitCode: 2
    });
}
function readGitLocalConfig(cwd, key) {
    try {
        const value = execSync(`git config --local --get ${key}`, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
