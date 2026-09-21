import { createAtomicSpecSemanticFingerprint } from './semantic-fingerprint.js';
export const atmReadableRefContractVersion = 'readable-ref/v1';
export function defineAtmAtomRef(ref) {
    return Object.freeze({
        ...ref,
        kind: 'atom',
        readabilityContractVersion: atmReadableRefContractVersion,
        sourcePaths: [...(ref.sourcePaths ?? [])]
    });
}
export function defineAtmMapRef(ref) {
    return Object.freeze({
        ...ref,
        kind: 'map',
        readabilityContractVersion: atmReadableRefContractVersion,
        sourcePaths: [...(ref.sourcePaths ?? [])],
        members: [...(ref.members ?? [])],
        entrypoints: [...(ref.entrypoints ?? [])]
    });
}
export const atomicSpecSemanticFingerprintAtom = defineAtmAtomRef({
    atomId: 'ATM-CORE-0005',
    logicalName: 'atom.core-atomic-spec-semantic-fingerprint',
    purpose: 'Create canonical semantic fingerprint for an atomic spec.',
    sourcePaths: [
        'packages/core/src/registry/semantic-fingerprint.ts',
        'atomic_workbench/atoms/ATM-CORE-0005/atom.source.mjs'
    ],
    run: createAtomicSpecSemanticFingerprint
});
export function runAtm(atom, input) {
    if (typeof atom.run !== 'function') {
        throw new Error(`ATM atom ref ${atom.logicalName} (${atom.atomId}) is metadata-only and cannot be executed directly.`);
    }
    return atom.run(input);
}
export function runAtmMap(map, input) {
    if (typeof map.run !== 'function') {
        throw new Error(`ATM map ref ${map.logicalName} (${map.mapId}) is metadata-only and cannot be executed directly.`);
    }
    return map.run(input);
}
