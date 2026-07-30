import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AtmSkillTemplate, SkillCorpusSourceSnapshot } from '../compiler/skill-templates.ts';
import type { IntegrationFileFormat } from '../manifest/types.ts';
import type { SkillInstallProfileId, SkillTier } from './install-profile.ts';

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

export function buildCanonicalSkillCatalog(snapshot: SkillCorpusSourceSnapshot): CanonicalSkillCatalog {
  const sourceByPath = new Map(snapshot.sourceFiles.map((file) => [file.sourcePath, file.sourceDigest]));
  return {
    schemaId: 'atm.canonicalSkillCatalog.v1',
    compilerVersion: snapshot.compilerVersion,
    sourceDigest: snapshot.sourceDigest,
    entries: snapshot.templates.map((template) => toCatalogEntry(template, sourceByPath.get(template.sourcePath)))
  };
}

export function inferCompanionFiles(repositoryRoot: string, skillId: string): readonly string[] {
  const companionRoot = path.join(repositoryRoot, 'templates', 'skills', `${skillId}.files`);
  if (!existsSync(companionRoot)) return [];
  return [`templates/skills/${skillId}.files/**`];
}

function toCatalogEntry(template: AtmSkillTemplate, sourceDigest: `sha256:${string}` | undefined): CanonicalSkillCatalogEntry {
  const frontmatter = template.frontmatter;
  return {
    id: frontmatter.id,
    title: frontmatter.title,
    summary: frontmatter.summary,
    command: frontmatter.command,
    firstCommand: frontmatter.firstCommand,
    owner: frontmatter.owner,
    tier: frontmatter.tier,
    installProfiles: frontmatter.installProfiles,
    invocationPolicy: frontmatter.invocationPolicy,
    companionFiles: frontmatter.companionFiles,
    adapterCapabilityRequirements: frontmatter.adapterCapabilityRequirements,
    sourcePath: template.sourcePath,
    sourceDigest: sourceDigest ?? sha256Text(`${template.sourcePath}\n${template.body}`)
  };
}

function sha256Text(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
