import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { normalizeManifestPath } from '../manifest/schema.js';
export function loadExternalSkillCatalog(input) {
    const entries = [];
    const files = [];
    const skippedInvalidSources = [];
    const sourceDescriptors = [];
    const sortedSources = [...input.sources].sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100) || left.sourceId.localeCompare(right.sourceId));
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
export function federateExternalSkillCatalog(input) {
    const protectedPrefixes = input.protectedNamespacePrefixes ?? ['atm-'];
    const baseSkillIds = new Set(input.baseCatalog.entries.map((entry) => entry.id));
    const selectedExternal = new Map();
    const decisions = [];
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
    const projectedCatalog = {
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
function discoverSkillDirectories(rootDir) {
    if (!existsSync(rootDir))
        return [];
    const directSkill = path.join(rootDir, 'SKILL.md');
    if (existsSync(directSkill))
        return [rootDir];
    return readdirSync(rootDir)
        .map((entry) => path.join(rootDir, entry))
        .filter((entryPath) => statSync(entryPath).isDirectory() && existsSync(path.join(entryPath, 'SKILL.md')))
        .sort((left, right) => left.localeCompare(right));
}
function loadExternalSkillDirectory(input) {
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
        const files = [
            {
                skillId,
                relativePath: `${skillId}/SKILL.md`,
                content,
                fileFormat: toIntegrationFileFormat(input.sourceFormat),
                sourceDigest,
                managed: true
            },
            ...companionFiles.map((companion) => ({
                skillId,
                relativePath: `${skillId}/${companion.relativePath}`,
                content: companion.content,
                fileFormat: inferFileFormat(companion.relativePath),
                sourceDigest: digestBytes(companion.content),
                managed: true
            }))
        ];
        const entry = {
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
    }
    catch (error) {
        return {
            skip: {
                sourceId: input.source.sourceId,
                relativePath: `${relativeSkillDir}/SKILL.md`,
                reason: error instanceof Error ? error.message : 'unreadable skill'
            }
        };
    }
}
function parseSimpleFrontmatter(content) {
    if (!content.startsWith('---'))
        return {};
    const end = content.indexOf('\n---', 3);
    if (end < 0)
        return {};
    const record = {};
    let currentArrayKey = null;
    for (const rawLine of content.slice(3, end).split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        const arrayItem = line.match(/^\s*-\s+(.+)$/);
        if (arrayItem && currentArrayKey) {
            const current = Array.isArray(record[currentArrayKey]) ? record[currentArrayKey] : [];
            record[currentArrayKey] = [...current, unquote(arrayItem[1] ?? '')];
            continue;
        }
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!match)
            continue;
        const key = match[1] ?? '';
        const value = match[2] ?? '';
        if (value === '') {
            record[key] = [];
            currentArrayKey = key;
        }
        else {
            record[key] = unquote(value);
            currentArrayKey = null;
        }
    }
    return record;
}
function listCompanionFiles(skillDir) {
    const result = [];
    const visit = (directory) => {
        for (const entry of readdirSync(directory)) {
            const absolutePath = path.join(directory, entry);
            if (absolutePath === path.join(skillDir, 'SKILL.md'))
                continue;
            const stats = statSync(absolutePath);
            if (stats.isDirectory()) {
                visit(absolutePath);
            }
            else {
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
function parseTier(value, fallback) {
    return value === 'entry' || value === 'specialist' || value === 'emergency' ? value : fallback;
}
function parseInstallProfiles(value, fallback) {
    if (!Array.isArray(value))
        return fallback;
    return value.filter((item) => item === 'adopter-bootstrap' || item === 'framework-full' || item === 'role-oriented' || item === 'emergency-explicit');
}
function parseInvocationPolicy(value, fallback) {
    return value === 'model-or-user' || value === 'explicit-user' || value === 'router-only' || value === 'emergency-only'
        ? value
        : fallback;
}
function parseCapabilityRequirements(value) {
    return Array.isArray(value) ? value.filter((item) => Boolean(item)) : [];
}
function normalizeSkillId(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
function normalizeRelativePath(candidatePath) {
    if (!candidatePath || candidatePath === '.')
        return '';
    return normalizeManifestPath(candidatePath);
}
function toIntegrationFileFormat(format) {
    return format === 'markdown-skill-directory' ? 'markdown' : 'skill';
}
function inferFileFormat(relativePath) {
    return relativePath.endsWith('.toml') ? 'toml' : relativePath.endsWith('.yaml') || relativePath.endsWith('.yml') ? 'yaml' : 'markdown';
}
function unquote(value) {
    return value.replace(/^['"]|['"]$/g, '');
}
function digestText(value) {
    return digestBytes(Buffer.from(value, 'utf8'));
}
function digestBytes(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function digestStableJson(value) {
    return digestText(JSON.stringify(value));
}
