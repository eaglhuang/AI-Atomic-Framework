import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveRegistryCatalogCategory } from './catalog-category-deriver.ts';

export const defaultRegistryCatalogRelativePath = 'atomic_workbench/registry-catalog.md';

// ─── Domain types ──────────────────────────────────────────────────────────

interface CatalogOptions {
  repositoryRoot?: string;
  catalogPath?: string;
  specRepositoryRoot?: string;
  title?: string;
  sourceOfTruthLabel?: string;
}

interface RegistryEntry {
  schemaId?: string;
  atomId?: string;
  mapId?: string;
  logicalName?: string;
  status?: string;
  evidence?: string[];
  location?: {
    specPath?: string;
    workbenchPath?: string;
  };
  specPath?: string;
  members?: unknown[];
  entrypoints?: string[];
  lineageLogRef?: string;
}

interface SpecDocument {
  title?: string;
  description?: string;
  logicalName?: string;
}

interface AtomCatalogRow {
  entryId: string;
  logicalName: string;
  functionSummary: string;
  derivedCategory: string;
  provenance: string;
  status: string;
  specPath: string;
}

interface MapCatalogRow {
  mapId: string;
  memberCount: number;
  status: string;
  workbenchPath: string;
  notes: string;
}

interface RegistryDocument {
  entries?: RegistryEntry[];
  registryId?: string;
}

export function resolveRegistryCatalogPath(options: CatalogOptions = {}): string {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const catalogPath = options.catalogPath ?? defaultRegistryCatalogRelativePath;
  return path.isAbsolute(catalogPath)
    ? path.normalize(catalogPath)
    : path.resolve(repositoryRoot, catalogPath);
}

export function createRegistryCatalogRows(registryDocument: RegistryDocument | null | undefined, options: CatalogOptions = {}): AtomCatalogRow[] {
  return createRegistryCatalogProjection(registryDocument, options).atoms;
}

export function createRegistryCatalogProjection(registryDocument: RegistryDocument | null | undefined, options: CatalogOptions = {}): { atoms: AtomCatalogRow[]; maps: MapCatalogRow[] } {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const specRepositoryRoot = path.resolve(options.specRepositoryRoot ?? repositoryRoot);
  const specCache = new Map<string, SpecDocument>();
  const entries = Array.isArray(registryDocument?.entries) ? [...registryDocument!.entries!] : [];
  const sortedEntries = entries
    .sort((left, right) => resolveEntryId(left).localeCompare(resolveEntryId(right)))
    .map((entry) => ({
      entry,
      specDocument: readSpecDocument(specRepositoryRoot, entry, specCache)
    }));

  const atoms: AtomCatalogRow[] = [];
  const maps: MapCatalogRow[] = [];
  for (const item of sortedEntries) {
    if (item.entry?.schemaId === 'atm.atomicMap') {
      maps.push(createMapCatalogRow(item.entry));
      continue;
    }
    atoms.push(createAtomCatalogRow(item.entry, item.specDocument));
  }

  return { atoms, maps };
}

export function renderRegistryCatalogMarkdown(registryDocument: RegistryDocument | null | undefined, options: CatalogOptions = {}): string {
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

export function writeRegistryCatalogFile(registryDocument: RegistryDocument | null | undefined, options: CatalogOptions = {}): { catalogPath: string; markdown: string } {
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

function createAtomCatalogRow(entry: RegistryEntry, specDocument: SpecDocument): AtomCatalogRow {
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

function createMapCatalogRow(entry: RegistryEntry): MapCatalogRow {
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

function readSpecDocument(repositoryRoot: string, entry: RegistryEntry, specCache: Map<string, SpecDocument>): SpecDocument {
  const specPath = resolveCatalogSpecPath(entry);
  if (!specPath) {
    return {};
  }
  if (specCache.has(specPath)) {
    return specCache.get(specPath)!;
  }
  const resolvedPath = path.isAbsolute(specPath)
    ? path.normalize(specPath)
    : path.resolve(repositoryRoot, specPath);
  try {
    const document = JSON.parse(readFileSync(resolvedPath, 'utf8')) as SpecDocument;
    specCache.set(specPath, document);
    return document;
  } catch {
    return {};
  }
}

function normalizeInlineText(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function deriveGeneratorProvenance(entry: RegistryEntry): string {
  const marker = (entry?.evidence ?? []).find((value) => typeof value === 'string' && value.startsWith('generator-provenance:'));
  return marker ? String(marker).slice('generator-provenance:'.length) : 'unmarked';
}

function resolveEntryId(entry: RegistryEntry): string {
  return String(entry?.atomId || entry?.mapId || '').trim();
}

function resolveCatalogSpecPath(entry: RegistryEntry): string {
  const explicitSpecPath = String(entry?.location?.specPath || entry?.specPath || '').trim();
  if (explicitSpecPath) {
    return explicitSpecPath;
  }
  const mapId = String(entry?.mapId || '').trim();
  return mapId ? `atomic_workbench/maps/${mapId}/map.spec.json` : '';
}

function resolveMapWorkbenchPath(entry: RegistryEntry): string {
  const explicitWorkbenchPath = String(entry?.location?.workbenchPath || '').trim();
  if (explicitWorkbenchPath) {
    return explicitWorkbenchPath;
  }
  const mapId = String(entry?.mapId || '').trim();
  return mapId ? `atomic_workbench/maps/${mapId}` : '';
}

function createFallbackFunctionSummary(entry: RegistryEntry): string {
  if (entry?.schemaId !== 'atm.atomicMap') {
    return '';
  }
  const entrypoints = Array.isArray(entry?.entrypoints) ? entry.entrypoints : [];
  return entrypoints.length > 0
    ? `Atomic Map entrypoints: ${entrypoints.join(', ')}`
    : 'Atomic Map entry';
}

function escapeMarkdownCell(value: string): string {
  return normalizeInlineText(value).replace(/\|/g, '\\|');
}

function toProjectPath(repositoryRoot: string, filePath: string): string {
  const relative = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return filePath.replace(/\\/g, '/');
  }
  return relative;
}
