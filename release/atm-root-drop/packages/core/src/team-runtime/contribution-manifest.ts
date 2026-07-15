import { createHash } from 'node:crypto';

export type TeamContributionManifest = {
  readonly schemaId: 'atm.teamContributionManifest.v1';
  readonly contributionId: string;
  readonly taskId: string;
  readonly role: string;
  readonly workerId: string;
  readonly baseCommit: string;
  readonly contextManifestDigest: string;
  readonly overlayDigest: string;
  readonly changedFiles: readonly string[];
  readonly validatorReceipts: readonly string[];
  readonly reviewerReceipt: TeamReviewerReceipt | null;
};

export type TeamReviewerReceipt = {
  readonly schemaId: 'atm.teamReviewerReceipt.v1';
  readonly reviewerRole: string;
  readonly cleanContext: true;
  readonly readSet: readonly ['base', 'contribution-manifest', 'diff', 'required-dependencies', 'acceptance-criteria', 'reviewer-context-manifest'];
  readonly receiptDigest: string;
};

export function createTeamContributionManifest(input: {
  readonly taskId: string;
  readonly role: string;
  readonly workerId: string;
  readonly baseCommit: string;
  readonly contextManifestDigest: string;
  readonly overlay: unknown;
  readonly changedFiles: readonly string[];
  readonly validatorReceipts?: readonly string[];
  readonly reviewerReceipt?: TeamReviewerReceipt | null;
}): TeamContributionManifest {
  const overlayDigest = `sha256:${sha256(JSON.stringify(input.overlay))}`;
  const contributionId = `contrib-${sha256(`${input.taskId}:${input.role}:${overlayDigest}`).slice(0, 12)}`;
  return {
    schemaId: 'atm.teamContributionManifest.v1',
    contributionId,
    taskId: input.taskId,
    role: input.role,
    workerId: input.workerId,
    baseCommit: input.baseCommit,
    contextManifestDigest: input.contextManifestDigest,
    overlayDigest,
    changedFiles: [...input.changedFiles].sort(),
    validatorReceipts: [...(input.validatorReceipts ?? [])],
    reviewerReceipt: input.reviewerReceipt ?? null
  };
}

export function createCleanContextReviewerReceipt(input: {
  readonly reviewerRole: string;
  readonly contributionDigest: string;
  readonly reviewerContextDigest: string;
}): TeamReviewerReceipt {
  const readSet = ['base', 'contribution-manifest', 'diff', 'required-dependencies', 'acceptance-criteria', 'reviewer-context-manifest'] as const;
  return {
    schemaId: 'atm.teamReviewerReceipt.v1',
    reviewerRole: input.reviewerRole,
    cleanContext: true,
    readSet,
    receiptDigest: `sha256:${sha256(`${input.reviewerRole}:${input.contributionDigest}:${input.reviewerContextDigest}:${readSet.join('|')}`)}`
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
