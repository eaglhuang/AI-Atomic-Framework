import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeRegistryCatalogFile } from '../registry-catalog.js';
import { resolveProjectPath, toProjectPath } from './paths.js';
export function createRegistryDocument(entries, options = {}) {
    const document = {
        schemaId: 'atm.registry',
        specVersion: '0.1.0',
        migration: normalizeMigration(options.migration),
        registryId: options.registryId ?? 'registry.atoms',
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        entries: [...entries]
    };
    if (options.sharding) {
        document.sharding = normalizeSharding(options.sharding);
    }
    return document;
}
export function writeRegistryArtifacts(registryDocument, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
    const registryPath = resolveProjectPath(repositoryRoot, options.registryPath ?? 'atomic-registry.json');
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(registryPath, `${JSON.stringify(registryDocument, null, 2)}\n`, 'utf8');
    const result = {
        registryPath: toProjectPath(repositoryRoot, registryPath),
        catalogPath: null
    };
    if (options.writeCatalog !== false) {
        const catalogResult = writeRegistryCatalogFile(registryDocument, {
            repositoryRoot,
            specRepositoryRoot: options.specRepositoryRoot ?? repositoryRoot,
            catalogPath: options.catalogPath,
            title: options.catalogTitle,
            sourceOfTruthLabel: options.sourceOfTruthLabel
        });
        result.catalogPath = catalogResult.catalogPath ?? null;
    }
    return result;
}
function normalizeMigration(migration) {
    return {
        strategy: migration?.strategy ?? 'none',
        fromVersion: migration?.fromVersion ?? null,
        notes: migration?.notes ?? 'Initial alpha0 registry document.'
    };
}
function normalizeSharding(sharding) {
    return {
        strategy: sharding.strategy ?? 'single-document',
        partPaths: [...(sharding.partPaths ?? [])],
        nextRegistryId: sharding.nextRegistryId ?? null
    };
}
