import type { InstallManifest } from '../manifest/types.js';
import { type SkillInstallProfile, type SkillTargetScope } from './install-profile.js';
import type { ProjectedSkillCatalog, SkillProjectionFile } from './skill-catalog.js';
export interface AdapterCapabilities {
    readonly adapterId: string;
    readonly fileFormats: readonly string[];
    readonly supportsCompanionFiles: boolean;
    readonly supportsCharterInjection: boolean;
}
export interface SkillInstallationPlanInput {
    readonly sourceCatalog: ProjectedSkillCatalog;
    readonly installProfile: SkillInstallProfile;
    readonly adapterCapabilities: AdapterCapabilities;
    readonly targetScope: SkillTargetScope;
    readonly existingManifest?: InstallManifest | null;
}
export interface SkillInstallationPlan {
    readonly schemaId: 'atm.skillInstallationPlan.v1';
    readonly sourceDigest: `sha256:${string}`;
    readonly profileId: string;
    readonly adapterId: string;
    readonly targetScope: SkillTargetScope;
    readonly managedSkillIds: readonly string[];
    readonly additions: readonly SkillProjectionFile[];
    readonly updates: readonly SkillProjectionFile[];
    readonly preservedUserFiles: readonly string[];
    readonly staleManagedProjections: readonly string[];
    readonly collisions: readonly string[];
    readonly degradationFindings: readonly string[];
    readonly manifestMetadata: {
        readonly sourceCatalogDigest: `sha256:${string}`;
        readonly profileId: string;
        readonly managedSkillIds: string;
        readonly adapterFormat: string;
        readonly targetScope: SkillTargetScope;
    };
}
export declare function resolveSkillInstallationPlan(input: SkillInstallationPlanInput): SkillInstallationPlan;
export declare function digestSkillInstallationPlan(plan: SkillInstallationPlan): `sha256:${string}`;
