#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ErrorCodeOccurrence {
  readonly code: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly context: string;
}

interface ErrorCodeRegistry {
  readonly schemaId: 'atm.errorCodeRegistry.v1';
  readonly specVersion: '0.1.0';
  readonly entries: readonly ErrorCodeRegistryEntry[];
  readonly prefixRules?: readonly ErrorCodePrefixRule[];
}

interface ErrorCodeRegistryEntry {
  readonly code: string;
  readonly category: string;
  readonly shortDescription: string;
  readonly commonCauses: readonly string[];
  readonly remediation: readonly string[];
  readonly retryable: boolean;
  readonly requiresHumanApproval: boolean;
  readonly relatedCommands: readonly string[];
  readonly sourceOwner: string;
}

interface ErrorCodePrefixRule {
  readonly prefix: string;
  readonly category: string;
  readonly shortDescription: string;
  readonly remediation: readonly string[];
  readonly retryable: boolean;
  readonly requiresHumanApproval: boolean;
  readonly relatedCommands: readonly string[];
  readonly sourceOwner: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['packages', 'scripts', 'tests', 'examples'].map((entry) => path.join(root, entry));
const outputPath = path.join(root, 'docs', 'ERROR_CODES.md');
const registryPath = path.join(root, 'docs', 'governance', 'error-code-registry.json');
const codePattern = /\bATM_[A-Z0-9_]+\b/g;
const ignoredDirectoryNames = new Set(['dist', 'node_modules', '.git', '.atm-temp', 'temp', 'release', 'coverage']);

const occurrences = new Map<string, ErrorCodeOccurrence>();

for (const sourceRoot of sourceRoots) {
  for (const filePath of walk(sourceRoot)) {
    if (!filePath.endsWith('.ts')) {
      continue;
    }

    const text = readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      codePattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = codePattern.exec(line)) !== null) {
        if (!occurrences.has(match[0])) {
          occurrences.set(match[0], {
            code: match[0],
            filePath: path.relative(root, filePath).replace(/\\/g, '/'),
            lineNumber: index + 1,
            context: trimContext(line)
          });
        }
      }
    }
  }
}

if (occurrences.size === 0) {
  throw new Error('no ATM_* error codes found in source tree');
}

const registry = readRegistry(registryPath);
const registryByCode = new Map(registry.entries.map((entry) => [entry.code, entry]));
const prefixRules = (registry.prefixRules ?? [])
  .slice()
  .sort((left, right) => right.prefix.length - left.prefix.length || left.prefix.localeCompare(right.prefix));
const missingRegistryCodes = [...occurrences.keys()]
  .filter((code) => !registryByCode.has(code) && !findPrefixRule(code, prefixRules))
  .sort((left, right) => left.localeCompare(right));
const prefixDocumentedCodes = [...occurrences.keys()]
  .filter((code) => !registryByCode.has(code) && Boolean(findPrefixRule(code, prefixRules)))
  .sort((left, right) => left.localeCompare(right));

for (const entry of registry.entries) {
  if (!occurrences.has(entry.code)) {
    throw new Error(`registered ATM error code is not present in source scan: ${entry.code}`);
  }
}

const registryRows = registry.entries
  .slice()
  .sort((left, right) => left.code.localeCompare(right.code))
  .map((entry) => [
    `| \`${escapeTableCell(entry.code)}\``,
    escapeTableCell(entry.category),
    escapeTableCell(entry.shortDescription),
    entry.retryable ? 'yes' : 'no',
    entry.requiresHumanApproval ? 'yes' : 'no',
    escapeTableCell(formatList(entry.remediation)),
    `\`${escapeTableCell(entry.sourceOwner)}\` |`
  ].join(' | '));

const prefixRuleRows = prefixRules
  .map((rule) => [
    `| \`${escapeTableCell(rule.prefix)}*\``,
    escapeTableCell(rule.category),
    escapeTableCell(rule.shortDescription),
    rule.retryable ? 'yes' : 'no',
    rule.requiresHumanApproval ? 'yes' : 'no',
    escapeTableCell(formatList(rule.remediation)),
    `\`${escapeTableCell(rule.sourceOwner)}\` |`
  ].join(' | '));

const rows = [...occurrences.values()]
  .sort((left, right) => left.code.localeCompare(right.code))
  .map((occurrence) => {
    const location = `${occurrence.filePath}:${occurrence.lineNumber}`;
    const registryStatus = registryByCode.has(occurrence.code)
      ? 'exact-documented'
      : findPrefixRule(occurrence.code, prefixRules)
        ? 'prefix-documented'
        : 'registry-missing';
    return `| \`${escapeTableCell(occurrence.code)}\` | ${registryStatus} | \`${escapeTableCell(location)}\` | ${escapeTableCell(occurrence.context)} |`;
  });

