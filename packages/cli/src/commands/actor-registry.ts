import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ActorKind, ActorRecord, ActorRegistryDocument } from '@ai-atomic-framework/core';

export const actorRegistryRelativePath = '.atm/catalog/registry/actors.json' as const;
export const runtimeIdentityRelativePath = '.atm/runtime/identity/default.json' as const;
export const actorIdEnvVar = 'ATM_ACTOR_ID' as const;
export const legacyActorIdEnvVar = 'AGENT_IDENTITY' as const;

export interface ResolvedActorId {
  readonly actorId: string;
  readonly source: 'option' | 'env' | 'legacy-env' | 'repo-default';
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

export function resolveActorId(inputActorId?: string | null, cwd?: string | null): ResolvedActorId | null {
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

export function findActorByResolvedId(cwd: string, resolved: ResolvedActorId): ActorRecord | null {
  return readActorRegistry(cwd).actors.find((entry) => entry.actorId === resolved.actorId) ?? null;
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
