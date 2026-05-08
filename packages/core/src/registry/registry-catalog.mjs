import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveRegistryCatalogCategory } from './catalog-category-deriver.mjs';

export const defaultRegistryCatalogRelativePath = 'atomic_workbench/registry-catalog.md';

export function resolveRegistryCatalogPath(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const catalogPath = options.catalogPath ?? defaultRegistryCatalogRelativePath;
  return path.isAbsolute(catalogPath)
    ? path.normalize(catalogPath)
    : path.resolve(repositoryRoot, catalogPath);
}

export function createRegistryCatalogRows(registryDocument, options = {}) {
  return createRegistryCatalogProjection(registryDocument, options).atoms;
}

export function createRegistryCatalogProjection(registryDocument, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const specRepositoryRoot = path.resolve(options.specRepositoryRoot ?? repositoryRoot);
  const specCache = new Map();
  const entries = Array.isArray(registryDocument?.entries) ? [...registryDocument.entries] : [];
  const sortedEntries = entries
    .sort((left, right) => resolveEntryId(left).localeCompare(resolveEntryId(right)))
    .map((entry) => ({
      entry,
      specDocument: readSpecDocument(specRepositoryRoot, entry, specCache)
    }));

  const atoms = [];
  const maps = [];
  for (const item of sortedEntries) {
    if (item.entry?.schemaId === 'atm.atomicMap') {
      maps.push(createMapCatalogRow(item.entry));
      continue;
    }
    atoms.push(createAtomCatalogRow(item.entry, item.specDocument));
  }

  return { atoms, maps };
}

export function renderRegistryCatalogMarkdown(registryDocument, options = {}) {
  const title = String(options.title || 'Atomic Registry Catalog').trim();
  const sourceOfTruthLabel = String(options.sourceOfTruthLabel || 'atomic-registry.json').trim();
  const registryId = String(registryDocument?.registryId || 'registry.atoms').trim();
  const projection = createRegistryCatalogProjection(registryDocument, options);
  const lines = [
    `# ${title}`,
    '',
    `> Projection only. Source of truth remains \`${escapeMarkdownCell(sourceOfTruthLabel)}\`.`,
    `> Generated from registry \`${escapeMarkdownCell(registryId)}\`.`
  ];

  if (projection.atoms.length > 0) {
    lines.push(
      '',
      '## Atoms',
      '',
      '| atomId | logicalName | function | derivedCategory | provenance | status | specPath |',
      '| --- | --- | --- | --- | --- | --- | --- |'
    );
    for (const row of projection.atoms) {
      lines.push(
        `| \`${escapeMarkdownCell(row.entryId)}\` | \`${escapeMarkdownCell(row.logicalName || '??')}\` | ${escapeMarkdownCell(row.functionSummary)} | \`${escapeMarkdownCell(row.derivedCategory)}\` | \`${escapeMarkdownCell(row.provenance)}\` | \`${escapeMarkdownCell(row.status)}\` | \`${escapeMarkdownCell(row.specPath)}\` |`
      );
    }
  }

  if (projection.maps.length > 0) {
    lines.push(
      '',
      '## Maps',
      '',
      '| mapId | memberCount | status | workbenchPath | notes |',
      '| --- | --- | --- | --- | --- |'
    );
    for (const row of projection.maps) {
      lines.push(
        `| \`${escapeMarkdownCell(row.mapId)}\` | \`${escapeMarkdownCell(String(row.memberCount))}\` | \`${escapeMarkdownCell(row.status)}\` | \`${escapeMarkdownCell(row.workbenchPath)}\` | ${escapeMarkdownCell(row.notes)} |`
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

export function writeRegistryCatalogFile(registryDocument, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const catalogPath = resolveRegistryCatalogPath({
    repositoryRoot,
    catalogPath: options.catalogPath
  });
  const markdown = renderRegistryCatalogMarkdown(registryDocument, {
    ...options,
    repositoryRoot,
    specRepositoryRoot: options.specRepositoryRoot ?? repositoryRoot
  });
  mkdirSync(path.dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, markdown, 'utf8');
  return {
    catalogPath: toProjectPath(repositoryRoot, catalogPath),
    markdown
  };
}

function createAtomCatalogRow(entry, specDocument) {
  const title = normalizeInlineText(specDocument?.title);
  const description = normalizeInlineText(specDocument?.description);
  const specPath = resolveCatalogSpecPath(entry);
  return {
    entryId: resolveEntryId(entry),
    logicalName: String(entry?.logicalName || specDocument?.logicalName || '').trim(),
    functionSummary: [title, description].filter(Boolean).join(title && description ? ': ' : '') || createFallbackFunctionSummary(entry),
    derivedCategory: deriveRegistryCatalogCategory(entry, specDocument),
    provenance: deriveGeneratorProvenance(entry),
    status: String(entry?.status || 'active').trim(),
    specPath
  };
}

function createMapCatalogRow(entry) {
  const provenance = deriveGeneratorProvenance(entry);
  return {
    mapId: String(entry?.mapId || '').trim(),
    memberCount: Array.isArray(entry?.members) ? entry.members.length : 0,
    status: String(entry?.status || 'draft').trim(),
    workbenchPath: resolveMapWorkbenchPath(entry),
    notes: [
      provenance ? `provenance: ${provenance}` : '',
      entry?.lineageLogRef ? `lineage: ${String(entry.lineageLogRef).trim()}` : ''
    ].filter(Boolean).join('; ')
  };
}

function readSpecDocument(repositoryRoot, entry, specCache) {
  const specPath = resolveCatalogSpecPath(entry);
  if (!specPath) {
    return {};
  }
  if (specCache.has(specPath)) {
    return specCache.get(specPath);
  }
  const resolvedPath = path.isAbsolute(specPath)
    ? path.normalize(specPath)
    : path.resolve(repositoryRoot, specPath);
  const document = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  specCache.set(specPath, document);
  return document;
}

function normalizeInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function deriveGeneratorProvenance(entry) {
  const marker = (entry?.evidence ?? []).find((value) => typeof value === 'string' && value.startsWith('generator-provenance:'));
  return marker ? marker.slice('generator-provenance:'.length) : 'unmarked';
}

function resolveEntryId(entry) {
  return String(entry?.atomId || entry?.mapId || '').trim();
}

function resolveCatalogSpecPath(entry) {
  const explicitSpecPath = String(entry?.location?.specPath || entry?.specPath || '').trim();
  if (explicitSpecPath) {
    return explicitSpecPath;
  }
  const mapId = String(entry?.mapId || '').trim();
  return mapId ? `atomic_workbench/maps/${mapId}/map.spec.json` : '';
}

function resolveMapWorkbenchPath(entry) {
  const explicitWorkbenchPath = String(entry?.location?.workbenchPath || '').trim();
  if (explicitWorkbenchPath) {
    return explicitWorkbenchPath;
  }
  const mapId = String(entry?.mapId || '').trim();
  return mapId ? `atomic_workbench/maps/${mapId}` : '';
}

function createFallbackFunctionSummary(entry) {
  if (entry?.schemaId !== 'atm.atomicMap') {
    return '';
  }
  const entrypoints = Array.isArray(entry?.entrypoints) ? entry.entrypoints : [];
  return entrypoints.length > 0
    ? `Atomic Map entrypoints: ${entrypoints.join(', ')}`
    : 'Atomic Map entry';
}

function escapeMarkdownCell(value) {
  return normalizeInlineText(value).replace(/\|/g, '\\|');
}

function toProjectPath(repositoryRoot, filePath) {
  const relative = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return filePath.replace(/\\/g, '/');
  }
  return relative;
}
