/**
 * compiler/skill-templates.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * ATM skill template parser, loader, and minimum entry skill definitions.
 * No dependencies on manifest or verify submodules.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterCapabilityRequirement, SkillInvocationPolicy } from '../distribution/skill-catalog.ts';
import {
  type SkillInstallProfileId,
  type SkillTier,
  defaultSkillInstallProfiles,
  getSkillInstallProfile,
  skillBelongsToProfile
} from '../distribution/install-profile.ts';

// Private: repo root is 4 levels above packages/integrations-core/src/compiler/
const integrationsCoreRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const defaultSkillTemplateDirectory = path.join(integrationsCoreRepoRoot, 'templates', 'skills');

export type SkillTemplateAdapterTarget = 'claude-code' | 'copilot' | 'cursor' | 'gemini' | 'codex';

export interface AtmSkillTemplateFrontmatter {
  readonly schemaId: 'atm.skillTemplate';
  readonly specVersion: '0.1.0';
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly command: string;
  readonly firstCommand: string;
  readonly 'charter-invariants-injected': boolean;
  readonly handoffs: string;
  readonly owner: string;
  readonly tier: SkillTier;
  readonly installProfiles: readonly SkillInstallProfileId[];
  readonly invocationPolicy: SkillInvocationPolicy;
  readonly companionFiles: readonly string[];
  readonly adapterCapabilityRequirements: readonly AdapterCapabilityRequirement[];
}

export interface SkillProviderProvenance {
  readonly providerId: string;
  readonly version: string;
  readonly provenance: {
    readonly upstreamUrl: string;
    readonly upstreamCommit: string;
    readonly sourceDigest: `sha256:${string}`;
  };
  readonly license: string;
}

export interface AtmSkillDefinitionVNext {
  readonly schemaId: 'atm.skillDefinition.vNext';
  readonly specVersion: '0.1.0';
  readonly provider: SkillProviderProvenance;
  readonly capabilities: readonly string[];
  readonly compatibility: { readonly atmContractVersions: readonly string[] };
  readonly fallbackPolicy: 'deny' | 'degrade-with-evidence' | 'legacy-compatible';
  readonly rollbackPolicy: 'provider-only' | 'manifest-only' | 'full-revert';
  readonly invocationModes?: readonly ('model' | 'user' | 'router')[];
  readonly progressiveDisclosure?: readonly SkillProgressiveDisclosureReference[];
  readonly completionCriteria?: readonly SkillCompletionCriterion[];
  readonly canaryMeasurements?: SkillCanaryMeasurements;
  readonly shadowRun?: boolean;
  readonly promotion?: 'manual-review' | 'measured-promotion' | 'disabled';
}

export interface SkillProgressiveDisclosureReference {
  readonly id: string;
  readonly path: string;
  readonly purpose: string;
  readonly maxTokens?: number;
}

export interface SkillCompletionCriterion {
  readonly id: string;
  readonly validator: string;
  readonly required: boolean;
}

export interface SkillCanaryMeasurements {
  readonly contextTokens: { readonly target: number; readonly max: number };
  readonly falseInvocationRate: { readonly target: number; readonly max: number };
}

export interface SkillCapabilityManifestInput {
  readonly provider: SkillProviderProvenance;
  readonly capabilities: readonly string[];
  readonly atmContractVersions: readonly string[];
  readonly fallbackPolicy?: AtmSkillDefinitionVNext['fallbackPolicy'];
  readonly rollbackPolicy?: AtmSkillDefinitionVNext['rollbackPolicy'];
  readonly invocationModes?: readonly ('model' | 'user' | 'router')[];
  readonly progressiveDisclosure?: readonly SkillProgressiveDisclosureReference[];
  readonly completionCriteria?: readonly SkillCompletionCriterion[];
  readonly canaryMeasurements?: SkillCanaryMeasurements;
  readonly shadowRun?: boolean;
  readonly promotion?: AtmSkillDefinitionVNext['promotion'];
}

export function createSkillDefinitionVNext(input: SkillCapabilityManifestInput): AtmSkillDefinitionVNext {
  const capabilities = [...new Set(input.capabilities.map((value) => value.trim()).filter(Boolean))].sort();
  const atmContractVersions = [...new Set(input.atmContractVersions.map((value) => value.trim()).filter(Boolean))].sort();
  const defaultInvocationModes: readonly ('model' | 'user' | 'router')[] = ['model', 'user', 'router'];
  const invocationModes: readonly ('model' | 'user' | 'router')[] = [...new Set(input.invocationModes ?? defaultInvocationModes)];
  if (capabilities.length === 0) throw new Error('skill definition requires at least one capability');
  if (atmContractVersions.length === 0) throw new Error('skill definition requires an ATM contract version');
  return {
    schemaId: 'atm.skillDefinition.vNext',
    specVersion: '0.1.0',
    provider: input.provider,
    capabilities,
    compatibility: { atmContractVersions },
    invocationModes,
    progressiveDisclosure: normalizeDisclosureReferences(input.progressiveDisclosure),
    completionCriteria: normalizeCompletionCriteria(input.completionCriteria),
    canaryMeasurements: input.canaryMeasurements,
    fallbackPolicy: input.fallbackPolicy ?? 'degrade-with-evidence',
    rollbackPolicy: input.rollbackPolicy ?? 'provider-only',
    shadowRun: input.shadowRun ?? true,
    promotion: input.promotion ?? 'manual-review'
  };
}

function normalizeDisclosureReferences(
  references: readonly SkillProgressiveDisclosureReference[] | undefined
): readonly SkillProgressiveDisclosureReference[] | undefined {
  if (!references) return undefined;
  return [...references]
    .map((reference) => ({ ...reference, id: reference.id.trim(), path: reference.path.trim(), purpose: reference.purpose.trim() }))
    .filter((reference) => reference.id && reference.path && reference.purpose)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeCompletionCriteria(
  criteria: readonly SkillCompletionCriterion[] | undefined
): readonly SkillCompletionCriterion[] | undefined {
  if (!criteria) return undefined;
  return [...criteria]
    .map((criterion) => ({ ...criterion, id: criterion.id.trim(), validator: criterion.validator.trim() }))
    .filter((criterion) => criterion.id && criterion.validator)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function projectSkillDefinition(
  template: AtmSkillTemplate,
  manifest: SkillCapabilityManifestInput
): AtmSkillDefinitionVNext & { readonly skillId: string; readonly legacyReadable: true } {
  return {
    ...createSkillDefinitionVNext(manifest),
    skillId: template.frontmatter.id,
    legacyReadable: true
  };
}

export interface AtmSkillTemplate {
  readonly frontmatter: AtmSkillTemplateFrontmatter;
  readonly body: string;
  readonly sourcePath: string;
}

export interface CompileSkillTemplateOptions {
  readonly repositoryRoot?: string;
}

export interface SkillCorpusSourceFile {
  readonly id: string;
  readonly sourcePath: string;
  readonly content: string;
  readonly sourceDigest: `sha256:${string}`;
}

export interface SkillCorpusSourceSnapshot {
  readonly schemaId: 'atm.skillCorpusSourceSnapshot.v1';
  readonly compilerVersion: '0.1.0';
  readonly generatedAt: string;
  readonly sourceRoot: string;
  readonly templateCount: number;
  readonly templates: readonly AtmSkillTemplate[];
  readonly sourceFiles: readonly SkillCorpusSourceFile[];
  readonly sourceDigest: `sha256:${string}`;
  readonly ignoredSourceTemplatePaths: readonly string[];
}

export interface SkillCorpusAdapterDescriptor<TProjectionFile = unknown> {
  readonly adapterId: SkillTemplateAdapterTarget;
  readonly manifestDigest?: `sha256:${string}`;
  readonly diagnostics?: readonly string[];
  readonly project: (input: {
    readonly adapterId: SkillTemplateAdapterTarget;
    readonly templates: readonly AtmSkillTemplate[];
    readonly sourceSnapshot: SkillCorpusSourceSnapshot;
  }) => readonly TProjectionFile[];
}

export interface SkillCorpusProjection<TProjectionFile = unknown> {
  readonly schemaId: 'atm.skillCorpusProjection.v1';
  readonly compilerVersion: '0.1.0';
  readonly adapterId: SkillTemplateAdapterTarget;
  readonly sourceDigest: `sha256:${string}`;
  readonly manifestDigest: `sha256:${string}`;
  readonly degradationDiagnostics: readonly string[];
  readonly files: readonly TProjectionFile[];
}

export interface MinimumAtmEntrySkillDefinition {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly command: string;
}

export const minimumAtmEntrySkillDefinitions = loadSkillTemplatesForProfile('adopter-bootstrap').map((template) => ({
  id: template.frontmatter.id,
  title: template.frontmatter.title,
  summary: template.frontmatter.summary,
  command: template.frontmatter.command
})) as readonly MinimumAtmEntrySkillDefinition[];

/**
 * Section marker that carries the ATM-only execution route warning into the
 * canonical entry skills. The policy itself lives in the core
 * RestrictedExecutionGateway; templates only project it, and the projection is
 * required so a compiled skill cannot silently drop the warning.
 */export const atmOnlyExecutionRouteSectionMarker = 'ATM-Only Execution Route';

