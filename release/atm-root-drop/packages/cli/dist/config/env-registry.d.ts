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
export type EnvVarSurface = 'public' | 'internal-test';
export type EnvVarKind = 'path' | 'string' | 'boolean';
export interface EnvVarDescriptor {
    /** The env var name as it appears in process.env (always ATM_-prefixed). */
    readonly name: `ATM_${string}`;
    /** Whether this is a public host-facing knob or an internal test/dev override. */
    readonly surface: EnvVarSurface;
    /** Value kind. `path` is resolved relative to cwd. `boolean` accepts 1/0/true/false. */
    readonly kind: EnvVarKind;
    /** One-line plain-English purpose for docs. */
    readonly purpose: string;
    /** What the framework does when the var is unset. */
    readonly fallback: string;
    /** Module that reads this var (relative to packages/cli/src). */
    readonly consumer: string;
}
export declare const envRegistry: ReadonlyArray<EnvVarDescriptor>;
/** Lookup a descriptor by name. Returns undefined if the name is not registered. */
export declare function findEnvDescriptor(name: string): EnvVarDescriptor | undefined;
/**
 * Read a registered env var. Returns the raw string value (trimmed) or undefined.
 * Unregistered names throw — this is intentional: new env vars must be added to
 * the registry first so docs stay accurate.
 */
export declare function readEnvVar(name: EnvVarDescriptor['name']): string | undefined;
