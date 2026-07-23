import { createHash } from 'node:crypto';
export function attachSharedWriteActorAuthority(step, authority) {
    return {
        ...step,
        actorAuthority: {
            actorId: authority.actorId,
            resolutionSource: authority.resolutionSource,
            laneSessionId: authority.laneSessionId,
            copyableCommand: authority.copyableCommand || step.display
        }
    };
}
export function buildCommandManifest(input) {
    const manifest = {
        schemaId: 'atm.commandManifest.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: input.notes ?? 'shellless ATM command manifest' },
        executable: input.executable ?? 'node',
        argv: [...(input.argv ?? [])],
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.env ? { env: stableEnv(input.env) } : {}),
        ...(input.envRefs ? { envRefs: [...input.envRefs] } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        stdinSha256: null,
        ioDigest: digestCommandParts(input.executable ?? 'node', input.argv ?? [], input.env ?? {})
    };
    return manifest;
}
export function renderCommandManifest(manifest) {
    const envPrefix = Object.entries(manifest.env ?? {})
        .map(([key, value]) => `${key}=${value}`);
    return [...envPrefix, manifest.executable, ...manifest.argv].map(quoteCliValueIfNeeded).join(' ');
}
export function buildOrderedCommandStep(id, manifest) {
    return { id, manifest, display: renderCommandManifest(manifest) };
}
function stableEnv(env) {
    return Object.fromEntries(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)));
}
function digestCommandParts(executable, argv, env) {
    const payload = JSON.stringify({ executable, argv, env: stableEnv(env) });
    return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}
function quoteCliValueIfNeeded(value) {
    return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : quoteCliValue(value);
}
function quoteCliValue(value) {
    return JSON.stringify(String(value));
}
