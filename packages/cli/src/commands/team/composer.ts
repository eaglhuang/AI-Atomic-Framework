import { createHash } from 'node:crypto';
import type { TeamContributionManifest } from '../../../../core/src/team-runtime/contribution-manifest.ts';
import { isPathAllowedByScope } from '../work-channels.ts';

export type TeamContributionFile = {
  readonly path: string;
  readonly sha256: string;
};

export type TeamContributionOverlay = {
  readonly manifest: TeamContributionManifest;
  readonly files: readonly TeamContributionFile[];
};

export type TeamContributionConflict = {
  readonly path: string;
  readonly hashes: readonly string[];
  readonly contributionIds: readonly string[];
};

export type TeamContributionFinalTreeFile = {
  readonly path: string;
  readonly sha256: string;
  readonly contributionIds: readonly string[];
};

export type TeamContributionScopeExpansion = {
  readonly owner: 'composer';
  readonly required: boolean;
  readonly candidateFiles: readonly string[];
  readonly reason: string | null;
};

export type TeamContributionCompositionResult = {
  readonly schemaId: 'atm.teamContributionComposition.v1';
  readonly taskId: string;
  readonly baseCommit: string;
  readonly failClosed: boolean;
  readonly finalTreeDigest: string;
  readonly finalTree: {
    readonly files: readonly TeamContributionFinalTreeFile[];
  };
  readonly conflicts: readonly TeamContributionConflict[];
  readonly scopeExpansion: TeamContributionScopeExpansion;
};

export function composeTeamContributionManifests(input: {
  readonly taskId: string;
  readonly baseCommit: string;
  readonly contributions: readonly TeamContributionOverlay[];
  readonly declaredScope: readonly string[];
}): TeamContributionCompositionResult {
  const filesByPath = new Map<string, Array<{ sha256: string; contributionId: string }>>();
  const invalidContributionIds: string[] = [];

  for (const contribution of input.contributions) {
    if (
      contribution.manifest.taskId !== input.taskId
      || contribution.manifest.baseCommit !== input.baseCommit
    ) {
      invalidContributionIds.push(contribution.manifest.contributionId);
      continue;
    }
    const declaredChangedFiles = new Set(contribution.manifest.changedFiles.map(normalizeComposerPath));
    for (const file of contribution.files) {
      const filePath = normalizeComposerPath(file.path);
      if (!declaredChangedFiles.has(filePath)) {
        invalidContributionIds.push(contribution.manifest.contributionId);
        continue;
      }
      const current = filesByPath.get(filePath) ?? [];
      current.push({
        sha256: normalizeSha256(file.sha256),
        contributionId: contribution.manifest.contributionId
      });
      filesByPath.set(filePath, current);
    }
  }

  const conflicts: TeamContributionConflict[] = [];
  const finalFiles: TeamContributionFinalTreeFile[] = [];
  for (const [filePath, entries] of [...filesByPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const hashes = uniqueSorted(entries.map((entry) => entry.sha256));
    const contributionIds = uniqueSorted(entries.map((entry) => entry.contributionId));
    if (hashes.length > 1) {
      conflicts.push({ path: filePath, hashes, contributionIds });
      continue;
    }
    finalFiles.push({ path: filePath, sha256: hashes[0], contributionIds });
  }

  const candidateFiles = uniqueSorted(
    finalFiles
      .map((file) => file.path)
      .filter((file) => !isPathAllowedByScope(file, input.declaredScope))
  );
  const scopeExpansion: TeamContributionScopeExpansion = {
    owner: 'composer',
    required: candidateFiles.length > 0,
    candidateFiles,
    reason: candidateFiles.length > 0
      ? 'Composer found worker output outside the declared scope; workers must not transfer ownership in flight.'
      : null
  };
  const failClosed = conflicts.length > 0 || invalidContributionIds.length > 0 || scopeExpansion.required;
  return {
    schemaId: 'atm.teamContributionComposition.v1',
    taskId: input.taskId,
    baseCommit: input.baseCommit,
    failClosed,
    finalTreeDigest: digestFinalTree(finalFiles, conflicts, invalidContributionIds, scopeExpansion),
    finalTree: { files: finalFiles },
    conflicts,
    scopeExpansion
  };
}

function normalizeComposerPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeSha256(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('sha256:') ? trimmed : `sha256:${trimmed}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function digestFinalTree(
  files: readonly TeamContributionFinalTreeFile[],
  conflicts: readonly TeamContributionConflict[],
  invalidContributionIds: readonly string[],
  scopeExpansion: TeamContributionScopeExpansion
): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({
    files,
    conflicts,
    invalidContributionIds: uniqueSorted(invalidContributionIds),
    scopeExpansion
  })).digest('hex')}`;
}
