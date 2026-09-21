import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInstallManifest } from '../manifest/construct.js';
import { normalizeManifestPath, resolveRepositoryPath, sha256Bytes, sha256File } from '../manifest/schema.js';
import { resolveSkillInstallationPlan } from './skill-distribution-manager.js';
export function getEditorGlobalOverlayAdapter(adapterId) {
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
export function createEditorGlobalOverlayPlan(input) {
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
        .map((operation) => ({
        path: operation.path,
        sha256: operation.expectedSha256,
        sizeBytes: typeof operation.content === 'string' ? Buffer.byteLength(operation.content, 'utf8') : operation.content.byteLength,
        sourceSkillId: operation.skillId,
        sourceDigest: operation.sourceDigest,
        fileFormat: operation.fileFormat
    }))
        .sort((left, right) => left.path.localeCompare(right.path));
    const baseManifest = {
        schemaId: 'atm.editorGlobalSkillManifest.v1',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Editor-global overlay manifest is separate from repo-local integration manifests.'
        },
        adapterId: adapter.adapterId,
        overlayProfileId: input.installProfile.id,
        targetRootRef: input.targetRootRef,
        targetDir: adapter.globalTargetDir,
        generatedAt: input.now ?? new Date(0).toISOString(),
        sourceCatalogDigest: input.federatedCatalog.sourceDigest,
        planDigest: 'sha256:pending',
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
export function applyEditorGlobalOverlayPlan(input) {
    if (input.plan.planDigest !== input.expectedPlanDigest) {
        throw new Error(`overlay plan digest mismatch: expected ${input.expectedPlanDigest}, got ${input.plan.planDigest}`);
    }
    if (!input.plan.okToApply) {
        throw new Error(`overlay plan is not safe to apply: ${input.plan.collisions.concat(input.plan.fallbacks).join('; ')}`);
    }
    const adapter = getEditorGlobalOverlayAdapter(input.plan.adapterId);
    const writtenFiles = [];
    if (input.dryRun !== true) {
        for (const operation of [...input.plan.additions, ...input.plan.updates]) {
            const sourceFile = input.plan.managedManifest.files.find((file) => file.path === operation.path);
            if (!sourceFile)
                continue;
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
function toOverlayOperations(files, kind, adapter, targetRoot) {
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
function toInstallManifest(manifest, adapter) {
    const stripTargetDir = `${normalizeManifestPath(adapter.globalTargetDir)}/`;
    return createInstallManifest({
        adapterId: manifest.adapterId,
        adapterVersion: '0.0.0',
        installedAt: manifest.generatedAt,
        targetDir: adapter.globalTargetDir,
        files: manifest.files.map((file) => ({
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
function digestStableJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
export function formatEditorGlobalSkillManifest(manifest) {
    return `${JSON.stringify(manifest, null, 2)}\n`;
}
