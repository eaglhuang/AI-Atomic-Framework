export type TeamLevelRecommendationInput = {
  readonly ownFiles: readonly string[];
  readonly foreignFiles: readonly string[];
  readonly foreignDirtyFiles?: readonly string[];
  readonly stagedFiles: readonly string[];
  readonly foreignActorIds: readonly string[];
};

export type TeamLevelRecommendation = {
  readonly level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  readonly reason: string;
  readonly ownFiles: readonly string[];
  readonly overlappingFiles: readonly string[];
  readonly foreignActors: readonly string[];
};

export function projectTeamLevelRecommendation(input: TeamLevelRecommendationInput): TeamLevelRecommendation {
  const ownFiles = uniqueSorted(input.ownFiles.map(normalizeWorkPath));
  const ownSet = new Set(ownFiles);
  const overlappingFiles = uniqueSorted([
    ...input.foreignFiles.map(normalizeWorkPath).filter((file) => ownSet.has(file)),
    ...(input.foreignDirtyFiles ?? []).map(normalizeWorkPath).filter((file) => ownSet.has(file)),
    ...input.stagedFiles.map(normalizeWorkPath).filter((file) => ownSet.has(file))
  ]);
  const foreignActors = uniqueSorted(input.foreignActorIds);
  const sharedIndexActive = input.stagedFiles.length > 0;
  const foreignDirtyActive = (input.foreignDirtyFiles ?? []).length > 0;
  const frameworkFoundationRisk = ownFiles.some(isFrameworkFoundationPath);
  if (frameworkFoundationRisk && (foreignActors.length > 0 || sharedIndexActive || foreignDirtyActive || overlappingFiles.length > 0)) {
    return {
      level: 'L5',
      reason: 'Framework foundation files are in scope while other active work, dirty WIP, or shared-index state exists; use the full Team Agent Broker lane.',
      ownFiles,
      overlappingFiles,
      foreignActors
    };
  }
  if (frameworkFoundationRisk) {
    return {
      level: 'L4',
      reason: 'Framework foundation files are in scope; use elevated coordination even without visible overlap.',
      ownFiles,
      overlappingFiles,
      foreignActors
    };
  }
  if (overlappingFiles.length > 1 || (overlappingFiles.length > 0 && sharedIndexActive)) {
    return {
      level: 'L4',
      reason: 'Active foreign work overlaps this scope across multiple files or the shared index, so add coordinator plus review/validation coverage.',
      ownFiles,
      overlappingFiles,
      foreignActors
    };
  }
  if (overlappingFiles.length === 1 || sharedIndexActive) {
    return {
      level: 'L3',
      reason: 'A concrete same-file or shared-index risk is present; use Broker arbitration with implementer and validator lanes.',
      ownFiles,
      overlappingFiles,
      foreignActors
    };
  }
  if (foreignDirtyActive) {
    return {
      level: 'L3',
      reason: 'Foreign active-task dirty WIP is present in the shared worktree; use Broker arbitration before committing or closing.',
      ownFiles,
      overlappingFiles: [],
      foreignActors
    };
  }
  if (foreignActors.length > 0) {
    return {
      level: 'L2',
      reason: 'Other active actors exist but no file overlap is visible for this scope; keep coordination light and monitor Broker status.',
      ownFiles,
      overlappingFiles: [],
      foreignActors
    };
  }
  return {
    level: 'L1',
    reason: 'No foreign active work or shared-index risk is visible; a single coordinator/implementer path is enough.',
    ownFiles,
    overlappingFiles: [],
    foreignActors: []
  };
}

function isFrameworkFoundationPath(filePath: string): boolean {
  const normalized = normalizeWorkPath(filePath);
  return normalized.startsWith('packages/core/')
    || normalized.startsWith('packages/cli/src/commands/next/')
    || normalized.startsWith('packages/cli/src/commands/taskflow/')
    || normalized.startsWith('packages/core/src/team-runtime/')
    || /^packages\/cli\/src\/commands\/(?:next\.ts|team\.ts|git-governance\.ts|hook\/pre-commit\.ts)/.test(normalized);
}

function normalizeWorkPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
