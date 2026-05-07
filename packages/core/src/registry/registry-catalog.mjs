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
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const specRepositoryRoot = path.resolve(options.specRepositoryRoot ?? repositoryRoot);
  const specCache = new Map();
  const entries = Array.isArray(registryDocument?.entries) ? [...registryDocument.entries] : [];

  return entries
    .sort((left, right) => String(left?.atomId || '').localeCompare(String(right?.atomId || '')))
    .map((entry) => {
      const specDocument = readSpecDocument(specRepositoryRoot, entry, specCache);
      const title = normalizeInlineText(specDocument?.title);
      const description = normalizeInlineText(specDocument?.description);
      return {
        atomId: String(entry?.atomId || '').trim(),
        logicalName: String(entry?.logicalName || specDocument?.logicalName || '').trim(),
        functionSummary: [title, description].filter(Boolean).join(title && description ? ': ' : ''),
        derivedCategory: deriveRegistryCatalogCategory(entry, specDocument),
        provenance: deriveGeneratorProvenance(entry),
        status: String(entry?.status || '').trim(),
        specPath: String(entry?.specPath || '').trim()
      };
    });
}

export function renderRegistryCatalogMarkdown(registryDocument, options = {}) {
  const title = String(options.title || 'Atomic Registry Catalog').trim();
  const sourceOfTruthLabel = String(options.sourceOfTruthLabel || 'atomic-registry.json').trim();
  const registryId = String(registryDocument?.registryId || 'registry.atoms').trim();
  const rows = createRegistryCatalogRows(registryDocument, options);
  const lines = [
    `# ${title}`,
    '',
    `> Projection only. Source of truth remains \`${escapeMarkdownCell(sourceOfTruthLabel)}\`.`,
    `> Generated from registry \`${escapeMarkdownCell(registryId)}\`.`,
    '',
    '| atomId | logicalName | function | derivedCategory | provenance | status | specPath |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  ];

  for (const row of rows) {
    lines.push(
      `| \`${escapeMarkdownCell(row.atomId)}\` | \`${escapeMarkdownCell(row.logicalName || '—')}\` | ${escapeMarkdownCell(row.functionSummary)} | \`${escapeMarkdownCell(row.derivedCategory)}\` | \`${escapeMarkdownCell(row.provenance)}\` | \`${escapeMarkdownCell(row.status)}\` | \`${escapeMarkdownCell(row.specPath)}\` |`
    );
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

function readSpecDocument(repositoryRoot, entry, specCache) {
  const specPath = String(entry?.specPath || '').trim();
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