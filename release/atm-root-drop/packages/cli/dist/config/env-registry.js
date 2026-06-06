/**
 * Central registry of ATM_* environment variables consumed by the framework.
 *
 * This is the single source of truth for which env vars exist, what they do,
 * and whether they are public host-facing knobs or internal test overrides.
 * `docs/environment-variables.md` is generated/aligned from this registry.
 *
 * Runtime callers MAY continue to read `process.env.ATM_*` directly. The
 * registry exists primarily to (1) document the surface, (2) keep the public
 * docs in sync, and (3) provide typed lookup helpers for new callers.
 */
export const envRegistry = Object.freeze([
    {
        name: 'ATM_TEMP_ROOT',
        surface: 'public',
        kind: 'path',
        purpose: 'Override the directory used for ephemeral workspaces (self-host-alpha, smoke tests).',
        fallback: 'OS temp dir under a workspace-specific subfolder.',
        consumer: 'temp-workspace.ts'
    },
    {
        name: 'ATM_RELEASE_TRUST_ROOT',
        surface: 'public',
        kind: 'path',
        purpose: 'Override where the CLI looks for the bundled release trust manifest at startup.',
        fallback: 'Bundled trust manifest shipped with the package.',
        consumer: 'startup-integrity.ts'
    },
    {
        name: 'ATM_COMPATIBILITY_MATRIX_PATH',
        surface: 'public',
        kind: 'path',
        purpose: 'Override the path to compatibility-matrix.json (ATMChart version compatibility data).',
        fallback: 'Bundled compatibility-matrix.json at the framework root.',
        consumer: 'commands/atm-chart.ts'
    },
    {
        name: 'ATM_COMPATIBILITY_LEGACY_MATRIX_PATH',
        surface: 'internal-test',
        kind: 'path',
        purpose: 'Override the path to the legacy compatibility matrix used for migration fixtures.',
        fallback: 'Bundled legacy matrix path; absence is treated as no legacy data.',
        consumer: 'commands/atm-chart.ts'
    },
    {
        name: 'ATM_KNOWN_BAD_VERSIONS_PATH',
        surface: 'public',
        kind: 'path',
        purpose: 'Override the path to known-bad-versions.json (startup safeguard manifest).',
        fallback: 'Walk up from the bundled manifest root; missing manifest is treated as "no entries".',
        consumer: 'startup-known-bad.ts'
    },
    {
        name: 'ATM_KNOWN_BAD_ROOT',
        surface: 'public',
        kind: 'path',
        purpose: 'Override the root directory searched for known-bad-versions.json.',
        fallback: 'Module-relative search starting at packages/cli/src.',
        consumer: 'startup-known-bad.ts'
    },
    {
        name: 'ATM_KNOWN_BAD_VERSION',
        surface: 'internal-test',
        kind: 'string',
        purpose: 'Force the CLI to report a specific version at startup for known-bad checks.',
        fallback: 'Version read from the framework package.json.',
        consumer: 'startup-known-bad.ts'
    }
]);
/** Lookup a descriptor by name. Returns undefined if the name is not registered. */
export function findEnvDescriptor(name) {
    return envRegistry.find((entry) => entry.name === name);
}
/**
 * Read a registered env var. Returns the raw string value (trimmed) or undefined.
 * Unregistered names throw — this is intentional: new env vars must be added to
 * the registry first so docs stay accurate.
 */
export function readEnvVar(name) {
    if (!findEnvDescriptor(name)) {
        throw new Error(`Unregistered ATM env var: ${name}. Add it to envRegistry first.`);
    }
    const value = process.env[name];
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
