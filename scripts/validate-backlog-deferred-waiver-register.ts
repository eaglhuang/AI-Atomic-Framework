#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/reports/plan-3x-4x-backlog-deferred-waiver-register.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: reportPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--input') {
      options.input = path.resolve(root, String(argv[++index] ?? ''));
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-backlog-deferred-waiver-register.ts [--input <json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function readJson(relativePath: string) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing source report: ${relativePath}`);
  return JSON.parse(readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(relativePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path.join(root, relativePath))).digest('hex')}`;
}

function digestIds(ids: readonly string[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex')}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`backlog deferred waiver register missing: ${path.relative(root, options.input)}`);
  const report = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];
  const census = readJson('docs/reports/plan-3x-4x-backlog-disposition-census.json');
  const releaseSubset = readJson('docs/reports/plan-3x-4x-backlog-release-blocking-subset.json');

  if (report.schemaId !== 'atm.backlogDeferredWaiverRegister.v1') findings.push('schemaId mismatch');
  if (report.status !== 'waived-for-release-closeout') findings.push('status mismatch');
  if (!String(report.nonClaim ?? '').includes('does not mark deferred backlog bugs fixed')) findings.push('nonClaim missing fixed-bug boundary');
  for (const source of report.sourceReports ?? []) {
    const sourcePath = String(source.path ?? '');
    if (!sourcePath) findings.push('source path missing');
    else if (source.digest !== sha256File(sourcePath)) findings.push(`source digest mismatch: ${sourcePath}`);
  }

  const waivedIds = (census.rows ?? [])
    .filter((row: any) => row.disposition === 'deferred' && (!Array.isArray(row.ownerRefs) || row.ownerRefs.length === 0))
    .map((row: any) => String(row.id))
    .sort();
  const ownerTrackedDeferred = (census.rows ?? [])
    .filter((row: any) => row.disposition === 'deferred' && Array.isArray(row.ownerRefs) && row.ownerRefs.length > 0).length;

  if (report.totals?.waivedUnownedDeferred !== waivedIds.length) findings.push('waived unowned deferred count mismatch');
  if (report.totals?.ownerTrackedDeferred !== ownerTrackedDeferred) findings.push('owner tracked deferred count mismatch');
  if (report.totals?.releaseBlockingNow !== 0 || releaseSubset.totals?.releaseBlockingNow !== 0) findings.push('releaseBlockingNow must be zero');
  if (report.totals?.unclassified !== 0 || census.counts?.unclassified !== 0) findings.push('unclassified must be zero');
  if (report.waivedUnownedDeferredIdsDigest !== digestIds(waivedIds)) findings.push('waived id digest mismatch');
  if (releaseSubset.totals?.needsTaskCardBeforeFinalRelease !== waivedIds.length) findings.push('release subset waived count mismatch');
  if (report.waiverAuthority?.followUpRequired !== true) findings.push('followUpRequired must remain true');
  for (const forbidden of ['bugs-fixed', 'rows-closed', 'backlog-retired']) {
    if (!report.waiverAuthority?.mustNotClaim?.includes(forbidden)) findings.push(`mustNotClaim missing: ${forbidden}`);
  }

  const output = {
    ok: findings.length === 0,
    findings,
    waivedUnownedDeferred: waivedIds.length,
    waivedUnownedDeferredIdsDigest: digestIds(waivedIds)
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (output.ok) console.log(`[validate-backlog-deferred-waiver-register] ok waivedUnownedDeferred=${waivedIds.length}`);
  else console.error(`[validate-backlog-deferred-waiver-register] failed: ${findings.join('; ')}`);
  process.exit(output.ok ? 0 : 1);
}

main();
