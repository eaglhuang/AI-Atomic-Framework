import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type BacklogDisposition = 'terminal' | 'owned-open' | 'deferred' | 'unclassified';
export interface BacklogCensusRow { id: string; status: string; disposition: BacklogDisposition; ownerRefs: string[]; sourcePath: string; }
export interface BacklogCensus { schemaId: 'atm.backlogCensus.v1'; generatedAt: string; total: number; valid: number; invalid: string[];
  histogram: Record<string, number>; counts: Record<BacklogDisposition, number>; openLikeIds: string[]; unresolvedIds: string[];
  sortedOpenLikeIdDigest: string; rows: BacklogCensusRow[]; ok: boolean; }

const terminalStatus = /^(?:closed|resolved\b|fixed\b)/i;
const deferredStatus = /^(?:deferred\b|partially fixed\b|mitigated\b)/i;
const openStatus = /^(?:open\b|needs?\b|has task card\b|in progress\b|active\b|follow-up\b)/i;
const ownerRefPattern = /\b(?:ATM-GOV|TASK-[A-Z0-9-]+)-?\d{3,}\b/g;

export function classifyBacklogDisposition(item: Record<string, unknown>): { disposition: BacklogDisposition; ownerRefs: string[] } {
  const status = String(item.status ?? '').trim();
  const followUp = String(item.followUp ?? '');
  const resolution = item.resolution && typeof item.resolution === 'object' ? JSON.stringify(item.resolution) : '';
  const ownerRefs = [...new Set(`${status}\n${followUp}\n${resolution}`.match(ownerRefPattern) ?? [])].sort();
  if (terminalStatus.test(status)) return { disposition: 'terminal', ownerRefs };
  if (deferredStatus.test(status)) return { disposition: ownerRefs.length > 0 ? 'deferred' : 'unclassified', ownerRefs };
  if (openStatus.test(status)) return { disposition: ownerRefs.length > 0 ? 'owned-open' : 'unclassified', ownerRefs };
  return { disposition: 'unclassified', ownerRefs };
}

export function buildBacklogCensus(repoRoot: string, generatedAt = new Date().toISOString()): BacklogCensus {
  const itemsDir = path.join(repoRoot, 'docs/governance/atm-bug-and-optimization-backlog.items');
  const files = existsSync(itemsDir) ? readdirSync(itemsDir).filter((entry) => entry.endsWith('.json')).sort() : [];
  const invalid: string[] = []; const rows: BacklogCensusRow[] = []; const histogram: Record<string, number> = {};
  for (const file of files) {
    const sourcePath = path.posix.join('docs/governance/atm-bug-and-optimization-backlog.items', file);
    try {
      const item = JSON.parse(readFileSync(path.join(itemsDir, file), 'utf8')) as Record<string, unknown>;
      const id = String(item.id ?? '').trim(); const status = String(item.status ?? '').trim();
      if (!id || !status || item.schemaId !== 'atm.governanceBacklogItem.v1') throw new Error('missing canonical identity/status/schema');
      const classification = classifyBacklogDisposition(item);
      histogram[status] = (histogram[status] ?? 0) + 1;
      rows.push({ id, status, ...classification, sourcePath });
    } catch { invalid.push(sourcePath); }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const counts = { terminal: 0, 'owned-open': 0, deferred: 0, unclassified: 0 } satisfies Record<BacklogDisposition, number>;
  for (const row of rows) counts[row.disposition] += 1;
  const openLikeIds = rows.filter((row) => row.disposition === 'owned-open' || row.disposition === 'deferred' || row.disposition === 'unclassified').map((row) => row.id);
  const unresolvedIds = rows.filter((row) => row.disposition === 'unclassified').map((row) => row.id);
  return { schemaId: 'atm.backlogCensus.v1', generatedAt, total: files.length, valid: rows.length, invalid, histogram,
    counts, openLikeIds, unresolvedIds, sortedOpenLikeIdDigest: `sha256:${createHash('sha256').update(openLikeIds.join('\n')).digest('hex')}`,
    rows, ok: invalid.length === 0 && unresolvedIds.length === 0 };
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const census = buildBacklogCensus(repoRoot);
  if (process.argv.includes('--write')) writeFileSync(path.join(repoRoot, 'docs/reports/plan-3x-4x-backlog-disposition-census.json'), `${JSON.stringify(census, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: census.ok, total: census.total, valid: census.valid, invalid: census.invalid.length, counts: census.counts,
    unresolved: census.unresolvedIds.length, sortedOpenLikeIdDigest: census.sortedOpenLikeIdDigest }));
  if (!census.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
