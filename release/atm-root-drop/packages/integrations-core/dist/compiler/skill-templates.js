/**
 * compiler/skill-templates.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * ATM skill template parser, loader, and minimum entry skill definitions.
 * No dependencies on manifest or verify submodules.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { collectSkillSourceUniverseFindings, defaultSkillTemplateDirectory, integrationsCoreRepoRoot, sha256Text } from './skill-source-universe.js';
import { defaultSkillInstallProfiles, getSkillInstallProfile, skillBelongsToProfile } from '../distribution/install-profile.js';
// The source root, its digest helper, and the sealed tracking universe live in
// skill-source-universe.ts. They are re-exported here so the compiler's public
// surface keeps its original shape.
export { defaultSkillTemplateDirectory, sealSkillSourceUniverse, collectSkillSourceUniverseFindings } from './skill-source-universe.js';
export { evaluateInstalledProjectionParity, collectProjectionMetadataFindings, resolveTargetedSkillProjectionRefresh } from './skill-projection-parity.js';
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
export function loadSkillCorpusSourceSnapshot(templateDirectory = defaultSkillTemplateDirectory, options = {}) {
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
    const universe = options.sourceUniverse ?? null;
    const findings = universe ? collectSkillSourceUniverseFindings(universe) : [];
    return {
        schemaId: 'atm.skillCorpusSourceSnapshot.v1',
        compilerVersion: '0.1.0',
        generatedAt: new Date(0).toISOString(),
        sourceRoot: path.relative(integrationsCoreRepoRoot, templateDirectory).replace(/\\/g, '/'),
        templateCount: templates.length,
        templates,
        sourceFiles,
        sourceDigest,
        sourceUniverseSealed: universe !== null,
        sourceUniverseDigest: universe?.universeDigest ?? null,
        sourceUniverseFindings: findings,
        untrackedSourceTemplatePaths: findings.filter((finding) => finding.trackingState === 'untracked').map((finding) => finding.sourcePath),
        ignoredSourceTemplatePaths: findings.filter((finding) => finding.trackingState === 'ignored').map((finding) => finding.sourcePath)
    };
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
export function collectSkillCorpusDiscoveryFindings(templateDirectory = defaultSkillTemplateDirectory) {
    const findings = [];
    for (const entryName of readdirSync(templateDirectory).filter((entry) => entry.endsWith('.skill.md')).sort()) {
        const templatePath = path.join(templateDirectory, entryName);
        const sourcePath = path.relative(integrationsCoreRepoRoot, templatePath).replace(/\\/g, '/');
        let template;
        try {
            template = parseSkillTemplate(readFileSync(templatePath, 'utf8'), sourcePath);
        }
        catch (error) {
            findings.push({
                sourcePath,
                reason: 'unparsable-frontmatter',
                missingFields: [],
                recovery: `Repair the frontmatter block so it parses as an ${skillTemplateSchemaId} template: ${error.message}`
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
export function compileSkillCorpus(input) {
    // Fail closed before any adapter work: a corpus whose source universe still
    // holds an untracked or ignored formal template is not a corpus anyone else
    // can reproduce, so it must not reach a projection at all.
    const universeFindings = input.sourceSnapshot.sourceUniverseFindings;
    if (universeFindings.length > 0) {
        throw new Error(`sealed source universe rejects this corpus: ${universeFindings
            .map((finding) => `${finding.sourcePath} is ${finding.trackingState} — ${finding.recovery}`)
            .join('; ')}`);
    }
    const files = input.adapterDescriptor.project({
        adapterId: input.adapterDescriptor.adapterId,
        templates: input.sourceSnapshot.templates,
        sourceSnapshot: input.sourceSnapshot
    });
    const degradationDiagnostics = [...(input.adapterDescriptor.diagnostics ?? [])].sort();
    const computedManifestDigest = sha256Text(JSON.stringify(files));
    const declaredManifestDigest = input.adapterDescriptor.manifestDigest;
    // A declared digest is a claim about the compiled files, so it is checked
    // rather than republished. Otherwise a stale manifest could travel forward
    // attached to output it no longer describes.
    if (declaredManifestDigest && declaredManifestDigest !== computedManifestDigest) {
        throw new Error(`adapter ${input.adapterDescriptor.adapterId} declared manifest digest ${declaredManifestDigest} but the compiled files digest to ${computedManifestDigest}`);
    }
    return {
        schemaId: 'atm.skillCorpusProjection.v1',
        compilerVersion: input.sourceSnapshot.compilerVersion,
        adapterId: input.adapterDescriptor.adapterId,
        sourceDigest: input.sourceSnapshot.sourceDigest,
        sourceUniverseDigest: input.sourceSnapshot.sourceUniverseDigest,
        manifestDigest: computedManifestDigest,
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
const skillTemplateSchemaId = 'atm.skillTemplate';
const skillTemplateSpecVersion = '0.1.0';
function collectUnsatisfiedContractFields(frontmatter) {
    const declared = frontmatter;
    const unsatisfied = [];
    const requireText = (field) => {
        const value = declared[field];
        if (typeof value !== 'string' || value.trim().length === 0)
            unsatisfied.push(field);
    };
    if (declared.schemaId !== skillTemplateSchemaId)
        unsatisfied.push('schemaId');
    if (declared.specVersion !== skillTemplateSpecVersion)
        unsatisfied.push('specVersion');
    for (const field of ['id', 'title', 'summary', 'command', 'firstCommand', 'handoffs', 'owner', 'invocationPolicy']) {
        requireText(field);
    }
    if (declared['charter-invariants-injected'] !== true)
        unsatisfied.push('charter-invariants-injected');
    // Tier drives profile membership, so it must be one the profiles can admit.
    // Derived from the profiles themselves rather than restated here.
    const admissibleTiers = new Set(defaultSkillInstallProfiles.flatMap((profile) => profile.includeTiers));
    if (typeof declared.tier !== 'string' || !admissibleTiers.has(declared.tier))
        unsatisfied.push('tier');
    // Declaring the field is the contract; declaring one that no profile accepts
    // is reported separately as no-install-profile.
    if (!Array.isArray(declared.installProfiles))
        unsatisfied.push('installProfiles');
    if (!Array.isArray(declared.companionFiles))
        unsatisfied.push('companionFiles');
    return unsatisfied;
}
