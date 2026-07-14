import { createHash } from 'node:crypto';

export type TeamPromptCachePolicy = 'stable-prefix-preferred' | 'cache-disabled';

export type TeamContextManifest = {
  readonly schemaId: 'atm.teamContextManifest.v1';
  readonly manifestId: string;
  readonly taskId: string;
  readonly role: string;
  readonly baseCommit: string;
  readonly scopeEpoch: number;
  readonly allowedFiles: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly requiredDependencies: readonly string[];
  readonly promptCachePolicy: TeamPromptCachePolicy;
  readonly stablePromptPrefixHash: string | null;
  readonly digest: string;
};

export function createTeamContextManifest(input: {
  readonly taskId: string;
  readonly role: string;
  readonly baseCommit: string;
  readonly scopeEpoch: number;
  readonly allowedFiles: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly requiredDependencies?: readonly string[];
  readonly promptCachePolicy?: TeamPromptCachePolicy;
  readonly stablePromptPrefix?: string | null;
}): TeamContextManifest {
  const stablePromptPrefixHash = input.stablePromptPrefix
    ? `sha256:${sha256(input.stablePromptPrefix)}`
    : null;
  const body = {
    taskId: input.taskId,
    role: input.role,
    baseCommit: input.baseCommit,
    scopeEpoch: input.scopeEpoch,
    allowedFiles: [...input.allowedFiles].sort(),
    acceptanceCriteria: [...input.acceptanceCriteria],
    requiredDependencies: [...(input.requiredDependencies ?? [])].sort(),
    promptCachePolicy: input.promptCachePolicy ?? 'stable-prefix-preferred',
    stablePromptPrefixHash
  };
  const digest = `sha256:${sha256(JSON.stringify(body))}`;
  return {
    schemaId: 'atm.teamContextManifest.v1',
    manifestId: `ctx-${digest.slice(7, 19)}`,
    ...body,
    digest
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
