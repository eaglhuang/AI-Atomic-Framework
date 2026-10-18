import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeAtomCid, createAtomBundle } from '../registry/atom-capsule.js';
export const ATOM_REGISTRY_RELATIVE_PATH = 'atomic-registry.json';
// Fill atomCid for atomRefs that omit it, using the same CID formula `atm create`
// records for an atom: computeAtomCid(createAtomBundle(source)). Explicit atomCid
// values are kept as the author wrote them. Refs that cannot be resolved are left
// unchanged, so schema validation still reports them.
export function fillProposalAtomCids(proposal, cwd) {
    if (!Array.isArray(proposal.atomRefs) || proposal.atomRefs.length === 0) {
        return proposal;
    }
    const registryEntries = readRegistryEntries(cwd);
    const atomRefs = proposal.atomRefs.map((ref) => {
        if (!ref || typeof ref !== 'object' || typeof ref.atomId !== 'string')
            return ref;
        if (typeof ref.atomCid === 'string' && ref.atomCid.length > 0)
            return ref;
        const atomCid = resolveAtomCidFromRegistry(registryEntries, ref.atomId, cwd);
        return atomCid ? { ...ref, atomCid } : ref;
    });
    return { ...proposal, atomRefs };
}
function readRegistryEntries(cwd) {
    const registryPath = path.join(cwd, ATOM_REGISTRY_RELATIVE_PATH);
    if (!existsSync(registryPath))
        return [];
    try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
        return Array.isArray(registry.entries) ? registry.entries : [];
    }
    catch {
        return [];
    }
}
function resolveAtomCidFromRegistry(entries, atomId, cwd) {
    const entry = entries.find((candidate) => candidate?.atomId === atomId);
    const codePaths = entry?.location?.codePaths;
    if (!Array.isArray(codePaths) || typeof codePaths[0] !== 'string')
        return null;
    const sourcePath = path.resolve(cwd, codePaths[0]);
    if (!sourcePath.startsWith(path.resolve(cwd) + path.sep) || !existsSync(sourcePath))
        return null;
    return computeAtomCid(createAtomBundle(readFileSync(sourcePath, 'utf8')));
}
