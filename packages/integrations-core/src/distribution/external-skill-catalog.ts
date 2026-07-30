import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  AdapterCapabilityRequirement,
  CanonicalSkillCatalogEntry,
  ProjectedSkillCatalog,
  SkillInvocationPolicy,
  SkillProjectionFile
} from './skill-catalog.ts';
import type { SkillInstallProfileId, SkillTier } from './install-profile.ts';
import type { IntegrationFileFormat, Sha256Digest } from '../manifest/types.ts';
import { normalizeManifestPath } from '../manifest/schema.ts';

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

export function loadExternalSkillCatalog(input: {
  readonly sources: readonly ExternalSkillSourceInput[];
  readonly defaultTier?: SkillTier;
  readonly defaultInstallProfiles?: readonly SkillInstallProfileId[];
  readonly defaultInvocationPolicy?: SkillInvocationPolicy;
}): ExternalSkillCatalog {
  const entries: ExternalSkillCatalogEntry[] = [];
  const files: SkillProjectionFile[] = [];
  const skippedInvalidSources: ExternalSkillCatalogSkip[] = [];
  const sourceDescriptors: ExternalSkillSourceDescriptor[] = [];
  const sortedSources = [...input.sources].sort((left, right) =>
    (left.priority ?? 100) - (right.priority ?? 100) || left.sourceId.localeCompare(right.sourceId)
  );

  for (const source of sortedSources) {
    const sourceRootRef = source.sourceRootRef ?? `external:${source.sourceId}`;
    const sourceFormat = source.sourceFormat ?? 'markdown-skill-directory';
    const beforeEntryCount = entries.length;
    const beforeSkipCount = skippedInvalidSources.length;
    const skillDirs = discoverSkillDirectories(source.rootDir);
    if (skillDirs.length === 0) {
      skippedInvalidSources.push({ sourceId: source.sourceId, relativePath: null, reason: 'no SKILL.md files found' });
    }
    for (const skillDir of skillDirs) {
      const loaded = loadExternalSkillDirectory({
        source,
        sourceRootRef,
        sourceFormat,
        skillDir,
        defaultTier: input.defaultTier ?? 'specialist',
        defaultInstallProfiles: input.defaultInstallProfiles ?? ['framework-full', 'role-oriented'],
        defaultInvocationPolicy: input.defaultInvocationPolicy ?? 'explicit-user'
      });
      if (loaded.skip) {
        skippedInvalidSources.push(loaded.skip);
        continue;
      }
      entries.push(loaded.entry);
      files.push(...loaded.files);
    }
    sourceDescriptors.push({
      sourceId: source.sourceId,
      providerId: source.providerId,
      sourceRootRef,
      sourceFormat,
      priority: source.priority ?? 100,
      provenance: source.provenance ?? source.providerId,
      license: source.license ?? null,
      sourceDigest: digestStableJson({
        sourceId: source.sourceId,
        sourceRootRef,
        sourceFormat,
        entries: entries.slice(beforeEntryCount).map((entry) => ({
          id: entry.id,
          digest: entry.sourceDigest
        })),
        files: files.filter((file) => entries.slice(beforeEntryCount).some((entry) => entry.id === file.skillId)).map((file) => ({
          path: file.relativePath,
          digest: file.sourceDigest
        }))
      }),
      skillCount: entries.length - beforeEntryCount,
      rejectedCount: skippedInvalidSources.length - beforeSkipCount
    });
  }

  const orderedEntries = entries.sort((left, right) => left.id.localeCompare(right.id) || left.sourceId.localeCompare(right.sourceId));
  const orderedFiles = files.sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.sourceDigest.localeCompare(right.sourceDigest));
  const orderedSources = sourceDescriptors.sort((left, right) => left.priority - right.priority || left.sourceId.localeCompare(right.sourceId));
  return {
    schemaId: 'atm.externalSkillCatalog.v1',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'External skill catalogs are optional overlays and are not ATM product corpus authority.'
    },
    sourceDigest: digestStableJson({
      sources: orderedSources,
      entries: orderedEntries.map((entry) => ({
        id: entry.id,
        sourceId: entry.sourceId,
        sourceDigest: entry.sourceDigest
      })),
      files: orderedFiles.map((file) => ({
        skillId: file.skillId,
        relativePath: file.relativePath,
        sourceDigest: file.sourceDigest
      })),
      skippedInvalidSources
    }),
    sources: orderedSources,
    entries: orderedEntries,
    files: orderedFiles,
    skippedInvalidSources
  };
}