const markdown = [
  '# ATM Error Codes',
  '',
  'Generated from `packages/`, `scripts/`, `tests`, and `examples` TypeScript sources plus `docs/governance/error-code-registry.json`.',
  '',
  'Regenerate with `npm run generate:error-codes`.',
  '',
  '## Operator Registry',
  '',
  'Curated entries provide the shared operator-facing meaning and recovery path used by ATM skills. Source-scanned codes that are not yet curated appear as `registry-missing` in the source index.',
  '',
  '| Code | Category | Description | Retryable | Human Approval | Remediation | Source Owner |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...registryRows,
  '',
  '## Prefix Recovery Rules',
  '',
  'Prefix rules are canonical fallback guidance for source-scanned ATM codes that do not yet have an exact curated entry. Exact entries always win. A code is `registry-missing` only when neither an exact entry nor a prefix rule covers it.',
  '',
  '| Prefix | Category | Description | Retryable | Human Approval | Remediation | Source Owner |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...prefixRuleRows,
  '',
  '## Registry Coverage',
  '',
  `- Source-scanned ATM codes: ${occurrences.size}`,
  `- Exact curated registry entries: ${registry.entries.length}`,
  `- Prefix-documented source codes: ${prefixDocumentedCodes.length}`,
  `- Registry-missing source codes: ${missingRegistryCodes.length}`,
  '',
  'When a user-visible code is `registry-missing`, add or update one exact entry or prefix rule in `docs/governance/error-code-registry.json`, then rerun `npm run generate:error-codes`.',
  '',
  '## Source Index',
  '',
  '| Code | Registry Status | Location | Context |',
  '| --- | --- | --- | --- |',
  ...rows,
  ''
].join('\n');

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, markdown, 'utf8');
console.log(`[generate-error-code-index] wrote ${path.relative(root, outputPath)} (${occurrences.size} codes)`);

function readRegistry(filePath: string): ErrorCodeRegistry {
  if (!existsSync(filePath)) {
    return {
      schemaId: 'atm.errorCodeRegistry.v1',
      specVersion: '0.1.0',
      entries: [],
      prefixRules: []
    };
  }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ErrorCodeRegistry;
  if (parsed.schemaId !== 'atm.errorCodeRegistry.v1' || parsed.specVersion !== '0.1.0' || !Array.isArray(parsed.entries)) {
    throw new Error(`invalid error-code registry: ${path.relative(root, filePath)}`);
  }
  const seen = new Set<string>();
  for (const entry of parsed.entries) {
    validateRegistryEntry(entry);
    if (seen.has(entry.code)) {
      throw new Error(`duplicate error-code registry entry: ${entry.code}`);
    }
    seen.add(entry.code);
  }
  for (const rule of parsed.prefixRules ?? []) {
    validatePrefixRule(rule);
  }
  return parsed;
}

function validateRegistryEntry(entry: ErrorCodeRegistryEntry) {
  const requiredStrings: readonly (keyof ErrorCodeRegistryEntry)[] = ['code', 'category', 'shortDescription', 'sourceOwner'];
  for (const key of requiredStrings) {
    if (typeof entry[key] !== 'string' || String(entry[key]).trim().length === 0) {
      throw new Error(`error-code registry entry has invalid ${key}: ${JSON.stringify(entry)}`);
    }
  }
  if (!/^ATM_[A-Z0-9_]+$/.test(entry.code)) {
    throw new Error(`invalid ATM error code in registry: ${entry.code}`);
  }
  for (const key of ['commonCauses', 'remediation', 'relatedCommands'] as const) {
    if (!Array.isArray(entry[key]) || entry[key].length === 0 || entry[key].some((value) => typeof value !== 'string' || value.trim().length === 0)) {
      throw new Error(`error-code registry entry ${entry.code} has invalid ${key}`);
    }
  }
  if (typeof entry.retryable !== 'boolean' || typeof entry.requiresHumanApproval !== 'boolean') {
    throw new Error(`error-code registry entry ${entry.code} has invalid boolean fields`);
  }
}

function validatePrefixRule(rule: ErrorCodePrefixRule) {
  const requiredStrings: readonly (keyof ErrorCodePrefixRule)[] = ['prefix', 'category', 'shortDescription', 'sourceOwner'];
  for (const key of requiredStrings) {
    if (typeof rule[key] !== 'string' || String(rule[key]).trim().length === 0) {
      throw new Error(`error-code prefix rule has invalid ${key}: ${JSON.stringify(rule)}`);
    }
  }
  if (!/^ATM_[A-Z0-9_]*$/.test(rule.prefix)) {
    throw new Error(`invalid ATM error code prefix rule: ${rule.prefix}`);
  }
  for (const key of ['remediation', 'relatedCommands'] as const) {
    if (!Array.isArray(rule[key]) || rule[key].length === 0 || rule[key].some((value) => typeof value !== 'string' || value.trim().length === 0)) {
      throw new Error(`error-code prefix rule ${rule.prefix} has invalid ${key}`);
    }
  }
  if (typeof rule.retryable !== 'boolean' || typeof rule.requiresHumanApproval !== 'boolean') {
    throw new Error(`error-code prefix rule ${rule.prefix} has invalid boolean fields`);
  }
}

function findPrefixRule(code: string, rules: readonly ErrorCodePrefixRule[]): ErrorCodePrefixRule | null {
  return rules.find((rule) => code.startsWith(rule.prefix)) ?? null;
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const results: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }
      results.push(...walk(entryPath));
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

function trimContext(line: string): string {
  return line.trim();
}

function formatList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join('<br>');
}

function escapeTableCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/\|/g, '&#124;')
    .replace(/`/g, '&#96;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
