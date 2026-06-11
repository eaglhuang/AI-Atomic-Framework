import { createAtomBundle, type AtomBundle } from '../../packages/core/src/registry/atom-capsule.ts';

export type AtomIdToCidSourceKind = 'source' | 'placeholder';

export interface AtomIdToCidMapping {
  atom_id: string;
  atom_cid: string;
  sourcePath: string;
  sourceKind: AtomIdToCidSourceKind;
}

export const ATOM_ID_TO_CID_SCHEMA_VERSION = 'atm.atomIdToCid.v2';
export const ATOM_ID_TO_CID_PLACEHOLDER_PREFIX = 'placeholder:unattached/';

export function buildResolvedAtomBundle(sourceContent: string): AtomBundle {
  return createAtomBundle(sourceContent);
}

export function buildPlaceholderAtomBundle(atomId: string): AtomBundle {
  return createAtomBundle(buildPlaceholderAtomSourceContent(atomId));
}

export function buildPlaceholderAtomSourcePath(atomId: string): string {
  return `${ATOM_ID_TO_CID_PLACEHOLDER_PREFIX}${atomId}`;
}

export function buildPlaceholderAtomSourceContent(atomId: string): string {
  return `placeholder:unattached atom capsule for ${atomId}`;
}

export function isPlaceholderAtomSourcePath(sourcePath: string): boolean {
  return sourcePath.startsWith(ATOM_ID_TO_CID_PLACEHOLDER_PREFIX);
}
