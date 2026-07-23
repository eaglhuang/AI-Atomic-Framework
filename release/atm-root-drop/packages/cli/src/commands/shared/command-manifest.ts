import { createHash } from 'node:crypto';
import type { SharedWriteActorAuthoritySource } from './identity-normalization.ts';

export type AtmCommandManifestV1 = {
  readonly schemaId: 'atm.commandManifest.v1';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly envRefs?: readonly string[];
  readonly timeoutMs?: number;
  readonly stdinSha256?: string | null;
  readonly ioDigest?: string | null;
};

export type SharedWriteRecoveryActorAuthority = {
  readonly actorId: string;
  readonly resolutionSource: SharedWriteActorAuthoritySource | 'steward-input';
  readonly laneSessionId: string | null;
  readonly copyableCommand: string;
};

export type OrderedCommandManifestStep = {
  readonly id: string;
  readonly manifest: AtmCommandManifestV1;
  readonly display: string;
  readonly actorAuthority?: SharedWriteRecoveryActorAuthority;
};

export function attachSharedWriteActorAuthority(
  step: OrderedCommandManifestStep,
  authority: SharedWriteRecoveryActorAuthority
): OrderedCommandManifestStep {
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

export function buildCommandManifest(input: {
  readonly executable?: string;
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly envRefs?: readonly string[];
  readonly timeoutMs?: number;
  readonly notes?: string;
}): AtmCommandManifestV1 {
  const manifest: AtmCommandManifestV1 = {
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

export function renderCommandManifest(manifest: AtmCommandManifestV1): string {
  const envPrefix = Object.entries(manifest.env ?? {})
    .map(([key, value]) => `${key}=${value}`);
  return [...envPrefix, manifest.executable, ...manifest.argv].map(quoteCliValueIfNeeded).join(' ');
}

export function buildOrderedCommandStep(id: string, manifest: AtmCommandManifestV1): OrderedCommandManifestStep {
  return { id, manifest, display: renderCommandManifest(manifest) };
}

function stableEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)));
}

function digestCommandParts(executable: string, argv: readonly string[], env: Record<string, string>): string {
  const payload = JSON.stringify({ executable, argv, env: stableEnv(env) });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function quoteCliValueIfNeeded(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : quoteCliValue(value);
}

function quoteCliValue(value: string): string {
  return JSON.stringify(String(value));
}
