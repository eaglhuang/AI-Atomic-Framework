import { createHash } from 'node:crypto';
import { createManifestFileRecord } from '../manifest/construct.js';
import { normalizeManifestPath } from '../manifest/schema.js';
import { skillBelongsToProfile } from './install-profile.js';
export function resolveSkillInstallationPlan(input) {
    const selectedIds = new Set(input.sourceCatalog.entries
        .filter((entry) => skillBelongsToProfile({
        skillId: entry.id,
        tier: entry.tier,
        installProfiles: entry.installProfiles,
        profile: input.installProfile
    }))
        .map((entry) => entry.id));
    const selectedFiles = input.sourceCatalog.files
        .filter((file) => selectedIds.has(file.skillId))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const existingByPath = new Map((input.existingManifest?.files ?? []).map((file) => [normalizeManifestPath(file.path), file]));
    const expectedByPath = new Map(selectedFiles.map((file) => [normalizeManifestPath(file.relativePath), file]));
    const additions = [];
    const updates = [];
    const preservedUserFiles = [];
    const collisions = [];
    const staleManagedProjections = [];
    const degradationFindings = [];
    for (const file of selectedFiles) {
        const normalizedPath = normalizeManifestPath(file.relativePath);
        const existing = existingByPath.get(normalizedPath);
        const currentRecord = createManifestFileRecord({
            path: normalizedPath,
            content: file.content,
            source: 'template',
            fileFormat: file.fileFormat
        });
        if (!input.adapterCapabilities.fileFormats.includes(file.fileFormat)) {
            degradationFindings.push(`adapter ${input.adapterCapabilities.adapterId} does not support ${file.fileFormat}: ${normalizedPath}`);
            continue;
        }
        if (!input.adapterCapabilities.supportsCompanionFiles && normalizedPath.split('/').length > 2) {
            degradationFindings.push(`adapter ${input.adapterCapabilities.adapterId} does not support companion files: ${normalizedPath}`);
            continue;
        }
        if (!existing) {
            additions.push(file);
            continue;
        }
        if (existing.sha256 !== currentRecord.sha256) {
            updates.push(file);
        }
    }
    for (const existing of input.existingManifest?.files ?? []) {
        const normalizedPath = normalizeManifestPath(existing.path);
        if (expectedByPath.has(normalizedPath))
            continue;
        if (existing.source === 'template' || existing.source === 'generated') {
            staleManagedProjections.push(normalizedPath);
        }
        else {
            preservedUserFiles.push(normalizedPath);
        }
    }
    for (const entry of input.sourceCatalog.entries) {
        if (!selectedIds.has(entry.id))
            continue;
        for (const requirement of entry.adapterCapabilityRequirements) {
            if (requirement.adapterId !== input.adapterCapabilities.adapterId && requirement.adapterId !== '*')
                continue;
            for (const capability of requirement.requires) {
                if (capability === 'companion-files' && !input.adapterCapabilities.supportsCompanionFiles) {
                    collisions.push(`${entry.id}: adapter lacks companion-files`);
                }
                if (capability === 'charter-injection' && !input.adapterCapabilities.supportsCharterInjection) {
                    collisions.push(`${entry.id}: adapter lacks charter-injection`);
                }
            }
        }
    }
    const managedSkillIds = [...selectedIds].sort((left, right) => left.localeCompare(right));
    return {
        schemaId: 'atm.skillInstallationPlan.v1',
        sourceDigest: input.sourceCatalog.sourceDigest,
        profileId: input.installProfile.id,
        adapterId: input.adapterCapabilities.adapterId,
        targetScope: input.targetScope,
        managedSkillIds,
        additions,
        updates,
        preservedUserFiles: preservedUserFiles.sort((left, right) => left.localeCompare(right)),
        staleManagedProjections: staleManagedProjections.sort((left, right) => left.localeCompare(right)),
        collisions: collisions.sort((left, right) => left.localeCompare(right)),
        degradationFindings: degradationFindings.sort((left, right) => left.localeCompare(right)),
        manifestMetadata: {
            sourceCatalogDigest: input.sourceCatalog.sourceDigest,
            profileId: input.installProfile.id,
            managedSkillIds: managedSkillIds.join(','),
            adapterFormat: input.adapterCapabilities.fileFormats.join(','),
            targetScope: input.targetScope
        }
    };
}
export function digestSkillInstallationPlan(plan) {
    return `sha256:${createHash('sha256').update(JSON.stringify(plan)).digest('hex')}`;
}
