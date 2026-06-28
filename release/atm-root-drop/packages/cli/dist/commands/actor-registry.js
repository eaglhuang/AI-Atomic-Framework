import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
export const actorRegistryRelativePath = '.atm/catalog/registry/actors.json';
export const runtimeIdentityRelativePath = '.atm/runtime/identity/default.json';
export const runtimeActorIdentityDirectoryRelativePath = '.atm/runtime/identity/actors';
export const actorIdEnvVar = 'ATM_ACTOR_ID';
export const legacyActorIdEnvVar = 'AGENT_IDENTITY';
export function readActorRegistry(cwd) {
    const absolutePath = path.join(cwd, actorRegistryRelativePath);
    if (!existsSync(absolutePath)) {
        return {
            schemaId: 'atm.actorRegistry',
            specVersion: '0.1.0',
            generatedAt: new Date().toISOString(),
            actors: []
        };
    }
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
    const actors = Array.isArray(parsed.actors)
        ? parsed.actors
            .filter((entry) => Boolean(entry && typeof entry === 'object'))
            .map((entry) => normalizeActorRecord(entry))
            .filter((entry) => entry !== null)
        : [];
    return {
        schemaId: 'atm.actorRegistry',
        specVersion: '0.1.0',
        generatedAt: typeof parsed.generatedAt === 'string' && parsed.generatedAt.trim()
            ? parsed.generatedAt
            : new Date().toISOString(),
        actors
    };
}
export function writeActorRegistry(cwd, actors) {
    const absolutePath = path.join(cwd, actorRegistryRelativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const document = {
        schemaId: 'atm.actorRegistry',
        specVersion: '0.1.0',
        generatedAt: new Date().toISOString(),
        actors: [...actors].sort((left, right) => left.actorId.localeCompare(right.actorId))
    };
    writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    return actorRegistryRelativePath;
}
export function upsertActorRecord(cwd, input) {
    const registry = readActorRegistry(cwd);
    const now = new Date().toISOString();
    const existing = registry.actors.find((entry) => entry.actorId === input.actorId);
    const actor = {
        actorId: input.actorId,
        actorKind: input.actorKind,
        displayName: input.displayName,
        provider: sanitizeOptional(input.provider),
        editor: sanitizeOptional(input.editor),
        gitName: sanitizeOptional(input.gitName),
        gitEmail: sanitizeOptional(input.gitEmail),
        contact: sanitizeOptional(input.contact),
        capabilities: sanitizeCapabilities(input.capabilities),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
    };
    const merged = [
        ...registry.actors.filter((entry) => entry.actorId !== input.actorId),
        actor
    ];
    const registryPath = writeActorRegistry(cwd, merged);
    return { actor, path: registryPath };
}
export function readRuntimeIdentityDefault(cwd) {
    const absolutePath = path.join(path.resolve(cwd), runtimeIdentityRelativePath);
    if (!existsSync(absolutePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
        const actorId = sanitizeOptional(parsed.actorId);
        if (!actorId)
            return null;
        return {
            schemaId: 'atm.identityDefault.v1',
            specVersion: '0.1.0',
            actorId,
            gitName: sanitizeOptional(parsed.gitName) ?? null,
            gitEmail: sanitizeOptional(parsed.gitEmail) ?? null,
            editor: sanitizeOptional(parsed.editor) ?? null,
            provider: sanitizeOptional(parsed.provider) ?? null,
            activeSessionId: sanitizeOptional(parsed.activeSessionId) ?? null,
            updatedAt: sanitizeOptional(parsed.updatedAt) ?? new Date().toISOString()
        };
    }
    catch {
        return null;
    }
}
export function writeRuntimeIdentityDefault(cwd, document) {
    const absolutePath = path.join(path.resolve(cwd), runtimeIdentityRelativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    return runtimeIdentityRelativePath;
}
export function clearRuntimeIdentityDefault(cwd) {
    const absolutePath = path.join(path.resolve(cwd), runtimeIdentityRelativePath);
    if (!existsSync(absolutePath))
        return false;
    unlinkSync(absolutePath);
    return true;
}
export function runtimeIdentityActorRelativePath(actorId) {
    return `${runtimeActorIdentityDirectoryRelativePath}/${actorId}.json`;
}
export function readRuntimeIdentityForActor(cwd, actorId) {
    const absolutePath = path.join(path.resolve(cwd), runtimeIdentityActorRelativePath(actorId));
    if (!existsSync(absolutePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
        const parsedActorId = sanitizeOptional(parsed.actorId);
        if (!parsedActorId)
            return null;
        return {
            schemaId: 'atm.identityDefault.v1',
            specVersion: '0.1.0',
            actorId: parsedActorId,
            gitName: sanitizeOptional(parsed.gitName) ?? null,
            gitEmail: sanitizeOptional(parsed.gitEmail) ?? null,
            editor: sanitizeOptional(parsed.editor) ?? null,
            provider: sanitizeOptional(parsed.provider) ?? null,
            activeSessionId: sanitizeOptional(parsed.activeSessionId) ?? null,
            updatedAt: sanitizeOptional(parsed.updatedAt) ?? new Date().toISOString()
        };
    }
    catch {
        return null;
    }
}
export function writeRuntimeIdentityForActor(cwd, actorId, document) {
    const absolutePath = path.join(path.resolve(cwd), runtimeIdentityActorRelativePath(actorId));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    return runtimeIdentityActorRelativePath(actorId);
}
export function clearRuntimeIdentityForActor(cwd, actorId) {
    const absolutePath = path.join(path.resolve(cwd), runtimeIdentityActorRelativePath(actorId));
    if (!existsSync(absolutePath))
        return false;
    unlinkSync(absolutePath);
    return true;
}
export function resolveActorId(inputActorId, cwd) {
    const explicit = sanitizeOptional(inputActorId);
    if (explicit) {
        return { actorId: explicit, source: 'option' };
    }
    const envActor = sanitizeOptional(process.env[actorIdEnvVar]);
    if (envActor) {
        return { actorId: envActor, source: 'env' };
    }
    const legacyEnvActor = sanitizeOptional(process.env[legacyActorIdEnvVar]);
    if (legacyEnvActor) {
        return { actorId: legacyEnvActor, source: 'legacy-env' };
    }
    const defaultIdentity = cwd ? readRuntimeIdentityDefault(cwd) : null;
    if (defaultIdentity?.actorId) {
        return { actorId: defaultIdentity.actorId, source: 'repo-default' };
    }
    return null;
}
export function findActorByResolvedId(cwd, resolved) {
    return readActorRegistry(cwd).actors.find((entry) => entry.actorId === resolved.actorId) ?? null;
}
function normalizeActorRecord(value) {
    const actorId = sanitizeOptional(value.actorId);
    const actorKind = sanitizeActorKind(value.actorKind);
    const displayName = sanitizeOptional(value.displayName);
    if (!actorId || !actorKind || !displayName) {
        return null;
    }
    return {
        actorId,
        actorKind,
        displayName,
        provider: sanitizeOptional(value.provider),
        editor: sanitizeOptional(value.editor),
        gitName: sanitizeOptional(value.gitName),
        gitEmail: sanitizeOptional(value.gitEmail),
        contact: sanitizeOptional(value.contact),
        capabilities: sanitizeCapabilities(value.capabilities),
        createdAt: sanitizeOptional(value.createdAt),
        updatedAt: sanitizeOptional(value.updatedAt)
    };
}
export function sanitizeActorKind(value) {
    const normalized = sanitizeOptional(value)?.toLowerCase();
    if (normalized === 'human' || normalized === 'ai-agent' || normalized === 'automation') {
        return normalized;
    }
    return null;
}
function sanitizeOptional(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
export function readGitLocalConfigValue(cwd, key) {
    try {
        const value = execFileSync('git', ['config', '--local', '--get', key], {
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
export function snapshotGitLocalIdentity(cwd) {
    return {
        name: readGitLocalConfigValue(cwd, 'user.name'),
        email: readGitLocalConfigValue(cwd, 'user.email')
    };
}
export function writeGitLocalIdentity(cwd, name, email) {
    execFileSync('git', ['config', '--local', 'user.name', name], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('git', ['config', '--local', 'user.email', email], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
}
export function restoreGitLocalIdentity(cwd, snapshot) {
    if (snapshot.name === null) {
        try {
            execFileSync('git', ['config', '--local', '--unset', 'user.name'], { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
        }
        catch { }
    }
    else {
        execFileSync('git', ['config', '--local', 'user.name', snapshot.name], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    }
    if (snapshot.email === null) {
        try {
            execFileSync('git', ['config', '--local', '--unset', 'user.email'], { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
        }
        catch { }
    }
    else {
        execFileSync('git', ['config', '--local', 'user.email', snapshot.email], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    }
}
export function composeAdoptSlug(editor, model) {
    const normalizedEditor = editor.trim().toLowerCase();
    const normalizedModel = model.trim().toLowerCase();
    if (!normalizedEditor || !normalizedModel) {
        throw new Error('composeAdoptSlug requires non-empty editor and model.');
    }
    return `${normalizedEditor}-${normalizedModel}`;
}
function sanitizeCapabilities(capabilities) {
    if (!Array.isArray(capabilities)) {
        return undefined;
    }
    const normalized = Array.from(new Set(capabilities
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)));
    return normalized.length > 0 ? normalized : undefined;
}
