#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandSpecs, listCommandSpecs } from '../packages/cli/src/commands/command-specs.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commandSurfacePath = path.join(repoRoot, 'docs', 'governance', 'command-surface.md');
const defaultScanRoots = [
  path.join(repoRoot, 'docs'),
  path.join(repoRoot, 'schemas')
];
const textFileExtensions = new Set(['.json', '.md', '.mdx', '.toml', '.txt', '.yaml', '.yml']);
const commandReferencePattern = /(?<![A-Za-z0-9_.\/-])(?:node\s+)?atm(?:\.mjs)?\s+([a-z][a-z0-9-]*)\b/g;

type Mode = 'validate' | 'lint';

interface Options {
  mode: Mode;
  jsonOutput: boolean;
}

interface CommandReference {
  command: string;
  file: string;
  line: number;
  snippet: string;
}

interface Finding {
  command: string;
  locations: CommandReference[];
}

function parseArgs(argv: readonly string[]): Options {
  let mode: Mode = 'validate';
  let jsonOutput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      const value = argv[index + 1];
      if (value === 'validate' || value === 'lint') {
        mode = value;
      }
      index += 1;
      continue;
    }
    if (arg === '--json') {
      jsonOutput = true;
    }
  }

  return { mode, jsonOutput };
}

function toRepoRelative(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
}

function listTextFiles(root: string): string[] {
  const results: string[] = [];
  if (!existsSync(root)) return results;

  const walk = (directory: string) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (textFileExtensions.has(path.extname(entry.name))) {
        results.push(absolutePath);
      }
    }
  };

  walk(root);
  return results.sort((left, right) => left.localeCompare(right));
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function extractCommandReferences(filePath: string): CommandReference[] {
  const text = readFileSync(filePath, 'utf8');
  const relativePath = toRepoRelative(filePath);
  const references: CommandReference[] = [];
  commandReferencePattern.lastIndex = 0;

  for (let match = commandReferencePattern.exec(text); match; match = commandReferencePattern.exec(text)) {
    const command = match[1];
    const line = lineNumberAt(text, match.index);
    const snippet = text.split(/\r?\n/)[line - 1]?.trim() ?? '';
    references.push({ command, file: relativePath, line, snippet });
  }

  return references;
}

function groupByCommand(references: CommandReference[]): Map<string, CommandReference[]> {
  const grouped = new Map<string, CommandReference[]>();
  for (const reference of references) {
    grouped.set(reference.command, [...(grouped.get(reference.command) ?? []), reference]);
  }
  return grouped;
}

function formatLocations(locations: CommandReference[], limit = 5): string[] {
  const lines = locations.slice(0, limit).map((location) => (
    `    - ${location.file}:${location.line} ${location.snippet}`
  ));
  if (locations.length > limit) {
    lines.push(`    - ... and ${locations.length - limit} more`);
  }
  return lines;
}

function emitFindingSection(title: string, findings: Finding[]) {
  if (findings.length === 0) return;
  console.error(`  ${title}:`);
  for (const finding of findings) {
    console.error(`  - ${finding.command}`);
    for (const line of formatLocations(finding.locations)) {
      console.error(line);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = options.mode;

  if (!existsSync(commandSurfacePath)) {
    console.error(`[docs-command-drift:${mode}] missing command surface document: ${toRepoRelative(commandSurfacePath)}`);
    process.exit(1);
  }

  const allSpecCommands = new Set(Object.keys(commandSpecs));
  const publicHelpCommands = new Set(listCommandSpecs().map((spec: any) => spec.name));
  const scanFiles = defaultScanRoots.flatMap(listTextFiles);
  const docReferences = scanFiles.flatMap(extractCommandReferences);
  const commandSurfaceReferences = extractCommandReferences(commandSurfacePath);
  const groupedDocReferences = groupByCommand(docReferences);
  const groupedSurfaceReferences = groupByCommand(commandSurfaceReferences);

  const mentionedCommands = [...groupedDocReferences.keys()].sort((left, right) => left.localeCompare(right));
  const documentedSurfaceCommands = new Set(groupedSurfaceReferences.keys());

  const docsMentionedButSpecMissing = mentionedCommands
    .filter((command) => !allSpecCommands.has(command))
    .map((command) => ({ command, locations: groupedDocReferences.get(command) ?? [] }));
  const docsMentionedButHelpMissing = mentionedCommands
    .filter((command) => allSpecCommands.has(command) && !publicHelpCommands.has(command))
    .map((command) => ({ command, locations: groupedDocReferences.get(command) ?? [] }));
  const specMissingDocsEntry = [...publicHelpCommands]
    .sort((left, right) => left.localeCompare(right))
    .filter((command) => !documentedSurfaceCommands.has(command))
    .map((command) => ({ command, locations: [] }));

  const summary = {
    schemaId: 'atm.docsCommandDriftReport.v1',
    specVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    mode,
    commandSurfacePath: toRepoRelative(commandSurfacePath),
    scanRoots: defaultScanRoots.map(toRepoRelative),
    scannedFileCount: scanFiles.length,
    docsMentionedCommandCount: mentionedCommands.length,
    publicCommandCount: publicHelpCommands.size,
    docsMentionedButSpecMissing,
    docsMentionedButHelpMissing,
    specMissingDocsEntry
  };

  const violationCount = docsMentionedButSpecMissing.length + docsMentionedButHelpMissing.length + specMissingDocsEntry.length;
  if (violationCount === 0) {
    console.log(`[docs-command-drift:${mode}] ok (${publicHelpCommands.size} public commands documented; ${mentionedCommands.length} docs/schema command references checked)`);
    if (options.jsonOutput) {
      console.log(JSON.stringify(summary, null, 2));
    }
    process.exit(0);
  }

  console.error(`[docs-command-drift:${mode}] failed: ${violationCount} command-surface drift findings`);
  emitFindingSection('docs mention commands missing from commandSpecs', docsMentionedButSpecMissing);
  emitFindingSection('docs mention commands hidden from public help', docsMentionedButHelpMissing);
  if (specMissingDocsEntry.length > 0) {
    console.error('  public command specs missing docs/governance/command-surface.md entries:');
    for (const finding of specMissingDocsEntry) {
      console.error(`  - ${finding.command}`);
    }
  }
  if (options.jsonOutput) {
    console.error(JSON.stringify(summary, null, 2));
  }
  process.exit(1);
}

main();