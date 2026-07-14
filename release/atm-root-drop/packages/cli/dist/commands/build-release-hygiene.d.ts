export declare function shouldRetainReleaseArtifacts(): boolean;
export declare function describeBuildReleaseHygienePolicy(): {
    readonly retainEnvVar: 'ATM_RETAIN_RELEASE_ARTIFACTS';
    readonly defaultBehavior: 'restore-tracked-release-manifests';
    readonly retainBehavior: 'keep-generated-release-mirrors';
    readonly runnerSyncCommand: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build';
    readonly validationSafeCommand: 'npm run build:packages';
    readonly cleanupCommand: 'node --strip-types scripts/build-release-hygiene.ts --mode cleanup';
    readonly publicationReceiptRequired: true;
    readonly sealedSourceStateRequired: true;
};
export declare function restoreTrackedReleaseArtifacts(repoRoot: string): readonly string[];
export declare function finalizeBuildReleaseHygiene(repoRoot: string): void;
