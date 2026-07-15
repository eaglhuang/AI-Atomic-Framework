import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ATM_BACKLOG_PROJECTION_PATH = 'docs/governance/atm-bug-and-optimization-backlog.md';
export const ATM_BACKLOG_ITEMS_DIR = 'docs/governance/atm-bug-and-optimization-backlog.items';
export const ATM_BACKLOG_GENERATED_MARKER = '<!-- ATM-GENERATED-BACKLOG-PROJECTION: items-dir=docs/governance/atm-bug-and-optimization-backlog.items -->';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface GovernanceBacklogItem {
  readonly schemaId: 'atm.governanceBacklogItem.v1';
  readonly id: string;
  readonly date: string;
  readonly repo: string;
  readonly type: string;
  readonly severity: string;
  readonly status: string;
  readonly area: string;
  readonly finding: string;
  readonly expectedBehavior: string;
  readonly evidenceOrRepro: string;
  readonly followUp: string;
}

const tableHeader = '| ID | Date | Repo | Type | Severity | Status | Area | Finding | Expected behavior | Evidence / Repro | Follow-up |';
const tableDivider = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const mandatoryGlobalInventory = [
  {
    path: 'docs/governance/atm-bug-and-optimization-backlog.md',
    kind: 'generated-projection',
    owner: 'atm.governance-backlog',
    authoringRule: 'Write item files under docs/governance/atm-bug-and-optimization-backlog.items; rebuild this projection.'
  },
  {
    path: 'atomic_workbench/atomization-coverage/path-to-atom-map.json',
    kind: 'generated-projection',
    owner: 'atm.atom-map',
    authoringRule: 'Write owner shard files under atomic_workbench/atomization-coverage/path-to-atom-map-shards; rebuild the projection.'
  },
  {
    path: 'docs/governance/team-agents/cross-vendor-handoff-ledger.md',
    kind: 'generated-projection',
    owner: 'atm.team-vendor-handoff',
    authoringRule: 'Write canonical JSON records; regenerate the Markdown projection.'
  },
  {
    path: '.atm/history/tasks/*.json',
    kind: 'ledger-records',
    owner: 'atm.task-ledger',
    authoringRule: 'Use ATM CLI lifecycle commands; do not edit runtime ledger records by hand.'
  },
  {
    path: '.atm/runtime/locks/*.json',
    kind: 'runtime-locks',
    owner: 'atm.lock-runtime',
    authoringRule: 'Use ATM claim, release, repair, and broker commands.'
  }
] as const;

export function parseBacklogItemsFromProjection(markdown: string): GovernanceBacklogItem[] {
  const rows = markdown.split(/\r?\n/);
  const headerIndex = rows.findIndex((line) => line.trim() === tableHeader);
  if (headerIndex < 0) return [];
  const items: GovernanceBacklogItem[] = [];
  for (const line of rows.slice(headerIndex + 2)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length !== 10 && cells.length !== 11) continue;
    const [id, date, repo, type, severity, statusOrArea, areaOrFinding, findingOrExpected, expectedOrEvidence, evidenceOrFollowUp, maybeFollowUp] = cells;
    if (!/^ATM-BUG-\d{4}-\d{2}-\d{2}-\d{2,3}$/.test(id)) continue;
    const legacyMissingStatus = cells.length === 10;
    items.push({
      schemaId: 'atm.governanceBacklogItem.v1',
      id,
      date,
      repo,
      type,
      severity,
      status: legacyMissingStatus ? 'Open' : statusOrArea,
      area: legacyMissingStatus ? statusOrArea : areaOrFinding,
      finding: legacyMissingStatus ? areaOrFinding : findingOrExpected,
      expectedBehavior: legacyMissingStatus ? findingOrExpected : expectedOrEvidence,
      evidenceOrRepro: legacyMissingStatus ? expectedOrEvidence : evidenceOrFollowUp,
      followUp: legacyMissingStatus ? evidenceOrFollowUp : maybeFollowUp ?? ''
    });
  }
  return items;
}

export function renderBacklogProjection(prefixMarkdown: string, items: readonly GovernanceBacklogItem[]): string {
  const prefix = extractProjectionPrefix(prefixMarkdown).replace(/\s+$/u, '');
  const inventoryLines = [
    '## Mandatory Global Hotfile Inventory',
    '',
    '| Path | Kind | Owner | Authoring rule |',
    '| --- | --- | --- | --- |',
    ...mandatoryGlobalInventory.map((item) => `| ${item.path} | ${item.kind} | ${item.owner} | ${item.authoringRule} |`)
  ];
  const tableLines = [
    '## Generated Backlog Projection',
    '',
    ATM_BACKLOG_GENERATED_MARKER,
    '',
    tableHeader,
    tableDivider,
    ...sortItems(items).map(renderBacklogRow)
  ];
  return `${prefix}\n\n${inventoryLines.join('\n')}\n\n${tableLines.join('\n')}\n`;
}