export const atmOnlyExecutionRouteTemplateIds: readonly string[] = [
  'atm-governance-router',
  'atm-dispatch',
  'atm-next'
];

export function assertAtmOnlyExecutionRouteProjection(templates: readonly AtmSkillTemplate[]): void {
  const templatesById = new Map(templates.map((template) => [template.frontmatter.id, template]));
  for (const templateId of atmOnlyExecutionRouteTemplateIds) {
    const template = templatesById.get(templateId);
    if (!template) continue;
    if (!template.body.includes(atmOnlyExecutionRouteSectionMarker)) {
      throw new Error(`skill template ${templateId} must project the ${atmOnlyExecutionRouteSectionMarker} section`);
    }
  }
}

export function parseSkillTemplate(content: string, sourcePath = '<inline>'): AtmSkillTemplate {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error(`skill template missing frontmatter: ${sourcePath}`);
  }
  const frontmatter = parseSkillTemplateFrontmatter(frontmatterMatch[1], sourcePath);
  return {
    frontmatter,
    body: frontmatterMatch[2],
    sourcePath
  };
}

export function loadSkillTemplates(templateDirectory = defaultSkillTemplateDirectory): readonly AtmSkillTemplate[] {
  return readdirSync(templateDirectory)
    .filter((entryName) => entryName.endsWith('.skill.md'))
    .sort((left, right) => left.localeCompare(right))
    .map((entryName) => {
      const templatePath = path.join(templateDirectory, entryName);
      return parseSkillTemplate(readFileSync(templatePath, 'utf8'), path.relative(integrationsCoreRepoRoot, templatePath).replace(/\\/g, '/'));
    });
}

