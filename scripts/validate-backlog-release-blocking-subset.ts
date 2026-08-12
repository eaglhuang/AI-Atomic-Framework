#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/reports/plan-3x-4x-backlog-release-blocking-subset.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: reportPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
  }
  return options;
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(relativePath: string) {
  return `sha256:${createHash('sha256').update(readFileSync(path.join(root, relativePath))).digest('hex')}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`missing report: ${path.relative(root, options.input)}`);
  const report = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const census = readJson('docs/reports/plan-3x-4x-backlog-disposition-census.json');
  const findings: string[] = [];

  if (report.schemaId !== 'atm.backlogReleaseBlockingSubset.v1') findings.push('schemaId mismatch');
  if (report.status !== 'release-blocking-subset-separated') findings.push('status mismatch');
  if (report.nonClaim !== 'This report separates release-blocking backlog risk from non-blocking deferred backlog; it does not close or rewrite backlog items.') {
    findings.push('nonClaim missing or weakened');
  }
  for (const source of report.sourceReports ?? []) {
    if (source.digest !== sha256File(String(source.path))) findings.push(`source digest mismatch: ${source.path}`);
  }

  const deferredRows = (census.rows ?? []).filter((row: any) => row.disposition === 'deferred');
  const ownerTrackedDeferred = deferredRows.filter((row: any) => Array.isArray(row.ownerRefs) && row.ownerRefs.length > 0);
  const unownedDeferred = deferredRows.filter((row: any) => !Array.isArray(row.ownerRefs) || row.ownerRefs.length === 0);
  const releaseBlockingNow = (census.invalid ?? []).length + (census.openLikeIds ?? []).length + (census.unresolvedIds ?? []).length;

  if (report.totals?.backlogTotal !== census.total) findings.push('backlogTotal mismatch');
  if (report.totals?.terminal !== census.counts?.terminal) findings.push('terminal mismatch');
  if (report.totals?.deferred !== census.counts?.deferred) findings.push('deferred mismatch');
  if (report.totals?.ownedOpen !== census.counts?.['owned-open']) findings.push('ownedOpen mismatch');
  if (report.totals?.openLikeIds !== (census.openLikeIds ?? []).length) findings.push('openLikeIds mismatch');
  if (report.totals?.unresolvedIds !== (census.unresolvedIds ?? []).length) findings.push('unresolvedIds mismatch');
  if (report.totals?.releaseBlockingNow !== releaseBlockingNow) findings.push('releaseBlockingNow mismatch');
  if (report.totals?.needsTaskCardBeforeFinalRelease !== unownedDeferred.length) findings.push('needsTaskCardBeforeFinalRelease mismatch');
  if (report.totals?.ownerTrackedDeferred !== ownerTrackedDeferred.length) findings.push('ownerTrackedDeferred mismatch');
  if (report.totals?.releaseBlockingNow !== 0) findings.push('releaseBlockingNow must be zero for this layer');

  const ruleCounts = new Map((report.dispositionRules ?? []).map((entry: any) => [entry.id, entry.count]));
  if (ruleCounts.get('release-blocking-now') !== releaseBlockingNow) findings.push('release-blocking-now rule mismatch');
  if (ruleCounts.get('needs-task-card-before-final-release') !== unownedDeferred.length) findings.push('needs-task-card rule mismatch');
  if (ruleCounts.get('owner-tracked-deferred') !== ownerTrackedDeferred.length) findings.push('owner-tracked rule mismatch');

  const ok = findings.length === 0;
  const output = { ok, findings, releaseBlockingNow, unownedDeferred: unownedDeferred.length, ownerTrackedDeferred: ownerTrackedDeferred.length };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-backlog-release-blocking-subset] ok releaseBlockingNow=${releaseBlockingNow}`);
  else console.error(`[validate-backlog-release-blocking-subset] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
