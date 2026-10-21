export declare const identityMetadataByteLimit: number;
export interface FrameworkIdentity {
    readonly kind: 'framework' | 'adopter' | 'ambiguous' | 'distribution';
    /** Ambiguous framework evidence retains the existing conservative guard. */
    readonly isFrameworkRepo: boolean;
    readonly score: number;
    readonly root: string;
    readonly name: string | null;
    readonly signals: readonly string[];
}
/** Fixed, shallow observations. A package label alone is never positive identity.
 * This is repository classification, not authentication or write authority. */
export declare function inspectFrameworkIdentity(repositoryRoot: string): FrameworkIdentity;
export declare function isPlainIdentityFile(file: string): boolean;
export declare function readIdentityJson(file: string): Record<string, unknown> | null;
