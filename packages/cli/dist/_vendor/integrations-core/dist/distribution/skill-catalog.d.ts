import type { SkillCorpusSourceSnapshot } from '../compiler/skill-templates.js';
import type { IntegrationFileFormat } from '../manifest/types.js';
import type { SkillInstallProfileId, SkillTier } from './install-profile.js';
export type SkillInvocationPolicy = 'model-or-user' | 'explicit-user' | 'router-only' | 'emergency-only';
export interface AdapterCapabilityRequirement {
    readonly adapterId: string;
    readonly requires: readonly string[];
}
export interface CanonicalSkillCatalogEntry {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly command: string;
    readonly firstCommand: string;
    readonly owner: string;
    readonly tier: SkillTier;
    readonly installProfiles: readonly SkillInstallProfileId[];
    readonly invocationPolicy: SkillInvocationPolicy;
    readonly companionFiles: readonly string[];
    readonly adapterCapabilityRequirements: readonly AdapterCapabilityRequirement[];
    readonly sourcePath: string;
    readonly sourceDigest: `sha256:${string}`;
}
export interface CanonicalSkillCatalog {
    readonly schemaId: 'atm.canonicalSkillCatalog.v1';
    readonly compilerVersion: '0.1.0';
    readonly sourceDigest: `sha256:${string}`;
    readonly entries: readonly CanonicalSkillCatalogEntry[];
}
export interface SkillProjectionFile {
    readonly skillId: string;
    readonly relativePath: string;
    readonly content: string | Uint8Array;
    readonly fileFormat: IntegrationFileFormat;
    readonly sourceDigest: `sha256:${string}`;
    readonly managed: true;
}
export interface ProjectedSkillCatalog {
    readonly schemaId: 'atm.projectedSkillCatalog.v1';
    readonly adapterId: string;
    readonly sourceDigest: `sha256:${string}`;
    readonly entries: readonly CanonicalSkillCatalogEntry[];
    readonly files: readonly SkillProjectionFile[];
}
export declare function buildCanonicalSkillCatalog(snapshot: SkillCorpusSourceSnapshot): CanonicalSkillCatalog;
export declare function inferCompanionFiles(repositoryRoot: string, skillId: string): readonly string[];
