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
import { getSkillInstallProfile, skillBelongsToProfile } from '../distribution/install-profile.js';
// Private: repo root is 4 levels above packages/integrations-core/src/compiler/
const integrationsCoreRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const defaultSkillTemplateDirectory = path.join(integrationsCoreRepoRoot, 'templates', 'skills');
export function createSkillDefinitionVNext(input) {
    const capabilities = [...new Set(input.capabilities.map((value) => value.trim()).filter(Boolean))].sort();
    const atmContractVersions = [...new Set(input.atmContractVersions.map((value) => value.trim()).filter(Boolean))].sort();
    const defaultInvocationModes = ['model', 'user', 'router'];
    const invocationModes = [...new Set(input.invocationModes ?? defaultInvocationModes)];
    if (capabilities.length === 0)
        throw new Error('skill definition requires at least one capability');
    if (atmContractVersions.length === 0)
        throw new Error('skill definition requires an ATM contract version');
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
function normalizeDisclosureReferences(references) {
    if (!references)
        return undefined;
    return [...references]
        .map((reference) => ({ ...reference, id: reference.id.trim(), path: reference.path.trim(), purpose: reference.purpose.trim() }))
        .filter((reference) => reference.id && reference.path && reference.purpose)
        .sort((left, right) => left.id.localeCompare(right.id));
}
function normalizeCompletionCriteria(criteria) {
    if (!criteria)
        return undefined;
    return [...criteria]
        .map((criterion) => ({ ...criterion, id: criterion.id.trim(), validator: criterion.validator.trim() }))
        .filter((criterion) => criterion.id && criterion.validator)
        .sort((left, right) => left.id.localeCompare(right.id));
}
export function projectSkillDefinition(template, manifest) {
    return {
        ...createSkillDefinitionVNext(manifest),
        skillId: template.frontmatter.id,
        legacyReadable: true
    };
}
export const minimumAtmEntrySkillDefinitions = loadSkillTemplatesForProfile('adopter-bootstrap').map((template) => ({
    id: template.frontmatter.id,
    title: template.frontmatter.title,
    summary: template.frontmatter.summary,
    command: template.frontmatter.command
}));
/**
 * Section marker that carries the ATM-only execution route warning into the
 * canonical entry skills. The policy itself lives in the core
 * RestrictedExecutionGateway; templates only project it, and the projection is
 * required so a compiled skill cannot silently drop the warning.
 */ export const atmOnlyExecutionRouteSectionMarker = 'ATM-Only Execution Route';
export const atmOnlyExecutionRouteTemplateIds = [
    'atm-governance-router',
    'atm-dispatch',
    'atm-next'
];
export function assertAtmOnlyExecutionRouteProjection(templates) {
    const templatesById = new Map(templates.map((template) => [template.frontmatter.id, template]));
    for (const templateId of atmOnlyExecutionRouteTemplateIds) {
        const template = templatesById.get(templateId);
        if (!template)
            continue;
        if (!template.body.includes(atmOnlyExecutionRouteSectionMarker)) {
            throw new Error(`skill template ${templateId} must project the ${atmOnlyExecutionRouteSectionMarker} section`);
        }
    }
}
export function parseSkillTemplate(content, sourcePath = '<inline>') {
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
export function loadSkillTemplates(templateDirectory = defaultSkillTemplateDirectory) {
    return readdirSync(templateDirectory)
        .filter((entryName) => entryName.endsWith('.skill.md'))
        .sort((left, right) => left.localeCompare(right))
        .map((entryName) => {
        const templatePath = path.join(templateDirectory, entryName);
        return parseSkillTemplate(readFileSync(templatePath, 'utf8'), path.relative(integrationsCoreRepoRoot, templatePath).replace(/\\/g, '/'));
    });
}
export function loadMinimumAtmSkillTemplates(templateDirectory = defaultSkillTemplateDirectory) {
    const loaded = loadSkillTemplatesForProfile('adopter-bootstrap', templateDirectory);
    assertAtmOnlyExecutionRouteProjection(loaded);
    return loaded;
}
export function loadSkillTemplatesForProfile(profileId, templateDirectory = defaultSkillTemplateDirectory) {
    const profile = getSkillInstallProfile(profileId);
    return loadSkillTemplates(templateDirectory)
        .filter((template) => skillBelongsToProfile({
        skillId: template.frontmatter.id,
        tier: template.frontmatter.tier,
        installProfiles: template.frontmatter.installProfiles,
        profile
    }));
}
export function loadSkillCorpusSourceSnapshot(templateDirectory = defaultSkillTemplateDirectory) {
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
export function compileSkillCorpus(input) {
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
function parseSkillTemplateFrontmatter(frontmatterSource, sourcePath) {
    const frontmatter = {};
    let activeArrayKey = null;
    for (const rawLine of frontmatterSource.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0)
            continue;
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
    frontmatter.adapterCapabilityRequirements = parseAdapterCapabilityRequirements(frontmatter.adapterCapabilityRequirements, sourcePath);
    return frontmatter;
}
function parseFrontmatterValue(value) {
    if (value.startsWith('[') && value.endsWith(']')) {
        const body = value.slice(1, -1).trim();
        if (!body)
            return [];
        return body.split(',').map((entry) => String(parseFrontmatterScalar(entry.trim())));
    }
    return parseFrontmatterScalar(value);
}
function parseFrontmatterScalar(value) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return value.replace(/^['"]|['"]$/g, '');
}
function parseAdapterCapabilityRequirements(value, sourcePath) {
    if (!Array.isArray(value))
        return [];
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
function sha256Text(content) {
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}
function collectIgnoredSkillTemplatePaths(templateDirectory) {
    const ignoredPaths = new Set();
    const localExcludePath = path.join(integrationsCoreRepoRoot, '.git', 'info', 'exclude');
    const localExclude = existsSync(localExcludePath) ? readFileSync(localExcludePath, 'utf8') : '';
    for (const line of localExclude.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        if (!trimmed.includes('templates/skills'))
            continue;
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
