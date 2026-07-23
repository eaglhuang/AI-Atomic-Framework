import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { ActorKind, ActorRecord, ActorRegistryDocument } from '@ai-atomic-framework/core';

export const actorRegistryRelativePath = '.atm/catalog/registry/actors.json' as const;
export const runtimeIdentityRelativePath = '.atm/runtime/identity/default.json' as const;
export const runtimeActorIdentityDirectoryRelativePath = '.atm/runtime/identity/actors' as const;
export const actorIdEnvVar = 'ATM_ACTOR_ID' as const;
export const legacyActorIdEnvVar = 'AGENT_IDENTITY' as const;

export interface TrackedActorRegistryState {
  readonly path: typeof actorRegistryRelativePath;
  readonly tracked: boolean;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly blocking: boolean;
  readonly status: 'untracked' | 'clean' | 'staged-only' | 'unstaged-only' | 'mixed';
}

export interface ResolvedActorId {
  readonly actorId: string;
  readonly source: 'option' | 'env' | 'legacy-env' | 'repo-default';
}

export interface ActorResolutionDiagnostic {
  readonly resolved: ResolvedActorId | null;
  readonly precedence: readonly ['option', 'env', 'repo-default', 'legacy-env'];
  readonly envActorId: string | null;
  readonly legacyEnvActorId: string | null;
  readonly repoDefaultActorId: string | null;
  readonly repoDefaultPath: typeof runtimeIdentityRelativePath;
  readonly warning: string | null;
  readonly requiredCommand: string | null;
}

export interface RuntimeIdentityDefaultDocument {
  readonly schemaId: 'atm.identityDefault.v1';
  readonly specVersion: '0.1.0';
  readonly actorId: string;
  readonly gitName?: string | null;
  readonly gitEmail?: string | null;
  readonly editor?: string | null;
  readonly provider?: string | null;
  readonly activeSessionId?: string | null;
  readonly updatedAt: string;
}

export interface CreateActorInput {
  readonly actorId: string;
  readonly actorKind: ActorKind;
  readonly displayName: string;
  readonly provider?: string;
  readonly editor?: string;
  readonly gitName?: string;
  readonly gitEmail?: string;
  readonly contact?: string;
  readonly capabilities?: readonly string[];
}

