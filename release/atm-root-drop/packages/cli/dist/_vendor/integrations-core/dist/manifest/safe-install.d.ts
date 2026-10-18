import type { InstallManifest } from './types.js';
/** Check every existing component, including dangling links, before any write. */
export declare function assertNoSymlinkPath(candidate: string): void;
export declare function safeInstallPath(root: string, relative: string): string;
export declare function readManagedBlocks(manifest: InstallManifest): Record<string, string>;
export declare function losslessUtf8(bytes: Buffer): string;
export declare function validateOwnershipManifest(value: unknown): asserts value is InstallManifest;
export declare function managedBlock(content: string, id: string): {
    content: string;
    start: number;
    end: number;
} | null;
export declare function wrapManagedBlock(content: string, id: string): string;
export declare function planSafeFile(input: {
    root: string;
    file: string;
    content: string | Uint8Array;
    adapterId: string;
    previous?: InstallManifest;
}): {
    bytes: Buffer;
    previous: Buffer | null;
    block: boolean;
};
/** Optimistic precondition check; this is not an OS-level transaction lock. */
export declare function assertUnchanged(root: string, file: string, expected: Buffer | null): void;
