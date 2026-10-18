import type { CanonicalSkillCatalogEntry, ProjectedSkillCatalog, SkillInvocationPolicy, SkillProjectionFile } from './skill-catalog.js';
import type { SkillInstallProfileId, SkillTier } from './install-profile.js';
import type { Sha256Digest } from '../manifest/types.js';
export type ExternalSkillSourceFormat = 'codex-skill-directory' | 'claude-skill-directory' | 'markdown-skill-directory';
export type ExternalSkillProviderId = 'codex-global' | 'claude-code-global' | 'third-party' | (string & {});
export type FederationDecision = 'preserve-atm' | 'select-external' | 'preserve-first-external' | 'fail-closed';
export interface ExternalSkillSourceInput {
    readonly sourceId: string;
    readonly providerId: ExternalSkillProviderId;
    readonly rootDir: string;
    readonly sourceRootRef?: string;
    readonly sourceFormat?: ExternalSkillSourceFormat;
    readonly priority?: number;
    readonly provenance?: string;
    readonly license?: string | null;
}
export interface ExternalSkillSourceDescriptor {
    readonly sourceId: string;
    readonly providerId: ExternalSkillProviderId;
    readonly sourceRootRef: string;
    readonly sourceFormat: ExternalSkillSourceFormat;
    readonly priority: number;
    readonly provenance: string;
    readonly license: string | null;
    readonly sourceDigest: Sha256Digest;
    readonly skillCount: number;
    readonly rejectedCount: number;
}
export interface ExternalSkillCatalogEntry extends CanonicalSkillCatalogEntry {
    readonly sourceId: string;
    readonly providerId: ExternalSkillProviderId;
    readonly provenance: string;
    readonly license: string | null;
}
export interface ExternalSkillCatalog {
    readonly schemaId: 'atm.externalSkillCatalog.v1';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly sourceDigest: Sha256Digest;
    readonly sources: readonly ExternalSkillSourceDescriptor[];
    readonly entries: readonly ExternalSkillCatalogEntry[];
    readonly files: readonly SkillProjectionFile[];
    readonly skippedInvalidSources: readonly ExternalSkillCatalogSkip[];
}
export interface ExternalSkillCatalogSkip {
    readonly sourceId: string;
    readonly relativePath: string | null;
    readonly reason: string;
}
export interface ExternalSkillFederationDecision {
    readonly skillId: string;
    readonly decision: FederationDecision;
    readonly selectedSourceId: string | null;
    readonly preservedSourceId: string | null;
    readonly reason: string;
    readonly candidateSourceIds: readonly string[];
}
export interface FederatedSkillCatalog {
    readonly schemaId: 'atm.federatedSkillCatalog.v1';
    readonly specVersion: '0.1.0';
    readonly sourceDigest: Sha256Digest;
    readonly projectedCatalog: ProjectedSkillCatalog;
    readonly decisions: readonly ExternalSkillFederationDecision[];
    readonly skippedInvalidSources: readonly ExternalSkillCatalogSkip[];
}
export declare function loadExternalSkillCatalog(input: {
    readonly sources: readonly ExternalSkillSourceInput[];
    readonly defaultTier?: SkillTier;
    readonly defaultInstallProfiles?: readonly SkillInstallProfileId[];
    readonly defaultInvocationPolicy?: SkillInvocationPolicy;
}): ExternalSkillCatalog;
export declare function federateExternalSkillCatalog(input: {
    readonly baseCatalog: ProjectedSkillCatalog;
    readonly externalCatalog: ExternalSkillCatalog;
    readonly protectedNamespacePrefixes?: readonly string[];
}): FederatedSkillCatalog;
