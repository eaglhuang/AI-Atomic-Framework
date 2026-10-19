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
export declare const defaultSkillInstallProfiles: readonly SkillInstallProfile[];
export declare function getSkillInstallProfile(profileId: SkillInstallProfileId): SkillInstallProfile;
export declare function selectDefaultSkillInstallProfile(input: {
    readonly repositoryRoot: string;
    readonly targetScope?: SkillTargetScope | null;
}): SkillInstallProfileId;
export declare function skillBelongsToProfile(input: {
    readonly skillId: string;
    readonly tier: SkillTier;
    readonly installProfiles: readonly string[];
    readonly profile: SkillInstallProfile;
}): boolean;
