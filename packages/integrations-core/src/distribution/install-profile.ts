import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type SkillTier = 'entry' | 'specialist' | 'emergency';
export type SkillInstallProfileId = 'adopter-bootstrap' | 'framework-full' | 'role-oriented' | 'emergency-explicit';
export type SkillTargetScope = 'adopter' | 'framework' | 'role' | 'emergency';

export interface SkillInstallProfile {
  readonly id: SkillInstallProfileId;
  readonly targetScope: SkillTargetScope;
  readonly description: string;
  readonly includeTiers: readonly SkillTier[];
  readonly includeSkillIds: readonly string[];
  readonly excludeSkillIds: readonly string[];
}

export const defaultSkillInstallProfiles: readonly SkillInstallProfile[] = [
  {
    id: 'adopter-bootstrap',
    targetScope: 'adopter',
    description: 'Small ATM entry profile for ordinary adopter repositories.',
    includeTiers: ['entry'],
    includeSkillIds: [],
    excludeSkillIds: []
  },
  {
    id: 'framework-full',
    targetScope: 'framework',
    description: 'Full ATM skill corpus for framework repositories and governance dogfood.',
    includeTiers: ['entry', 'specialist', 'emergency'],
    includeSkillIds: [],
    excludeSkillIds: []
  },
  {
    id: 'role-oriented',
    targetScope: 'role',
    description: 'Entry skills plus role-oriented specialist workflows.',
    includeTiers: ['entry', 'specialist'],
    includeSkillIds: [],
    excludeSkillIds: ['atm-git-pathspec-emergency-commit']
  },
  {
    id: 'emergency-explicit',
    targetScope: 'emergency',
    description: 'Emergency skills are installed only when explicitly requested.',
    includeTiers: ['emergency'],
    includeSkillIds: [],
    excludeSkillIds: []
  }
];

export function getSkillInstallProfile(profileId: SkillInstallProfileId): SkillInstallProfile {
  const profile = defaultSkillInstallProfiles.find((entry) => entry.id === profileId);
  if (!profile) throw new Error(`unknown skill install profile: ${profileId}`);
  return profile;
}

export function selectDefaultSkillInstallProfile(input: {
  readonly repositoryRoot: string;
  readonly targetScope?: SkillTargetScope | null;
}): SkillInstallProfileId {
  if (input.targetScope === 'framework') return 'framework-full';
  if (input.targetScope === 'role') return 'role-oriented';
  if (input.targetScope === 'emergency') return 'emergency-explicit';
  const packageJsonPath = path.join(input.repositoryRoot, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
      if (packageJson.name === 'ai-atomic-framework' || packageJson.name === '@ai-atomic-framework/root') {
        return 'framework-full';
      }
    } catch {
      return 'adopter-bootstrap';
    }
  }
  return 'adopter-bootstrap';
}

export function skillBelongsToProfile(input: {
  readonly skillId: string;
  readonly tier: SkillTier;
  readonly installProfiles: readonly string[];
  readonly profile: SkillInstallProfile;
}): boolean {
  if (input.profile.excludeSkillIds.includes(input.skillId)) return false;
  if (input.profile.includeSkillIds.includes(input.skillId)) return true;
  return input.profile.includeTiers.includes(input.tier)
    && input.installProfiles.includes(input.profile.id);
}
