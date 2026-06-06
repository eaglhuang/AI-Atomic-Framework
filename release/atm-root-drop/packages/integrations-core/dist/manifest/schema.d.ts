import type { InstallManifest, Sha256Digest } from './types.ts';
export declare const installManifestSchemaVersion: "atm.installManifest.v0.1";
export declare function sha256Bytes(input: string | Uint8Array): Sha256Digest;
export declare function sha256File(absolutePath: string): Sha256Digest;
export declare function formatInstallManifest(manifest: InstallManifest): string;
export declare function normalizeManifestPath(candidatePath: string): string;
export declare function resolveRepositoryPath(repositoryRoot: string, manifestPath: string): string;