export function loadMinimumAtmSkillTemplates(templateDirectory = defaultSkillTemplateDirectory): readonly AtmSkillTemplate[] {
  const loaded = loadSkillTemplatesForProfile('adopter-bootstrap', templateDirectory);
  assertAtmOnlyExecutionRouteProjection(loaded);
  return loaded;
}

export function loadSkillTemplatesForProfile(
  profileId: SkillInstallProfileId,
  templateDirectory = defaultSkillTemplateDirectory
): readonly AtmSkillTemplate[] {
  const profile = getSkillInstallProfile(profileId);
  return loadSkillTemplates(templateDirectory)
    .filter((template) => skillBelongsToProfile({
      skillId: template.frontmatter.id,
      tier: template.frontmatter.tier,
      installProfiles: template.frontmatter.installProfiles,
      profile
    }));
}

export function loadSkillCorpusSourceSnapshot(templateDirectory = defaultSkillTemplateDirectory): SkillCorpusSourceSnapshot {
  const templates = loadSkillTemplates(templateDirectory);
  const sourceFiles = templates.map((template) => {
    const absolutePath = path.join(integrationsCoreRepoRoot, template.sourcePath);
    const content = readFileSync(absolutePath, 'utf8');
    return {
      id: template.frontmatter.id,
      sourcePath: template.sourcePath,
      content,
      sourceDigest: sha256Text(content)
    };
  });
  const sourceDigest = sha256Text(JSON.stringify(sourceFiles.map((file) => ({
    sourcePath: file.sourcePath,
    sourceDigest: file.sourceDigest
  }))));
  return {
    schemaId: 'atm.skillCorpusSourceSnapshot.v1',
    compilerVersion: '0.1.0',
    generatedAt: new Date(0).toISOString(),
    sourceRoot: path.relative(integrationsCoreRepoRoot, templateDirectory).replace(/\\/g, '/'),
    templateCount: templates.length,
    templates,
    sourceFiles,
    sourceDigest,
    ignoredSourceTemplatePaths: collectIgnoredSkillTemplatePaths(templateDirectory)
  };
}

/**
 * Why a discovered source file could not become a corpus member every adapter
 * can bake. These are the ways a file can exist on disk, look like a template,
 * and still reach no installation.
 */
