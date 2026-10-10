import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeAtomCid, createAtomBundle } from '../registry/atom-capsule.ts';
import type { PatchProposal } from './types.ts';

export const ATOM_REGISTRY_RELATIVE_PATH = 'atomic-registry.json';

interface RegistryEntryLike {
  readonly atomId?: unknown;
  readonly location?: { readonly codePaths?: unknown };
}

// Fill atomCid for atomRefs that omit it, using the same CID formula `atm create`
// records for an atom: computeAtomCid(createAtomBundle(source)). Explicit atomCid
// values are kept as the author wrote them. Refs that cannot be resolved are left
// unchanged, so schema validation still reports them.
export function fillProposalAtomCids(proposal: PatchProposal, cwd: string): PatchProposal {
  if (!Array.isArray(proposal.atomRefs) || proposal.atomRefs.length === 0) {
    return proposal;
  }
  const registryEntries = readRegistryEntries(cwd);
  const atomRefs = proposal.atomRefs.map((ref) => {
    if (!ref || typeof ref !== 'object' || typeof ref.atomId !== 'string') return ref;
    if (typeof ref.atomCid === 'string' && ref.atomCid.length > 0) return ref;
    const atomCid = resolveAtomCidFromRegistry(registryEntries, ref.atomId, cwd);
    return atomCid ? { ...ref, atomCid } : ref;
  });
  return { ...proposal, atomRefs };
}

function readRegistryEntries(cwd: string): RegistryEntryLike[] {
  const registryPath = path.join(cwd, ATOM_REGISTRY_RELATIVE_PATH);
  if (!existsSync(registryPath)) return [];
  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { entries?: unknown };
    return Array.isArray(registry.entries) ? (registry.entries as RegistryEntryLike[]) : [];
  } catch {
    return [];
  }
}

function resolveAtomCidFromRegistry(entries: RegistryEntryLike[], atomId: string, cwd: string): string | null {
  const entry = entries.find((candidate) => candidate?.atomId === atomId);
  const codePaths = entry?.location?.codePaths;
  if (!Array.isArray(codePaths) || typeof codePaths[0] !== 'string') return null;
  const sourcePath = path.resolve(cwd, codePaths[0]);
  if (!sourcePath.startsWith(path.resolve(cwd) + path.sep) || !existsSync(sourcePath)) return null;
  return computeAtomCid(createAtomBundle(readFileSync(sourcePath, 'utf8')));
}
