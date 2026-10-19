import type { IntegrationAdapterId } from '../manifest/types.js';
import type { SkillInstallProfile, SkillTargetScope } from './install-profile.js';
import { type AdapterCapabilities } from './skill-distribution-manager.js';
import type { ExternalSkillCatalogSkip, FederatedSkillCatalog } from './external-skill-catalog.js';
export type EditorGlobalOverlayMode = 'dry-run' | 'apply' | 'verify';
export type EditorGlobalOverlayOperationKind = 'add' | 'update';
export type EditorGlobalOverlayAdapterId = 'codex' | 'claude-code' | (string & {});
export interface EditorGlobalOverlayAdapter {
    readonly adapterId: EditorGlobalOverlayAdapterId;
    readonly displayName: string;
    readonly globalTargetDir: string;
    readonly globalManifestPath: string;
    readonly capabilities: AdapterCapabilities;
    readonly supported: boolean;
    readonly unsupportedReason: string | null;
}
export interface EditorGlobalSkillManifestFile {
    readonly path: string;
    readonly sha256: `sha256:${string}`;
    readonly sizeBytes: number;
    readonly sourceSkillId: string;
    readonly sourceDigest: `sha256:${string}`;
    readonly fileFormat: string;
}
export interface EditorGlobalSkillManifest {
    readonly schemaId: 'atm.editorGlobalSkillManifest.v1';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly adapterId: string;
    readonly overlayProfileId: string;
    readonly targetRootRef: string;
    readonly targetDir: string;
    readonly generatedAt: string;
    readonly sourceCatalogDigest: `sha256:${string}`;
    readonly planDigest: `sha256:${string}`;
    readonly files: readonly EditorGlobalSkillManifestFile[];
}
export interface EditorGlobalOverlayFileOperation {
    readonly kind: EditorGlobalOverlayOperationKind;
    readonly path: string;
    readonly skillId: string;
    readonly expectedSha256: `sha256:${string}`;
    readonly sourceDigest: `sha256:${string}`;
    readonly currentSha256: `sha256:${string}` | null;
    readonly fileFormat: string;
    readonly content: string | Uint8Array;
}
export interface EditorGlobalOverlayPlan {
    readonly schemaId: 'atm.editorGlobalOverlayPlan.v1';
    readonly specVersion: '0.1.0';
    readonly mode: EditorGlobalOverlayMode;
    readonly adapterId: string;
    readonly overlayProfileId: string;
    readonly targetRootRef: string;
    readonly sourceCatalogDigest: `sha256:${string}`;
    readonly additions: readonly EditorGlobalOverlayFileOperation[];
    readonly updates: readonly EditorGlobalOverlayFileOperation[];
    readonly fallbacks: readonly string[];
    readonly skippedInvalidSources: readonly ExternalSkillCatalogSkip[];
    readonly collisions: readonly string[];
    readonly staleManagedFiles: readonly string[];
    readonly preservedUnmanagedFiles: readonly string[];
    readonly managedManifest: EditorGlobalSkillManifest;
    readonly planDigest: `sha256:${string}`;
    readonly okToApply: boolean;
}
export interface EditorGlobalOverlayApplyResult {
    readonly schemaId: 'atm.editorGlobalOverlayApplyResult.v1';
    readonly ok: boolean;
    readonly dryRun: boolean;
    readonly adapterId: string;
    readonly manifestPath: string;
    readonly writtenFiles: readonly string[];
    readonly preservedUnmanagedFiles: readonly string[];
    readonly staleManagedFiles: readonly string[];
    readonly planDigest: `sha256:${string}`;
}
export declare function getEditorGlobalOverlayAdapter(adapterId: IntegrationAdapterId): EditorGlobalOverlayAdapter;
export declare function createEditorGlobalOverlayPlan(input: {
    readonly adapterId: IntegrationAdapterId;
    readonly targetRoot: string;
    readonly targetRootRef: string;
    readonly federatedCatalog: FederatedSkillCatalog;
    readonly installProfile: SkillInstallProfile;
    readonly targetScope: SkillTargetScope;
    readonly existingManifest?: EditorGlobalSkillManifest | null;
    readonly mode?: EditorGlobalOverlayMode;
    readonly now?: string;
}): EditorGlobalOverlayPlan;
export declare function applyEditorGlobalOverlayPlan(input: {
    readonly plan: EditorGlobalOverlayPlan;
    readonly targetRoot: string;
    readonly expectedPlanDigest: `sha256:${string}`;
    readonly dryRun?: boolean;
}): EditorGlobalOverlayApplyResult;
export declare function formatEditorGlobalSkillManifest(manifest: EditorGlobalSkillManifest): string;
