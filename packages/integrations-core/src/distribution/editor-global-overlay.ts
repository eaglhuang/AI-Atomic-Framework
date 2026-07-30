import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInstallManifest, createManifestFileRecord } from '../manifest/construct.ts';
import { formatInstallManifest, normalizeManifestPath, resolveRepositoryPath, sha256Bytes, sha256File } from '../manifest/schema.ts';
import type { InstallManifest, InstallManifestFile, IntegrationAdapterId } from '../manifest/types.ts';
import type { SkillInstallProfile, SkillTargetScope } from './install-profile.ts';
import { resolveSkillInstallationPlan, type AdapterCapabilities } from './skill-distribution-manager.ts';
import type { ExternalSkillCatalogSkip, FederatedSkillCatalog } from './external-skill-catalog.ts';

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

export function getEditorGlobalOverlayAdapter(adapterId: IntegrationAdapterId): EditorGlobalOverlayAdapter {
  if (adapterId === 'codex') {
    return {
      adapterId,
      displayName: 'Codex global skills',
      globalTargetDir: '.codex/skills',
      globalManifestPath: '.codex/skill-overlays/atm-managed-skills.json',
      capabilities: {
        adapterId,
        fileFormats: ['skill', 'markdown'],
        supportsCompanionFiles: true,
        supportsCharterInjection: true
      },
      supported: true,
      unsupportedReason: null
    };
  }
  if (adapterId === 'claude-code') {
    return {
      adapterId,
      displayName: 'Claude Code global skills',
      globalTargetDir: '.claude/skills',
      globalManifestPath: '.claude/skill-overlays/atm-managed-skills.json',
      capabilities: {
        adapterId,
        fileFormats: ['skill', 'markdown'],
        supportsCompanionFiles: true,
        supportsCharterInjection: true
      },
      supported: true,
      unsupportedReason: null
    };
  }
  return {
    adapterId,
    displayName: `${adapterId} global skills`,
    globalTargetDir: `.atm/unsupported-global-overlays/${adapterId}`,
    globalManifestPath: `.atm/unsupported-global-overlays/${adapterId}.json`,
    capabilities: {
      adapterId,
      fileFormats: [],
      supportsCompanionFiles: false,
      supportsCharterInjection: false
    },
    supported: false,
    unsupportedReason: `editor ${adapterId} does not have an editor-global overlay adapter`
  };
}

