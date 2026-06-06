import { type AtomicSpecSemanticFingerprintInput } from './semantic-fingerprint.ts';
export declare const atmReadableRefContractVersion = "readable-ref/v1";
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
export declare function defineAtmAtomRef<Input = unknown, Output = unknown>(ref: Omit<AtmAtomRef<Input, Output>, 'kind' | 'readabilityContractVersion'> & Partial<Pick<AtmAtomRef<Input, Output>, 'readabilityContractVersion'>>): AtmAtomRef<Input, Output>;
export declare function defineAtmMapRef<Input = unknown, Output = unknown>(ref: Omit<AtmMapRef<Input, Output>, 'kind' | 'readabilityContractVersion'> & Partial<Pick<AtmMapRef<Input, Output>, 'readabilityContractVersion'>>): AtmMapRef<Input, Output>;
export declare const atomicSpecSemanticFingerprintAtom: AtmAtomRef<AtomicSpecSemanticFingerprintInput, string>;
export declare function runAtm<Input, Output>(atom: AtmAtomRef<Input, Output>, input: Input): Output;
export declare function runAtmMap<Input, Output>(map: AtmMapRef<Input, Output>, input: Input): Output;