export function validateGovernanceProjections(repoRoot: string): { ok: boolean; errors: string[]; itemCount: number } {
  const errors: string[] = [];
  const projectionPath = path.join(repoRoot, ATM_BACKLOG_PROJECTION_PATH);
  const itemsDir = path.join(repoRoot, ATM_BACKLOG_ITEMS_DIR);
  if (!existsSync(projectionPath)) errors.push(`missing projection: ${ATM_BACKLOG_PROJECTION_PATH}`);
  if (!existsSync(itemsDir)) errors.push(`missing item directory: ${ATM_BACKLOG_ITEMS_DIR}`);
  if (errors.length > 0) return { ok: false, errors, itemCount: 0 };

  const items = readBacklogItems(itemsDir, errors);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) errors.push(`duplicate backlog item id: ${item.id}`);
    ids.add(item.id);
  }
  const projection = readFileSync(projectionPath, 'utf8');
  if (!projection.includes(ATM_BACKLOG_GENERATED_MARKER)) {
    errors.push('projection is missing generated marker');
  }
  const beforeGeneratedTable = projection.split(ATM_BACKLOG_GENERATED_MARKER)[0] ?? projection;
  const legacyIds = [...beforeGeneratedTable.matchAll(/\|\s*(ATM-BUG-\d{4}-\d{2}-\d{2}-\d{2,3})\s*\|/g)].map((match) => match[1]);
  if (legacyIds.length > 0) {
    errors.push(`projection contains ${legacyIds.length} backlog row(s) before generated marker`);
  }
  const prefix = extractProjectionPrefix(projection);
  const expected = renderBacklogProjection(prefix, items);
  if (projection !== expected) {
    errors.push(`projection is stale; run node --strip-types scripts/validate-governance-projections.ts --write`);
  }
  return { ok: errors.length === 0, errors, itemCount: items.length };
}

export function writeGovernanceBacklogItems(repoRoot: string, items: readonly GovernanceBacklogItem[]): void {
  const itemsDir = path.join(repoRoot, ATM_BACKLOG_ITEMS_DIR);
  mkdirSync(itemsDir, { recursive: true });
  for (const item of sortItems(items)) {
    writeFileSync(path.join(itemsDir, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`, 'utf8');
  }
}

export function rebuildProjectionFromItems(repoRoot: string): void {
  const projectionPath = path.join(repoRoot, ATM_BACKLOG_PROJECTION_PATH);
  const projection = readFileSync(projectionPath, 'utf8');
  const prefix = extractProjectionPrefix(projection);
  const items = readBacklogItems(path.join(repoRoot, ATM_BACKLOG_ITEMS_DIR), []);
  writeFileSync(projectionPath, renderBacklogProjection(prefix, items), 'utf8');
}

function readBacklogItems(itemsDir: string, errors: string[]): GovernanceBacklogItem[] {
  if (!existsSync(itemsDir)) return [];
  return readdirSync(itemsDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => {
      const fullPath = path.join(itemsDir, entry);
      const parsed = JSON.parse(readFileSync(fullPath, 'utf8')) as GovernanceBacklogItem;
      const expectedName = `${parsed.id}.json`;
      if (entry !== expectedName) errors.push(`item filename ${entry} does not match id ${parsed.id}`);
      if (parsed.schemaId !== 'atm.governanceBacklogItem.v1') errors.push(`item ${entry} has invalid schemaId`);
      return parsed;
    });
}

function sortItems(items: readonly GovernanceBacklogItem[]): GovernanceBacklogItem[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  const body = trimmed.startsWith('|') ? trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined) : trimmed;
  return body.split('|').map((cell) => cell.trim());
}

function renderBacklogRow(item: GovernanceBacklogItem): string {
  return [
    item.id,
    item.date,
    item.repo,
    item.type,
    item.severity,
    item.status,
    item.area,
    item.finding,
    item.expectedBehavior,
    item.evidenceOrRepro,
    item.followUp
  ].map(escapeCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |');
}

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').trim();
}

function extractProjectionPrefix(markdown: string): string {
  const generatedIndex = markdown.indexOf('## Mandatory Global Hotfile Inventory');
  if (generatedIndex >= 0) return markdown.slice(0, generatedIndex);
  const tableIndex = markdown.indexOf(tableHeader);
  if (tableIndex >= 0) {
    const beforeTable = markdown.slice(0, tableIndex);
    const headingMatch = beforeTable.match(/\n## [^\n]*\n\s*$/u);
    return headingMatch && typeof headingMatch.index === 'number'
      ? beforeTable.slice(0, headingMatch.index)
      : beforeTable;
  }
  return markdown;
}

async function main(): Promise<void> {
  if (process.argv.includes('--import-current')) {
    const projection = readFileSync(path.join(root, ATM_BACKLOG_PROJECTION_PATH), 'utf8');
    writeGovernanceBacklogItems(root, parseBacklogItemsFromProjection(projection));
  }
  if (process.argv.includes('--write')) {
    rebuildProjectionFromItems(root);
  }
  const result = validateGovernanceProjections(root);
  if (!result.ok) {
    for (const error of result.errors) console.error(`[governance-projections] ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[governance-projections] ok (${result.itemCount} backlog item shards)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