export function createEditorGlobalOverlayPlan(input: {
  readonly adapterId: IntegrationAdapterId;
  readonly targetRoot: string;
  readonly targetRootRef: string;
  readonly federatedCatalog: FederatedSkillCatalog;
  readonly installProfile: SkillInstallProfile;
  readonly targetScope: SkillTargetScope;
  readonly existingManifest?: EditorGlobalSkillManifest | null;
  readonly mode?: EditorGlobalOverlayMode;
  readonly now?: string;
}): EditorGlobalOverlayPlan {
  const adapter = getEditorGlobalOverlayAdapter(input.adapterId);
  const existingInstallManifest = input.existingManifest
    ? toInstallManifest(input.existingManifest, adapter)
    : null;
  const installationPlan = resolveSkillInstallationPlan({
    sourceCatalog: input.federatedCatalog.projectedCatalog,
    installProfile: input.installProfile,
    adapterCapabilities: adapter.capabilities,
    targetScope: input.targetScope,
    existingManifest: existingInstallManifest
  });
  const managedPaths = new Set(input.existingManifest?.files.map((file) => normalizeManifestPath(file.path)) ?? []);
  const additions = toOverlayOperations(installationPlan.additions, 'add', adapter, input.targetRoot);
  const updates = toOverlayOperations(installationPlan.updates, 'update', adapter, input.targetRoot)
    .filter((operation) => managedPaths.has(operation.path));
  const unmanagedAdditionCollisions = additions.filter((operation) => operation.currentSha256 && !managedPaths.has(operation.path));
  const safeAdditions = additions.filter((operation) => !unmanagedAdditionCollisions.some((collision) => collision.path === operation.path));
  const collisions = [
    ...installationPlan.collisions,
    ...input.federatedCatalog.decisions
      .filter((decision) => decision.decision === 'preserve-atm' || decision.decision === 'fail-closed')
      .map((decision) => `${decision.skillId}: ${decision.decision} (${decision.reason})`),
    ...unmanagedAdditionCollisions.map((operation) => `${operation.path}: preserved unmanaged editor file`)
  ].sort((left, right) => left.localeCompare(right));
  const fallbacks = [
    ...installationPlan.degradationFindings,
    ...(adapter.supported ? [] : [adapter.unsupportedReason ?? 'unsupported editor-global overlay adapter'])
  ].sort((left, right) => left.localeCompare(right));
  const preservedUnmanagedFiles = [
    ...installationPlan.preservedUserFiles.map((filePath) => normalizeManifestPath(`${adapter.globalTargetDir}/${filePath}`)),
    ...unmanagedAdditionCollisions.map((operation) => operation.path)
  ].sort((left, right) => left.localeCompare(right));
  const staleManagedFiles = installationPlan.staleManagedProjections
    .map((filePath) => normalizeManifestPath(`${adapter.globalTargetDir}/${filePath}`))
    .sort((left, right) => left.localeCompare(right));
  const manifestFiles = [...safeAdditions, ...updates]
    .map((operation): EditorGlobalSkillManifestFile => ({
      path: operation.path,
      sha256: operation.expectedSha256,
      sizeBytes: typeof operation.content === 'string' ? Buffer.byteLength(operation.content, 'utf8') : operation.content.byteLength,
      sourceSkillId: operation.skillId,
      sourceDigest: operation.sourceDigest,
      fileFormat: operation.fileFormat
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const baseManifest = {
    schemaId: 'atm.editorGlobalSkillManifest.v1' as const,
    specVersion: '0.1.0' as const,
    migration: {
      strategy: 'none' as const,
      fromVersion: null,
      notes: 'Editor-global overlay manifest is separate from repo-local integration manifests.'
    },
    adapterId: adapter.adapterId,
    overlayProfileId: input.installProfile.id,
    targetRootRef: input.targetRootRef,
    targetDir: adapter.globalTargetDir,
    generatedAt: input.now ?? new Date(0).toISOString(),
    sourceCatalogDigest: input.federatedCatalog.sourceDigest,
    planDigest: 'sha256:pending' as `sha256:${string}`,
    files: manifestFiles
  };
  const planDigest = digestStableJson({
    adapterId: adapter.adapterId,
    overlayProfileId: input.installProfile.id,
    sourceCatalogDigest: input.federatedCatalog.sourceDigest,
    additions: safeAdditions,
    updates,
    fallbacks,
    collisions,
    staleManagedFiles,
    preservedUnmanagedFiles
  });
  return {
    schemaId: 'atm.editorGlobalOverlayPlan.v1',
    specVersion: '0.1.0',
    mode: input.mode ?? 'dry-run',
    adapterId: adapter.adapterId,
    overlayProfileId: input.installProfile.id,
    targetRootRef: input.targetRootRef,
    sourceCatalogDigest: input.federatedCatalog.sourceDigest,
    additions: safeAdditions,
    updates,
    fallbacks,
    skippedInvalidSources: input.federatedCatalog.skippedInvalidSources,
    collisions,
    staleManagedFiles,
    preservedUnmanagedFiles,
    managedManifest: { ...baseManifest, planDigest },
    planDigest,
    okToApply: adapter.supported && !fallbacks.length && !collisions.some((item) => item.includes('fail-closed'))
  };
}

export function applyEditorGlobalOverlayPlan(input: {
  readonly plan: EditorGlobalOverlayPlan;
  readonly targetRoot: string;
  readonly expectedPlanDigest: `sha256:${string}`;
  readonly dryRun?: boolean;
}): EditorGlobalOverlayApplyResult {
  if (input.plan.planDigest !== input.expectedPlanDigest) {
    throw new Error(`overlay plan digest mismatch: expected ${input.expectedPlanDigest}, got ${input.plan.planDigest}`);
  }
  if (!input.plan.okToApply) {
    throw new Error(`overlay plan is not safe to apply: ${input.plan.collisions.concat(input.plan.fallbacks).join('; ')}`);
  }
  const adapter = getEditorGlobalOverlayAdapter(input.plan.adapterId);
  const writtenFiles: string[] = [];
  if (input.dryRun !== true) {
    for (const operation of [...input.plan.additions, ...input.plan.updates]) {
      const sourceFile = input.plan.managedManifest.files.find((file) => file.path === operation.path);
      if (!sourceFile) continue;
      const absolutePath = resolveRepositoryPath(input.targetRoot, operation.path);
      if (existsSync(absolutePath) && sha256File(absolutePath) !== operation.currentSha256 && operation.currentSha256 !== null) {
        throw new Error(`hash-bound overlay update refused for ${operation.path}`);
      }
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, operation.content);
      writtenFiles.push(operation.path);
    }
    const manifestPath = resolveRepositoryPath(input.targetRoot, adapter.globalManifestPath);
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(input.plan.managedManifest, null, 2)}\n`);
  }
  return {
    schemaId: 'atm.editorGlobalOverlayApplyResult.v1',
    ok: true,
    dryRun: input.dryRun === true,
    adapterId: input.plan.adapterId,
    manifestPath: adapter.globalManifestPath,
    writtenFiles,
    preservedUnmanagedFiles: input.plan.preservedUnmanagedFiles,
    staleManagedFiles: input.plan.staleManagedFiles,
    planDigest: input.plan.planDigest
  };
}

function toOverlayOperations(
  files: readonly {
    readonly skillId: string;
    readonly relativePath: string;
    readonly content: string | Uint8Array;
    readonly sourceDigest: `sha256:${string}`;
    readonly fileFormat: string;
  }[],
  kind: EditorGlobalOverlayOperationKind,
  adapter: EditorGlobalOverlayAdapter,
  targetRoot: string
): readonly EditorGlobalOverlayFileOperation[] {
  return files.map((file) => {
    const overlayPath = normalizeManifestPath(`${adapter.globalTargetDir}/${file.relativePath}`);
    const absolutePath = resolveRepositoryPath(targetRoot, overlayPath);
    return {
      kind,
      path: overlayPath,
      skillId: file.skillId,
      expectedSha256: sha256Bytes(file.content),
      sourceDigest: file.sourceDigest,
      currentSha256: existsSync(absolutePath) ? sha256File(absolutePath) : null,
      fileFormat: file.fileFormat,
      content: file.content
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function toInstallManifest(manifest: EditorGlobalSkillManifest, adapter: EditorGlobalOverlayAdapter): InstallManifest {
  const stripTargetDir = `${normalizeManifestPath(adapter.globalTargetDir)}/`;
  return createInstallManifest({
    adapterId: manifest.adapterId,
    adapterVersion: '0.0.0',
    installedAt: manifest.generatedAt,
    targetDir: adapter.globalTargetDir,
    files: manifest.files.map((file): InstallManifestFile => ({
      path: normalizeManifestPath(file.path).startsWith(stripTargetDir)
        ? normalizeManifestPath(file.path).slice(stripTargetDir.length)
        : normalizeManifestPath(file.path),
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      source: 'generated',
      fileFormat: file.fileFormat === 'markdown' ? 'markdown' : 'skill'
    })),
    metadata: {
      sourceCatalogDigest: manifest.sourceCatalogDigest,
      installProfileId: manifest.overlayProfileId
    }
  });
}

function digestStableJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function formatEditorGlobalSkillManifest(manifest: EditorGlobalSkillManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
