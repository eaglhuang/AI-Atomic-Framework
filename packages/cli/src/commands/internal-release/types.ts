export interface InternalReleaseSyncOptions {
  readonly cwd: string;
  readonly repos: readonly string[];
  readonly skips: readonly string[];
  readonly build: boolean;
  readonly dryRun: boolean;
  readonly verify: boolean;
  readonly allowVerifyFailure: boolean;
  readonly source: string | null;
  readonly keepTemp: boolean;
}

export interface CommandRunRecord {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly ok: boolean;
}

export interface ScratchGuardReport {
  readonly forbiddenRelativePaths: readonly string[];
  readonly present: readonly string[];
  readonly removed: readonly string[];
  readonly kept: readonly string[];
  readonly fileCount: number;
  readonly freedBytes: number;
  readonly dryRun: boolean;
  readonly keepTemp: boolean;
  readonly errors: readonly string[];
  readonly ok: boolean;
}

export interface SyncTargetReport {
  readonly repo: string;
  readonly repoName: string;
  readonly skipped: boolean;
  readonly skipReason: string | null;
  readonly ok: boolean;
  readonly runnerPath: string;
  readonly metadataPath: string;
  readonly previousSha256: string | null;
  readonly newSha256: string | null;
  readonly backupPath: string | null;
  readonly verification: readonly CommandRunRecord[];
  readonly warnings: readonly string[];
  readonly scratchGuard: ScratchGuardReport;
}

export interface ReleasePublicationReceipt {
  readonly schemaId: 'atm.releasePublicationReceipt.v1';
  readonly stewardActorId: string;
  readonly sealedSourceCommit: string;
  readonly artifactPath: string;
  readonly artifactSha256: string;
  readonly publicationReceipt: string;
  readonly generatedAt: string;
}

export interface ReleasePublicationReadiness {
  readonly schemaId: 'atm.releasePublicationReadiness.v1';
  readonly ok: boolean;
  readonly stewardActorId: string;
  readonly sealedSourceCommit: string | null;
  readonly generatedArtifactDigest: string | null;
  readonly publicationReceipt: string | null;
  readonly dirtyFiles: readonly string[];
  readonly sealedSourceState: {
    readonly ok: boolean;
    readonly reason: string | null;
  };
  readonly ownership: {
    readonly ok: boolean;
    readonly activeCaptains: readonly string[];
    readonly agreement: string | null;
    readonly reason: string | null;
  };
  readonly requiredCommand: string | null;
}
