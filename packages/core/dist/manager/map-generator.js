import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAtomicMapRegistryEntry } from '../registry/map-registry.js';
import { validateRegistryDocumentFile, writeRegistryArtifacts } from '../registry/registry.js';
import { createGeneratorError } from './map-generator/errors.js';
import { allocateGeneratorMapId, createGeneratedMapEvidence, createMapLocation, createMapPaths, findExistingEntry, normalizeError, normalizeTrailingNewline, readRegistryDocument, recordPhase, renderDefaultMapIntegrationTest, runGeneratedMapTest, upsertRegistryEntry } from './map-generator/runtime-support.js';
import { createMinimalAtomicMapSpec, normalizeRequest } from './map-generator/spec-support.js';
const defaultRegistryPath = 'atomic-registry.json';
const defaultCatalogPath = 'atomic_workbench/registry-catalog.md';
export { createMinimalAtomicMapSpec };
export function generateAtomicMap(request, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
    const registryPath = options.registryPath ?? defaultRegistryPath;
    const registryAbsolutePath = path.resolve(repositoryRoot, registryPath);
    const dryRun = options.dryRun === true;
    const phases = [];
    try {
        const normalizedRequest = normalizeRequest(request);
        const registryDocument = readRegistryDocument(registryAbsolutePath, options);
        const existingEntry = findExistingEntry(registryDocument, normalizedRequest);
        if (existingEntry && options.force !== true) {
            const paths = createMapPaths(existingEntry.mapId);
            return createSuccess({
                mapId: existingEntry.mapId,
                workbenchPath: existingEntry.location?.workbenchPath ?? paths.workbenchPath,
                specPath: existingEntry.location?.specPath ?? paths.specPath,
                testPath: existingEntry.location?.testPaths?.[0] ?? paths.testPath,
                reportPath: existingEntry.location?.reportPath ?? paths.reportPath,
                registryEntry: existingEntry,
                registryPath,
                catalogPath: defaultCatalogPath,
                allocation: null,
                testRun: null,
                idempotent: true,
                dryRun,
                phases: [recordPhase(phases, 'idempotent-existing-entry', () => ({ existingMapId: existingEntry.mapId }))]
            });
        }
        const allocation = recordPhase(phases, 'allocate-id', () => allocateGeneratorMapId(normalizedRequest, {
            repositoryRoot,
            registryPath,
            registryDocument,
            existingEntry,
            mapId: options.mapId ?? undefined,
            force: options.force === true
        }));
        const paths = createMapPaths(allocation.mapId);
        const specDocument = createMinimalAtomicMapSpec({
            ...normalizedRequest,
            mapId: allocation.mapId
        });
        const specAbsolutePath = path.join(repositoryRoot, paths.specPath);
        const testAbsolutePath = path.join(repositoryRoot, paths.testPath);
        const reportAbsolutePath = path.join(repositoryRoot, paths.reportPath);
        const specExistsBefore = existsSync(specAbsolutePath);
        const testExistsBefore = existsSync(testAbsolutePath);
        if (!dryRun) {
            mkdirSync(path.dirname(specAbsolutePath), { recursive: true });
            if (!specExistsBefore || options.overwriteExisting === true) {
                writeFileSync(specAbsolutePath, `${JSON.stringify(specDocument, null, 2)}\n`, 'utf8');
            }
            if (!testExistsBefore || options.overwriteExisting === true) {
                writeFileSync(testAbsolutePath, normalizeTrailingNewline(options.testContent ?? renderDefaultMapIntegrationTest(specDocument)), 'utf8');
            }
        }
        if (dryRun) {
            return createSuccess({
                mapId: allocation.mapId,
                workbenchPath: paths.workbenchPath,
                specPath: paths.specPath,
                testPath: paths.testPath,
                reportPath: paths.reportPath,
                registryEntry: null,
                registryPath,
                catalogPath: defaultCatalogPath,
                allocation,
                testRun: null,
                idempotent: false,
                dryRun,
                phases
            });
        }
        const testRun = recordPhase(phases, 'test', () => runGeneratedMapTest({
            repositoryRoot,
            specPath: specAbsolutePath,
            testPath: testAbsolutePath,
            reportPath: reportAbsolutePath,
            mapId: allocation.mapId,
            now: options.now
        }));
        if (!testRun.ok) {
            throw createGeneratorError('ATM_MAP_GENERATOR_TEST_FAILED', 'Generated map validation command failed.', { testRun });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const registryEntry = recordPhase(phases, 'register-entry', () => createAtomicMapRegistryEntry(specDocument, {
            schemaPath: 'schemas/registry/atomic-map.schema.json',
            status: options.status ?? 'draft',
            governanceTier: options.governanceTier ?? 'standard',
            location: createMapLocation(paths),
            evidence: createGeneratedMapEvidence(paths)
        }));
        const updatedRegistryDocument = upsertRegistryEntry(registryDocument, registryEntry, {
            generatedAt: options.now ?? new Date().toISOString()
        });
        const writeResult = recordPhase(phases, 'write-registry', () => writeRegistryArtifacts(updatedRegistryDocument, {
            repositoryRoot,
            registryPath,
            catalogPath: options.catalogPath ?? defaultCatalogPath,
            sourceOfTruthLabel: registryPath
        }));
        const validation = recordPhase(phases, 'validate-registry', () => validateRegistryDocumentFile(registryAbsolutePath));
        if (!validation.ok) {
            throw createGeneratorError('ATM_MAP_GENERATOR_REGISTRY_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', { validation });
        }
        return createSuccess({
            mapId: allocation.mapId,
            workbenchPath: paths.workbenchPath,
            specPath: paths.specPath,
            testPath: paths.testPath,
            reportPath: paths.reportPath,
            registryEntry,
            registryPath: writeResult.registryPath,
            catalogPath: writeResult.catalogPath,
            allocation,
            testRun,
            idempotent: false,
            dryRun,
            phases
        });
    }
    catch (error) {
        return createFailure(error, phases);
    }
}
function createSuccess(result) {
    return {
        ok: true,
        phases: [],
        ...result
    };
}
function createFailure(error, phases) {
    const normalizedError = normalizeError(error);
    return {
        ok: false,
        mapId: null,
        failedPhase: phases.find((phase) => phase.ok === false)?.phase ?? null,
        error: normalizedError,
        phases
    };
}
