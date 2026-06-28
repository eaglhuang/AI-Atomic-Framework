import type { ActorKind, ActorRecord, ActorRegistryDocument } from '@ai-atomic-framework/core';
export declare const actorRegistryRelativePath: ".atm/catalog/registry/actors.json";
export declare const runtimeIdentityRelativePath: ".atm/runtime/identity/default.json";
export declare const runtimeActorIdentityDirectoryRelativePath: ".atm/runtime/identity/actors";
export declare const actorIdEnvVar: "ATM_ACTOR_ID";
export declare const legacyActorIdEnvVar: "AGENT_IDENTITY";
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
export declare function readActorRegistry(cwd: string): ActorRegistryDocument;
export declare function writeActorRegistry(cwd: string, actors: readonly ActorRecord[]): string;
export declare function inspectTrackedActorRegistryState(cwd: string): TrackedActorRegistryState;
export declare function upsertActorRecord(cwd: string, input: CreateActorInput): {
    actor: ActorRecord;
    path: string;
};
export declare function readRuntimeIdentityDefault(cwd: string): RuntimeIdentityDefaultDocument | null;
export declare function writeRuntimeIdentityDefault(cwd: string, document: RuntimeIdentityDefaultDocument): string;
export declare function clearRuntimeIdentityDefault(cwd: string): boolean;
export declare function runtimeIdentityActorRelativePath(actorId: string): string;
export declare function readRuntimeIdentityForActor(cwd: string, actorId: string): RuntimeIdentityDefaultDocument | null;
export declare function writeRuntimeIdentityForActor(cwd: string, actorId: string, document: RuntimeIdentityDefaultDocument): string;
export declare function clearRuntimeIdentityForActor(cwd: string, actorId: string): boolean;
export declare function resolveActorId(inputActorId?: string | null, cwd?: string | null): ResolvedActorId | null;
export declare function findActorByResolvedId(cwd: string, resolved: ResolvedActorId): ActorRecord | null;
export declare function sanitizeActorKind(value: unknown): ActorKind | null;
export interface GitLocalIdentitySnapshot {
    readonly name: string | null;
    readonly email: string | null;
}
export declare function readGitLocalConfigValue(cwd: string, key: 'user.name' | 'user.email'): string | null;
export declare function snapshotGitLocalIdentity(cwd: string): GitLocalIdentitySnapshot;
export declare function writeGitLocalIdentity(cwd: string, name: string, email: string): void;
export declare function restoreGitLocalIdentity(cwd: string, snapshot: GitLocalIdentitySnapshot): void;
export declare function composeAdoptSlug(editor: string, model: string): string;