export type SkillCorpusDiscoveryReason =
  | 'unparsable-frontmatter'
  | 'missing-contract-fields'
  | 'no-install-profile';

export interface SkillCorpusDiscoveryFinding {
  readonly sourcePath: string;
  readonly reason: SkillCorpusDiscoveryReason;
  /** Contract fields that are absent or hold a value the contract does not allow. */
  readonly missingFields: readonly string[];
  readonly recovery: string;
}

/**
 * Report every discovered `*.skill.md` that cannot reach an adapter.
 *
 * Discovery is decided only by the declared contract, never by a known skill
 * id, filename, or workstation path. A source file that satisfies the contract
 * and belongs to at least one install profile produces no finding; anything
 * else must be reported here rather than disappearing between the corpus count
 * and the bake.
 */
export function collectSkillCorpusDiscoveryFindings(
  templateDirectory = defaultSkillTemplateDirectory
): readonly SkillCorpusDiscoveryFinding[] {
  const findings: SkillCorpusDiscoveryFinding[] = [];
  for (const entryName of readdirSync(templateDirectory).filter((entry) => entry.endsWith('.skill.md')).sort()) {
    const templatePath = path.join(templateDirectory, entryName);
    const sourcePath = path.relative(integrationsCoreRepoRoot, templatePath).replace(/\\/g, '/');
    let template: AtmSkillTemplate;
    try {
      template = parseSkillTemplate(readFileSync(templatePath, 'utf8'), sourcePath);
    } catch (error) {
      findings.push({
        sourcePath,
        reason: 'unparsable-frontmatter',
        missingFields: [],
        recovery: `Repair the frontmatter block so it parses as an ${skillTemplateSchemaId} template: ${(error as Error).message}`
      });
      continue;
    }
    const unsatisfied = collectUnsatisfiedContractFields(template.frontmatter);
    if (unsatisfied.length > 0) {
      findings.push({
        sourcePath,
        reason: 'missing-contract-fields',
        missingFields: unsatisfied,
        recovery: `Declare the ${skillTemplateSchemaId} contract fields ${unsatisfied.join(', ')} in this template's frontmatter. Source templates use the template contract, not the frontmatter shape of a built adapter artifact.`
      });
      continue;
    }
    const reachableProfiles = defaultSkillInstallProfiles.filter((profile) => skillBelongsToProfile({
      skillId: template.frontmatter.id,
      tier: template.frontmatter.tier,
      installProfiles: template.frontmatter.installProfiles,
      profile
    }));
    if (reachableProfiles.length === 0) {
      findings.push({
        sourcePath,
        reason: 'no-install-profile',
        missingFields: ['installProfiles'],
        recovery: `Template ${template.frontmatter.id} (tier ${template.frontmatter.tier}) belongs to no install profile, so no adapter can bake it. Name a profile whose includeTiers admit its tier: ${defaultSkillInstallProfiles.map((profile) => profile.id).join(', ')}.`
      });
    }
  }
  return findings;
}

export function compileSkillCorpus<TProjectionFile>(
  input: {
    readonly sourceSnapshot: SkillCorpusSourceSnapshot;
    readonly adapterDescriptor: SkillCorpusAdapterDescriptor<TProjectionFile>;
  }
): SkillCorpusProjection<TProjectionFile> {
  const files = input.adapterDescriptor.project({
    adapterId: input.adapterDescriptor.adapterId,
    templates: input.sourceSnapshot.templates,
    sourceSnapshot: input.sourceSnapshot
  });
  const degradationDiagnostics = [...(input.adapterDescriptor.diagnostics ?? [])].sort();
  return {
    schemaId: 'atm.skillCorpusProjection.v1',
    compilerVersion: input.sourceSnapshot.compilerVersion,
    adapterId: input.adapterDescriptor.adapterId,
    sourceDigest: input.sourceSnapshot.sourceDigest,
    manifestDigest: input.adapterDescriptor.manifestDigest ?? sha256Text(JSON.stringify(files)),
    degradationDiagnostics,
    files
  };
}

// ─── Private helpers ───────────────────────────────────────────────────────