export function readActorRegistry(cwd: string): ActorRegistryDocument {
  const absolutePath = path.join(cwd, actorRegistryRelativePath);
  if (!existsSync(absolutePath)) {
    return {
      schemaId: 'atm.actorRegistry',
      specVersion: '0.1.0',
      generatedAt: new Date().toISOString(),
      actors: []
    };
  }
  const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Partial<ActorRegistryDocument>;
  const actors = Array.isArray(parsed.actors)
    ? parsed.actors
      .filter((entry): entry is ActorRecord => Boolean(entry && typeof entry === 'object'))
      .map((entry) => normalizeActorRecord(entry))
      .filter((entry): entry is ActorRecord => entry !== null)
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

export function writeActorRegistry(cwd: string, actors: readonly ActorRecord[]): string {
  const absolutePath = path.join(cwd, actorRegistryRelativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const document: ActorRegistryDocument = {
    schemaId: 'atm.actorRegistry',
    specVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    actors: [...actors].sort((left, right) => left.actorId.localeCompare(right.actorId))
  };
  writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return actorRegistryRelativePath;
}

export function inspectTrackedActorRegistryState(cwd: string): TrackedActorRegistryState {
  const tracked = runGitPathProbe(cwd, ['ls-files', '--error-unmatch', '--', actorRegistryRelativePath]);
  if (!tracked) {
    return {
      path: actorRegistryRelativePath,
      tracked: false,
      staged: false,
      unstaged: false,
      blocking: false,
      status: 'untracked'
    };
  }
  const staged = runGitPathProbe(cwd, ['diff', '--cached', '--name-only', '--', actorRegistryRelativePath]);
  const unstaged = runGitPathProbe(cwd, ['diff', '--name-only', '--', actorRegistryRelativePath]);
  const status = staged && unstaged
    ? 'mixed'
    : staged
      ? 'staged-only'
      : unstaged
        ? 'unstaged-only'
        : 'clean';
  return {
    path: actorRegistryRelativePath,
    tracked: true,
    staged,
    unstaged,
    blocking: unstaged,
    status
  };
}

export function upsertActorRecord(cwd: string, input: CreateActorInput): { actor: ActorRecord; path: string } {
  const registry = readActorRegistry(cwd);
  const now = new Date().toISOString();
  const existing = registry.actors.find((entry) => entry.actorId === input.actorId);
  const actor: ActorRecord = {
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

export function readRuntimeIdentityDefault(cwd: string): RuntimeIdentityDefaultDocument | null {
  const absolutePath = path.join(path.resolve(cwd), runtimeIdentityRelativePath);
  if (!existsSync(absolutePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Partial<RuntimeIdentityDefaultDocument>;
    const actorId = sanitizeOptional(parsed.actorId);
    if (!actorId) return null;
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
  } catch {
    return null;
  }
}

export function writeRuntimeIdentityDefault(cwd: string, document: RuntimeIdentityDefaultDocument): string {
  const absolutePath = path.join(path.resolve(cwd), runtimeIdentityRelativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return runtimeIdentityRelativePath;
}

export function clearRuntimeIdentityDefault(cwd: string): boolean {
  const absolutePath = path.join(path.resolve(cwd), runtimeIdentityRelativePath);
  if (!existsSync(absolutePath)) return false;
  unlinkSync(absolutePath);
  return true;
}

export function runtimeIdentityActorRelativePath(actorId: string): string {
  return `${runtimeActorIdentityDirectoryRelativePath}/${actorId}.json`;
}

export function readRuntimeIdentityForActor(cwd: string, actorId: string): RuntimeIdentityDefaultDocument | null {
  const absolutePath = path.join(path.resolve(cwd), runtimeIdentityActorRelativePath(actorId));
  if (!existsSync(absolutePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Partial<RuntimeIdentityDefaultDocument>;
    const parsedActorId = sanitizeOptional(parsed.actorId);
    if (!parsedActorId) return null;
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
  } catch {
    return null;
  }
}

export function writeRuntimeIdentityForActor(cwd: string, actorId: string, document: RuntimeIdentityDefaultDocument): string {
  const absolutePath = path.join(path.resolve(cwd), runtimeIdentityActorRelativePath(actorId));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return runtimeIdentityActorRelativePath(actorId);
}

export function clearRuntimeIdentityForActor(cwd: string, actorId: string): boolean {
  const absolutePath = path.join(path.resolve(cwd), runtimeIdentityActorRelativePath(actorId));
  if (!existsSync(absolutePath)) return false;
  unlinkSync(absolutePath);
  return true;
}

export function resolveActorId(inputActorId?: string | null, cwd?: string | null): ResolvedActorId | null {
  const explicit = sanitizeOptional(inputActorId);
  if (explicit) {
    return { actorId: explicit, source: 'option' };
  }
  const envActor = sanitizeOptional(process.env[actorIdEnvVar]);
  if (envActor) {
    return { actorId: envActor, source: 'env' };
  }
  const defaultIdentity = cwd ? readRuntimeIdentityDefault(cwd) : null;
  if (defaultIdentity?.actorId) {
    return { actorId: defaultIdentity.actorId, source: 'repo-default' };
  }
  const legacyEnvActor = sanitizeOptional(process.env[legacyActorIdEnvVar]);
  if (legacyEnvActor) {
    return { actorId: legacyEnvActor, source: 'legacy-env' };
  }
  return null;
}

export function describeActorResolution(inputActorId?: string | null, cwd?: string | null): ActorResolutionDiagnostic {
  const explicit = sanitizeOptional(inputActorId);
  const envActor = sanitizeOptional(process.env[actorIdEnvVar]) ?? null;
  const legacyEnvActor = sanitizeOptional(process.env[legacyActorIdEnvVar]) ?? null;
  const repoDefaultActor = cwd ? readRuntimeIdentityDefault(cwd)?.actorId ?? null : null;
  const resolved = resolveActorId(inputActorId, cwd);
  const legacyIsDiagnosticOnly = Boolean(
    legacyEnvActor
    && resolved
    && (
      resolved.source !== 'legacy-env'
      || (repoDefaultActor !== null && repoDefaultActor !== legacyEnvActor)
      || (envActor !== null && envActor !== legacyEnvActor)
    )
  );
  // Prefer the continuity diagnostic when AGENT_IDENTITY disagrees with an
  // authoritative actor; only then surface repo-default override guidance.
  // When repo-default already won, stale AGENT_IDENTITY stays silent provenance.
  const warning = legacyIsDiagnosticOnly
      && legacyEnvActor
      && resolved
      && resolved.actorId !== legacyEnvActor
      && resolved.source !== 'repo-default'
      && resolved.source !== 'legacy-env'
    ? `${legacyActorIdEnvVar}=${legacyEnvActor} is diagnostic-only and must not replace authoritative actor ${resolved.actorId}. Prefer --actor or ${actorIdEnvVar}=${resolved.actorId}.`
    : !explicit && resolved && resolved.source !== 'repo-default' && repoDefaultActor && repoDefaultActor !== resolved.actorId
      ? `${actorResolutionSourceLabel(resolved.source)} actor ${resolved.actorId} overrides repo default actor ${repoDefaultActor}. Pass --actor ${repoDefaultActor} to claim as the repo default actor, or clear/update the environment identity before claiming.`
      : null;
  return {
    resolved,
    precedence: ['option', 'env', 'repo-default', 'legacy-env'],
    envActorId: envActor,
    legacyEnvActorId: legacyEnvActor,
    repoDefaultActorId: repoDefaultActor,
    repoDefaultPath: runtimeIdentityRelativePath,
    warning,
    requiredCommand: warning && resolved?.actorId
      ? resolved.source === 'repo-default' && repoDefaultActor
        ? `node atm.mjs next --claim --actor ${repoDefaultActor} --prompt "<task-or-prompt>" --json`
        : `${actorIdEnvVar}=${resolved.actorId} <shared-write-command>`
      : warning && repoDefaultActor
        ? `node atm.mjs next --claim --actor ${repoDefaultActor} --prompt "<task-or-prompt>" --json`
        : null
  };
}

export function findActorByResolvedId(cwd: string, resolved: ResolvedActorId): ActorRecord | null {
  return readActorRegistry(cwd).actors.find((entry) => entry.actorId === resolved.actorId) ?? null;
}

function actorResolutionSourceLabel(source: ResolvedActorId['source']): string {
  if (source === 'env') return actorIdEnvVar;
  if (source === 'legacy-env') return legacyActorIdEnvVar;
  if (source === 'option') return '--actor';
  return 'repo default';
}

function runGitPathProbe(cwd: string, args: readonly string[]): boolean {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

function normalizeActorRecord(value: ActorRecord): ActorRecord | null {
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

export function sanitizeActorKind(value: unknown): ActorKind | null {
  const normalized = sanitizeOptional(value)?.toLowerCase();
  if (normalized === 'human' || normalized === 'ai-agent' || normalized === 'automation') {
    return normalized;
  }
  return null;
}

function sanitizeOptional(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface GitLocalIdentitySnapshot {
  readonly name: string | null;
  readonly email: string | null;
}

export function readGitLocalConfigValue(cwd: string, key: 'user.name' | 'user.email'): string | null {
  try {
    const value = execFileSync('git', ['config', '--local', '--get', key], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function snapshotGitLocalIdentity(cwd: string): GitLocalIdentitySnapshot {
  return {
    name: readGitLocalConfigValue(cwd, 'user.name'),
    email: readGitLocalConfigValue(cwd, 'user.email')
  };
}

export function writeGitLocalIdentity(cwd: string, name: string, email: string): void {
  execFileSync('git', ['config', '--local', 'user.name', name], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
  execFileSync('git', ['config', '--local', 'user.email', email], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
}

export function restoreGitLocalIdentity(cwd: string, snapshot: GitLocalIdentitySnapshot): void {
  if (snapshot.name === null) {
    try { execFileSync('git', ['config', '--local', '--unset', 'user.name'], { cwd, stdio: ['ignore', 'ignore', 'ignore'] }); } catch {}
  } else {
    execFileSync('git', ['config', '--local', 'user.name', snapshot.name], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
  }
  if (snapshot.email === null) {
    try { execFileSync('git', ['config', '--local', '--unset', 'user.email'], { cwd, stdio: ['ignore', 'ignore', 'ignore'] }); } catch {}
  } else {
    execFileSync('git', ['config', '--local', 'user.email', snapshot.email], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
  }
}

export function composeAdoptSlug(editor: string, model: string): string {
  const normalizedEditor = editor.trim().toLowerCase();
  const normalizedModel = model.trim().toLowerCase();
  if (!normalizedEditor || !normalizedModel) {
    throw new Error('composeAdoptSlug requires non-empty editor and model.');
  }
  return `${normalizedEditor}-${normalizedModel}`;
}

function sanitizeCapabilities(capabilities: unknown): readonly string[] | undefined {
  if (!Array.isArray(capabilities)) {
    return undefined;
  }
  const normalized = Array.from(new Set(
    capabilities
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
  ));
  return normalized.length > 0 ? normalized : undefined;
}
