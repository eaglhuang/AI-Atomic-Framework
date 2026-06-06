import { createAtomicSpecSemanticFingerprint, type AtomicSpecSemanticFingerprintInput } from './semantic-fingerprint.ts';

export const atmReadableRefContractVersion = 'readable-ref/v1';

export interface AtmReadableRefBase {
  readonly readabilityContractVersion: typeof atmReadableRefContractVersion;
  readonly logicalName: string;
  readonly purpose: string;
  readonly sourcePaths: readonly string[];
}

export interface AtmAtomRef<Input, Output> {
  readonly kind: 'atom';
  readonly readabilityContractVersion: typeof atmReadableRefContractVersion;
  readonly atomId: string;
  readonly logicalName: string;
  readonly purpose: string;
  readonly sourcePaths: readonly string[];
  readonly run?: (input: Input) => Output;
}

export interface AtmMapRef<Input = unknown, Output = unknown> extends AtmReadableRefBase {
  readonly kind: 'map';
  readonly mapId: string;
  readonly members: readonly string[];
  readonly entrypoints: readonly string[];
  readonly run?: (input: Input) => Output;
}

export function defineAtmAtomRef<Input = unknown, Output = unknown>(
  ref: Omit<AtmAtomRef<Input, Output>, 'kind' | 'readabilityContractVersion'> & Partial<Pick<AtmAtomRef<Input, Output>, 'readabilityContractVersion'>>
): AtmAtomRef<Input, Output> {
  return Object.freeze({
    ...ref,
    kind: 'atom' as const,
    readabilityContractVersion: atmReadableRefContractVersion,
    sourcePaths: [...(ref.sourcePaths ?? [])]
  });
}

export function defineAtmMapRef<Input = unknown, Output = unknown>(
  ref: Omit<AtmMapRef<Input, Output>, 'kind' | 'readabilityContractVersion'> & Partial<Pick<AtmMapRef<Input, Output>, 'readabilityContractVersion'>>
): AtmMapRef<Input, Output> {
  return Object.freeze({
    ...ref,
    kind: 'map' as const,
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
}) satisfies AtmAtomRef<AtomicSpecSemanticFingerprintInput, string>;

export function runAtm<Input, Output>(atom: AtmAtomRef<Input, Output>, input: Input): Output {
  if (typeof atom.run !== 'function') {
    throw new Error(`ATM atom ref ${atom.logicalName} (${atom.atomId}) is metadata-only and cannot be executed directly.`);
  }
  return atom.run(input);
}

export function runAtmMap<Input, Output>(map: AtmMapRef<Input, Output>, input: Input): Output {
  if (typeof map.run !== 'function') {
    throw new Error(`ATM map ref ${map.logicalName} (${map.mapId}) is metadata-only and cannot be executed directly.`);
  }
  return map.run(input);
}
