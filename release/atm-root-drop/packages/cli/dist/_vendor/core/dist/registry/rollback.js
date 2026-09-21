import { buildMemberAtomProofs, resolveMapWorkbenchPath, resolveTargetMapSnapshot } from './rollback-map.js';
import { cloneJson, findVersionRecord, isAtomEntry, isMapEntry } from './rollback-registry-helpers.js';
import { createRollbackProof, resolveRollbackBehavior } from './rollback-proof.js';
export * from './rollback-types.js';
export { resolveMapWorkbenchPath } from './rollback-map.js';
export { resolveRollbackBehavior, validateRollbackProof } from './rollback-proof.js';
export function applyRegistryRollback(options) {
    const reverseBehaviorId = resolveRollbackBehavior(options.behaviorId);
    if (!reverseBehaviorId) {
        throw new Error(`Unsupported behaviorId for rollback contract: ${options.behaviorId}`);
    }
    const verifiedAt = options.verifiedAt ?? new Date().toISOString();
    const clonedRegistry = cloneJson(options.registryDocument);
    const entries = [...clonedRegistry.entries];
    if (entries.length === 0) {
        throw new Error('Registry has no entries.');
    }
    if (options.targetKind === 'atom') {
        if (!options.atomId) {
            throw new Error('atom rollback requires atomId.');
        }
        const entryIndex = entries.findIndex((entry) => isAtomEntry(entry) && entry.atomId === options.atomId);
        if (entryIndex < 0) {
            throw new Error(`Atom entry not found: ${options.atomId}`);
        }
        const entry = entries[entryIndex];
        const fromVersion = entry.currentVersion ?? entry.atomVersion;
        if (!fromVersion) {
            throw new Error(`Atom entry ${entry.atomId} is missing currentVersion/atomVersion.`);
        }
        const targetVersionRecord = findVersionRecord(entry, options.toVersion);
        if (!targetVersionRecord) {
            throw new Error(`Target version ${options.toVersion} not found in versions[] for ${entry.atomId}.`);
        }
        const targetStatus = String(targetVersionRecord.status ?? entry.status);
        const targetSemanticFingerprint = targetVersionRecord.semanticFingerprint ?? entry.semanticFingerprint ?? null;
        const updatedEntry = {
            ...entry,
            atomVersion: options.toVersion,
            currentVersion: options.toVersion,
            hashLock: {
                ...entry.hashLock,
                digest: targetVersionRecord.specHash
            },
            status: targetStatus,
            selfVerification: {
                ...entry.selfVerification,
                specHash: targetVersionRecord.specHash,
                codeHash: targetVersionRecord.codeHash,
                testHash: targetVersionRecord.testHash
            },
            semanticFingerprint: targetSemanticFingerprint ?? undefined
        };
        entries[entryIndex] = updatedEntry;
        const hashesVerified = {
            spec: updatedEntry.selfVerification.specHash === targetVersionRecord.specHash,
            code: updatedEntry.selfVerification.codeHash === targetVersionRecord.codeHash,
            test: updatedEntry.selfVerification.testHash === targetVersionRecord.testHash,
            allVerified: false
        };
        hashesVerified.allVerified = hashesVerified.spec && hashesVerified.code && hashesVerified.test;
        const statusReverted = updatedEntry.status === targetStatus;
        const semanticFingerprintReverted = (updatedEntry.semanticFingerprint ?? null) === targetSemanticFingerprint;
        const proof = createRollbackProof({
            targetKind: 'atom',
            atomId: entry.atomId,
            fromVersion,
            toVersion: options.toVersion,
            behaviorId: options.behaviorId,
            reverseBehaviorId,
            hashesVerified,
            verifiedAt,
            statusReverted,
            semanticFingerprintReverted
        });
        return {
            updatedRegistryDocument: {
                ...clonedRegistry,
                generatedAt: verifiedAt,
                entries
            },
            proof
        };
    }
    if (!options.mapId) {
        throw new Error('map rollback requires mapId.');
    }
    const mapIndex = entries.findIndex((entry) => isMapEntry(entry) && entry.mapId === options.mapId);
    if (mapIndex < 0) {
        throw new Error(`Map entry not found: ${options.mapId}`);
    }
    const mapEntry = entries[mapIndex];
    const fromVersion = String(mapEntry.currentVersion ?? mapEntry.mapVersion ?? '');
    if (!fromVersion) {
        throw new Error(`Map entry ${options.mapId} is missing currentVersion/mapVersion.`);
    }
    const targetMapSnapshot = resolveTargetMapSnapshot(mapEntry, options.toVersion);
    if (!targetMapSnapshot) {
        throw new Error(`Target map version ${options.toVersion} not found for ${options.mapId}.`);
    }
    const memberAtomProofs = buildMemberAtomProofs({
        entries,
        memberSnapshot: targetMapSnapshot.memberSnapshot
    });
    const memberHashesOk = memberAtomProofs.every((entry) => entry.matched);
    const mapHashOk = String(targetMapSnapshot.mapHash).trim().length > 0;
    const hashesVerified = {
        spec: mapHashOk,
        code: memberHashesOk,
        test: memberHashesOk,
        allVerified: mapHashOk && memberHashesOk
    };
    const targetStatus = targetMapSnapshot.status ?? mapEntry.status ?? null;
    const targetSemanticFingerprint = targetMapSnapshot.semanticFingerprint ?? mapEntry.semanticFingerprint ?? null;
    const updatedMapEntry = {
        ...mapEntry,
        mapVersion: options.toVersion,
        currentVersion: options.toVersion,
        mapHash: targetMapSnapshot.mapHash,
        members: targetMapSnapshot.members,
        status: targetStatus ?? undefined,
        semanticFingerprint: targetSemanticFingerprint ?? undefined,
        mapGeneratorProvenance: targetMapSnapshot.mapGeneratorProvenance
    };
    entries[mapIndex] = updatedMapEntry;
    const statusReverted = (updatedMapEntry.status ?? null) === targetStatus;
    const semanticFingerprintReverted = (updatedMapEntry.semanticFingerprint ?? null) === targetSemanticFingerprint;
    const mapWorkbenchResolution = resolveMapWorkbenchPath({
        repositoryRoot: options.repositoryRoot,
        mapId: options.mapId,
        mapOwner: options.mapOwner
    });
    const proof = createRollbackProof({
        targetKind: 'map',
        mapId: options.mapId,
        fromVersion,
        toVersion: options.toVersion,
        behaviorId: options.behaviorId,
        reverseBehaviorId,
        hashesVerified,
        verifiedAt,
        statusReverted,
        semanticFingerprintReverted,
        memberAtomProofs,
        mapGeneratorProvenance: targetMapSnapshot.mapGeneratorProvenance,
        mapWorkbenchResolution
    });
    return {
        updatedRegistryDocument: {
            ...clonedRegistry,
            generatedAt: verifiedAt,
            entries
        },
        proof
    };
}
