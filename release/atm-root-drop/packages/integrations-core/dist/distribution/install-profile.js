import { inspectFrameworkIdentity } from '../../../core/dist/project/framework-identity.js';
export const defaultSkillInstallProfiles = [
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
export function getSkillInstallProfile(profileId) {
    const profile = defaultSkillInstallProfiles.find((entry) => entry.id === profileId);
    if (!profile)
        throw new Error(`unknown skill install profile: ${profileId}`);
    return profile;
}
export function selectDefaultSkillInstallProfile(input) {
    if (input.targetScope === 'framework')
        return 'framework-full';
    if (input.targetScope === 'adopter')
        return 'adopter-bootstrap';
    if (input.targetScope === 'role')
        return 'role-oriented';
    if (input.targetScope === 'emergency')
        return 'emergency-explicit';
    if (inspectFrameworkIdentity(input.repositoryRoot).kind === 'framework')
        return 'framework-full';
    return 'adopter-bootstrap';
}
export function skillBelongsToProfile(input) {
    if (input.profile.excludeSkillIds.includes(input.skillId))
        return false;
    if (input.profile.includeSkillIds.includes(input.skillId))
        return true;
    return input.profile.includeTiers.includes(input.tier)
        && input.installProfiles.includes(input.profile.id);
}