export function federateExternalSkillCatalog(input: {
  readonly baseCatalog: ProjectedSkillCatalog;
  readonly externalCatalog: ExternalSkillCatalog;
  readonly protectedNamespacePrefixes?: readonly string[];
}): FederatedSkillCatalog {
  const protectedPrefixes = input.protectedNamespacePrefixes ?? ['atm-'];
  const baseSkillIds = new Set(input.baseCatalog.entries.map((entry) => entry.id));
  const selectedExternal = new Map<string, ExternalSkillCatalogEntry>();
  const decisions: ExternalSkillFederationDecision[] = [];

  for (const entry of input.externalCatalog.entries) {
    if (baseSkillIds.has(entry.id)) {
      decisions.push({
        skillId: entry.id,
        decision: 'preserve-atm',
        selectedSourceId: null,
        preservedSourceId: entry.sourceId,
        reason: 'external skill id matches an ATM-owned skill',
        candidateSourceIds: [entry.sourceId]
      });
      continue;
    }
    if (protectedPrefixes.some((prefix) => entry.id.startsWith(prefix))) {
      decisions.push({
        skillId: entry.id,
        decision: 'fail-closed',
        selectedSourceId: null,
        preservedSourceId: entry.sourceId,
        reason: 'external skill id uses a protected ATM namespace',
        candidateSourceIds: [entry.sourceId]
      });
      continue;
    }
    const previous = selectedExternal.get(entry.id);
    if (previous) {
      decisions.push({
        skillId: entry.id,
        decision: 'preserve-first-external',
        selectedSourceId: previous.sourceId,
        preservedSourceId: entry.sourceId,
        reason: 'duplicate external skill id resolved by source priority order',
        candidateSourceIds: [previous.sourceId, entry.sourceId]
      });
      continue;
    }
    selectedExternal.set(entry.id, entry);
    decisions.push({
      skillId: entry.id,
      decision: 'select-external',
      selectedSourceId: entry.sourceId,
      preservedSourceId: null,
      reason: 'external skill selected as overlay entry',
      candidateSourceIds: [entry.sourceId]
    });
  }

  const selectedExternalIds = new Set([...selectedExternal.keys()]);
  const externalFiles = input.externalCatalog.files.filter((file) => selectedExternalIds.has(file.skillId));
  const projectedCatalog: ProjectedSkillCatalog = {
    schemaId: 'atm.projectedSkillCatalog.v1',
    adapterId: input.baseCatalog.adapterId,
    sourceDigest: digestStableJson({
      base: input.baseCatalog.sourceDigest,
      external: input.externalCatalog.sourceDigest,
      decisions
    }),
    entries: [...input.baseCatalog.entries, ...selectedExternal.values()].sort((left, right) => left.id.localeCompare(right.id)),
    files: [...input.baseCatalog.files, ...externalFiles].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  };

  return {
    schemaId: 'atm.federatedSkillCatalog.v1',
    specVersion: '0.1.0',
    sourceDigest: projectedCatalog.sourceDigest,
    projectedCatalog,
    decisions: decisions.sort((left, right) => left.skillId.localeCompare(right.skillId) || left.reason.localeCompare(right.reason)),
    skippedInvalidSources: input.externalCatalog.skippedInvalidSources
  };
}

function discoverSkillDirectories(rootDir: string): readonly string[] {
  if (!existsSync(rootDir)) return [];
  const directSkill = path.join(rootDir, 'SKILL.md');
  if (existsSync(directSkill)) return [rootDir];
  return readdirSync(rootDir)
    .map((entry) => path.join(rootDir, entry))
    .filter((entryPath) => statSync(entryPath).isDirectory() && existsSync(path.join(entryPath, 'SKILL.md')))
    .sort((left, right) => left.localeCompare(right));
}

