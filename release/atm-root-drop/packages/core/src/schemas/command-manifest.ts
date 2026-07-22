export const atmCommandManifestSchemaId = 'atm.commandManifest.v1' as const;

export type AtmCommandManifestV1 = {
  readonly schemaId: typeof atmCommandManifestSchemaId;
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly envRefs?: readonly string[];
  readonly timeoutMs?: number;
  readonly stdinSha256?: string | null;
  readonly ioDigest?: string | null;
};
