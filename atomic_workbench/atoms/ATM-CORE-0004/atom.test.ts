export const atomId = 'ATM-CORE-0004';
export const logicalName = 'atom.core-atom-generator';

export function describeAtomGenerator() {
  return {
    atomId,
    logicalName,
    role: 'provisioning-facade',
    facade: 'generateAtom',
    allocator: 'allocateAtomId'
  };
}