function loadExternalSkillDirectory(input: {
  readonly source: ExternalSkillSourceInput;
  readonly sourceRootRef: string;
  readonly sourceFormat: ExternalSkillSourceFormat;
  readonly skillDir: string;
  readonly defaultTier: SkillTier;
  readonly defaultInstallProfiles: readonly SkillInstallProfileId[];
  readonly defaultInvocationPolicy: SkillInvocationPolicy;
}): { readonly entry: ExternalSkillCatalogEntry; readonly files: readonly SkillProjectionFile[]; readonly skip?: never } | { readonly skip: ExternalSkillCatalogSkip } {
  const skillPath = path.join(input.skillDir, 'SKILL.md');
  const relativeSkillDir = normalizeRelativePath(path.relative(input.source.rootDir, input.skillDir)) || path.basename(input.skillDir);
  try {
    const content = readFileSync(skillPath, 'utf8');
    const frontmatter = parseSimpleFrontmatter(content);
    const skillId = normalizeSkillId(String(frontmatter.id ?? frontmatter.name ?? relativeSkillDir));
    if (!skillId) {
      return { skip: { sourceId: input.source.sourceId, relativePath: `${relativeSkillDir}/SKILL.md`, reason: 'missing skill id' } };
    }
    const sourceDigest = digestText(content);
    const companionFiles = listCompanionFiles(input.skillDir);
    const files: SkillProjectionFile[] = [
      {
        skillId,
        relativePath: `${skillId}/SKILL.md`,
        content,
        fileFormat: toIntegrationFileFormat(input.sourceFormat),
        sourceDigest,
        managed: true
      },
      ...companionFiles.map((companion): SkillProjectionFile => ({
        skillId,
        relativePath: `${skillId}/${companion.relativePath}`,
        content: companion.content,
        fileFormat: inferFileFormat(companion.relativePath),
        sourceDigest: digestBytes(companion.content),
        managed: true
      }))
    ];
    const entry: ExternalSkillCatalogEntry = {
      id: skillId,
      title: String(frontmatter.title ?? frontmatter.name ?? skillId),
      summary: String(frontmatter.summary ?? frontmatter.description ?? ''),
      command: String(frontmatter.command ?? skillId),
      firstCommand: String(frontmatter.firstCommand ?? ''),
      owner: String(frontmatter.owner ?? input.source.providerId),
      tier: parseTier(frontmatter.tier, input.defaultTier),
      installProfiles: parseInstallProfiles(frontmatter.installProfiles, input.defaultInstallProfiles),
      invocationPolicy: parseInvocationPolicy(frontmatter.invocationPolicy, input.defaultInvocationPolicy),
      companionFiles: companionFiles.map((file) => `${skillId}/${file.relativePath}`),
      adapterCapabilityRequirements: parseCapabilityRequirements(frontmatter.adapterCapabilityRequirements),
      sourcePath: `${input.sourceRootRef}/${normalizeRelativePath(path.relative(input.source.rootDir, skillPath))}`,
      sourceDigest,
      sourceId: input.source.sourceId,
      providerId: input.source.providerId,
      provenance: input.source.provenance ?? input.source.providerId,
      license: input.source.license ?? null
    };
    return { entry, files };
  } catch (error) {
    return {
      skip: {
        sourceId: input.source.sourceId,
        relativePath: `${relativeSkillDir}/SKILL.md`,
        reason: error instanceof Error ? error.message : 'unreadable skill'
      }
    };
  }
}

function parseSimpleFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end < 0) return {};
  const record: Record<string, unknown> = {};
  let currentArrayKey: string | null = null;
  for (const rawLine of content.slice(3, end).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const arrayItem = line.match(/^\s*-\s+(.+)$/);
    if (arrayItem && currentArrayKey) {
      const current = Array.isArray(record[currentArrayKey]) ? record[currentArrayKey] as string[] : [];
      record[currentArrayKey] = [...current, unquote(arrayItem[1] ?? '')];
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1] ?? '';
    const value = match[2] ?? '';
    if (value === '') {
      record[key] = [];
      currentArrayKey = key;
    } else {
      record[key] = unquote(value);
      currentArrayKey = null;
    }
  }
  return record;
}

function listCompanionFiles(skillDir: string): readonly { readonly relativePath: string; readonly content: Uint8Array }[] {
  const result: { relativePath: string; content: Uint8Array }[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absolutePath = path.join(directory, entry);
      if (absolutePath === path.join(skillDir, 'SKILL.md')) continue;
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        visit(absolutePath);
      } else {
        result.push({
          relativePath: normalizeRelativePath(path.relative(skillDir, absolutePath)),
          content: readFileSync(absolutePath)
        });
      }
    }
  };
  visit(skillDir);
  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function parseTier(value: unknown, fallback: SkillTier): SkillTier {
  return value === 'entry' || value === 'specialist' || value === 'emergency' ? value : fallback;
}

function parseInstallProfiles(value: unknown, fallback: readonly SkillInstallProfileId[]): readonly SkillInstallProfileId[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is SkillInstallProfileId =>
    item === 'adopter-bootstrap' || item === 'framework-full' || item === 'role-oriented' || item === 'emergency-explicit'
  );
}

function parseInvocationPolicy(value: unknown, fallback: SkillInvocationPolicy): SkillInvocationPolicy {
  return value === 'model-or-user' || value === 'explicit-user' || value === 'router-only' || value === 'emergency-only'
    ? value
    : fallback;
}

function parseCapabilityRequirements(value: unknown): readonly AdapterCapabilityRequirement[] {
  return Array.isArray(value) ? value.filter((item): item is AdapterCapabilityRequirement => Boolean(item)) : [];
}

function normalizeSkillId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeRelativePath(candidatePath: string): string {
  if (!candidatePath || candidatePath === '.') return '';
  return normalizeManifestPath(candidatePath);
}

function toIntegrationFileFormat(format: ExternalSkillSourceFormat): IntegrationFileFormat {
  return format === 'markdown-skill-directory' ? 'markdown' : 'skill';
}

function inferFileFormat(relativePath: string): IntegrationFileFormat {
  return relativePath.endsWith('.toml') ? 'toml' : relativePath.endsWith('.yaml') || relativePath.endsWith('.yml') ? 'yaml' : 'markdown';
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function digestText(value: string): Sha256Digest {
  return digestBytes(Buffer.from(value, 'utf8'));
}

function digestBytes(value: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digestStableJson(value: unknown): Sha256Digest {
  return digestText(JSON.stringify(value));
}