function parseSkillTemplateFrontmatter(frontmatterSource: string, sourcePath: string): AtmSkillTemplateFrontmatter {
  const frontmatter: Record<string, unknown> = {};
  let activeArrayKey: string | null = null;
  for (const rawLine of frontmatterSource.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('- ')) {
      if (!activeArrayKey) {
        throw new Error(`invalid skill template frontmatter array item in ${sourcePath}: ${line}`);
      }
      const currentValue = frontmatter[activeArrayKey];
      if (!Array.isArray(currentValue)) {
        throw new Error(`invalid skill template frontmatter array target in ${sourcePath}: ${activeArrayKey}`);
      }
      currentValue.push(parseFrontmatterScalar(line.slice(2).trim()));
      continue;
    }
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      throw new Error(`invalid skill template frontmatter line in ${sourcePath}: ${line}`);
    }
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (rawValue.length === 0) {
      frontmatter[key] = [];
      activeArrayKey = key;
      continue;
    }
    frontmatter[key] = parseFrontmatterValue(rawValue);
    activeArrayKey = null;
  }
  frontmatter.adapterCapabilityRequirements = parseAdapterCapabilityRequirements(
    frontmatter.adapterCapabilityRequirements,
    sourcePath
  );
  return frontmatter as unknown as AtmSkillTemplateFrontmatter;
}

function parseFrontmatterValue(value: string): string | boolean | readonly string[] {
  if (value.startsWith('[') && value.endsWith(']')) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    return body.split(',').map((entry) => String(parseFrontmatterScalar(entry.trim())));
  }
  return parseFrontmatterScalar(value);
}

function parseFrontmatterScalar(value: string): string | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value.replace(/^['"]|['"]$/g, '');
}

function parseAdapterCapabilityRequirements(value: unknown, sourcePath: string): readonly AdapterCapabilityRequirement[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const text = String(entry);
    const separatorIndex = text.indexOf(':');
    if (separatorIndex < 0) {
      throw new Error(`invalid adapter capability requirement in ${sourcePath}: ${text}`);
    }
    return {
      adapterId: text.slice(0, separatorIndex).trim(),
      requires: text.slice(separatorIndex + 1).split('+').map((item) => item.trim()).filter(Boolean)
    };
  });
}

function sha256Text(content: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

const skillTemplateSchemaId = 'atm.skillTemplate';
const skillTemplateSpecVersion = '0.1.0';

function collectUnsatisfiedContractFields(frontmatter: AtmSkillTemplateFrontmatter): readonly string[] {
  const declared = frontmatter as unknown as Record<string, unknown>;
  const unsatisfied: string[] = [];
  const requireText = (field: string) => {
    const value = declared[field];
    if (typeof value !== 'string' || value.trim().length === 0) unsatisfied.push(field);
  };
  if (declared.schemaId !== skillTemplateSchemaId) unsatisfied.push('schemaId');
  if (declared.specVersion !== skillTemplateSpecVersion) unsatisfied.push('specVersion');
  for (const field of ['id', 'title', 'summary', 'command', 'firstCommand', 'handoffs', 'owner', 'invocationPolicy']) {
    requireText(field);
  }
  if (declared['charter-invariants-injected'] !== true) unsatisfied.push('charter-invariants-injected');
  // Tier drives profile membership, so it must be one the profiles can admit.
  // Derived from the profiles themselves rather than restated here.
  const admissibleTiers = new Set(defaultSkillInstallProfiles.flatMap((profile) => profile.includeTiers));
  if (typeof declared.tier !== 'string' || !admissibleTiers.has(declared.tier as SkillTier)) unsatisfied.push('tier');
  // Declaring the field is the contract; declaring one that no profile accepts
  // is reported separately as no-install-profile.
  if (!Array.isArray(declared.installProfiles)) unsatisfied.push('installProfiles');
  if (!Array.isArray(declared.companionFiles)) unsatisfied.push('companionFiles');
  return unsatisfied;
}

function collectIgnoredSkillTemplatePaths(templateDirectory: string): readonly string[] {
  const ignoredPaths = new Set<string>();
  const localExcludePath = path.join(integrationsCoreRepoRoot, '.git', 'info', 'exclude');
  const localExclude = existsSync(localExcludePath) ? readFileSync(localExcludePath, 'utf8') : '';
  for (const line of localExclude.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!trimmed.includes('templates/skills')) continue;
    const normalized = trimmed.replace(/^\/+/, '').replace(/\\/g, '/');
    if (normalized.endsWith('.skill.md')) {
      ignoredPaths.add(normalized);
    }
  }
  const relativeDirectory = path.relative(integrationsCoreRepoRoot, templateDirectory).replace(/\\/g, '/');
  return [...ignoredPaths]
    .filter((entry) => entry.startsWith(relativeDirectory))
    .sort((left, right) => left.localeCompare(right));
}
