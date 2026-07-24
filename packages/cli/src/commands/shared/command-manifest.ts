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
  /** Commands run without a shell by default; only an adapter may opt in. */
  readonly shell: boolean;
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
  readonly shell?: boolean;
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
    shell: input.shell ?? false,
    stdinSha256: null,
    ioDigest: digestCommandParts(input.executable ?? 'node', input.argv ?? [], input.env ?? {})
  };
  return manifest;
}

/**
 * ATM-GOV-0263: subcommands that operate on a single task and therefore require
 * a `--task <id>` argument to be executable. Modeled as data, not control flow,
 * so the executability check generalizes across the routing surfaces.
 */
export const TASK_SCOPED_SUBCOMMANDS_REQUIRING_TASK_ID: Readonly<Record<string, readonly string[]>> = {
  tasks: ['status', 'show', 'release', 'renew', 'handoff', 'takeover', 'block', 'abandon', 'close', 'finalize']
};

/** Aggregate ATM commands that need no `--task` and never emit ATM_CLI_USAGE for it. */
export const EXECUTABLE_AGGREGATE_STATUS_COMMANDS: readonly string[] = [
  'node atm.mjs status --json',
  'node atm.mjs broker status --json',
  'node atm.mjs team status --compact --json'
];

export interface CommandExecutabilityVerdict {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly taskScoped: boolean;
}

/**
 * Parse a `node atm.mjs …` command string into a shell-less manifest. Argument
 * boundaries are whitespace outside of matched quotes.
 */
export function parseAtmCommandToManifest(command: string): AtmCommandManifestV1 {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0] ?? 'node';
  return buildCommandManifest({ executable, argv: tokens.slice(1), notes: 'parsed ATM command manifest' });
}

/**
 * Decide whether an emitted ATM command string is executable as advertised: a
 * task-scoped subcommand must carry `--task <id>`, unless it is a known
 * aggregate command. This catches the class behind ATM-BUG-2026-07-20-206.
 */
export function inspectCommandExecutability(command: string): CommandExecutabilityVerdict {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty-command', taskScoped: false };
  if (EXECUTABLE_AGGREGATE_STATUS_COMMANDS.includes(trimmed)) {
    return { ok: true, reason: null, taskScoped: false };
  }
  const tokens = tokenizeCommand(trimmed);
  const atmIndex = tokens.findIndex((token) => token === 'atm.mjs' || token.endsWith('/atm.mjs') || token.endsWith('\\atm.mjs'));
  if (atmIndex < 0) return { ok: true, reason: null, taskScoped: false };
  const group = tokens[atmIndex + 1];
  const subcommand = tokens[atmIndex + 2];
  const scopedSubcommands = group ? TASK_SCOPED_SUBCOMMANDS_REQUIRING_TASK_ID[group] : undefined;
  if (!group || !scopedSubcommands || !subcommand || !scopedSubcommands.includes(subcommand)) {
    return { ok: true, reason: null, taskScoped: false };
  }
  const hasTaskId = tokens.some((token, index) =>
    token === '--task' && typeof tokens[index + 1] === 'string' && tokens[index + 1].length > 0 && !tokens[index + 1].startsWith('--'));
  return hasTaskId
    ? { ok: true, reason: null, taskScoped: true }
    : { ok: false, reason: `${group} ${subcommand} requires --task <id>`, taskScoped: true };
}

function tokenizeCommand(command: string): string[] {
  const matches = command.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^["']|["']$/g, ''));
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
