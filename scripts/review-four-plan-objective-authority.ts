#!/usr/bin/env node
/**
 * Reviewer A for the four-plan closeout.  It deliberately has no dependency
 * on the independent certificate, release-closeback report, runbook report,
 * or reviewer B output: those are conclusions, not source authority.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = 'docs/reports/reviews/plan-3x-4x-objective-authority-review.json';
const objectiveSources = [
  { path: 'docs/reports/plan-3-0-objective-replay.json', prefix: 'P30-OBJ-', count: 17 },
  { path: 'docs/reports/plan-3-1-objective-replay.json', prefix: 'P31-OBJ-', count: 23 },
  { path: 'docs/reports/plan-3-2-objective-replay.json', prefix: 'P32-OBJ-', count: 29 },
  { path: 'docs/reports/plan4-successor-wave-objective-map.json', prefix: 'OBJ-', count: 17 }
] as const;
const otherSources = [
  'docs/reports/plan-3x-4x-backlog-disposition-census.json',
  'docs/reports/plan-3x-4x-backlog-deferred-waiver-register.json',
  'docs/reports/plan-3x-4x-charter-current-verdict.json'
] as const;

type JsonRecord = Record<string, any>;

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableDigest(value: unknown): string {
  return sha256(JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item));
}

function readJson(relativePath: string): JsonRecord {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing authority input: ${relativePath}`);
  return JSON.parse(readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
}

function exactIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`);
}

export function evaluateObjectiveRows(source: JsonRecord, prefix: string, count: number): string[] {
  const rows = Array.isArray(source.rows) ? source.rows : source.objectiveMappings;
  const findings: string[] = [];
  if (!Array.isArray(rows)) return ['rows-missing'];
  const expected = exactIds(prefix, count);
  const ids = rows.map((row: JsonRecord) => String(row.objectiveId ?? ''));
  if (ids.length !== count) findings.push(`row-count:${ids.length}/${count}`);
  if (new Set(ids).size !== ids.length) findings.push('duplicate-objective-id');
  for (const id of expected) if (!ids.includes(id)) findings.push(`missing-objective:${id}`);
  for (const row of rows) {
    if (row.status !== 'verified' && row.status !== 'successor-evidence-present') findings.push(`nonterminal:${String(row.objectiveId)}`);
    const tuples = Array.isArray(row.evidenceTuples) ? row.evidenceTuples : [];
    const refs = Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [];
    if (tuples.length === 0 && refs.length === 0) findings.push(`evidence-missing:${String(row.objectiveId)}`);
    for (const tuple of tuples) {
      const directReceipt = String(tuple.receiptId ?? '').trim();
      const sourceReceipt = String(tuple.source ?? '').trim() && String(tuple.expectedTaskId ?? '').trim();
      if (!String(tuple.kind ?? '').trim() || (!directReceipt && !sourceReceipt)) findings.push(`evidence-tuple-incomplete:${String(row.objectiveId)}`);
    }
  }
  return [...new Set(findings)].sort();
}

function evaluateBacklog(census: JsonRecord, waiver: JsonRecord): string[] {
  const findings: string[] = [];
  if (!Array.isArray(census.openLikeIds) || census.openLikeIds.length !== 0) findings.push('backlog-open-like-nonzero');
  if (Number(census.counts?.unclassified ?? -1) !== 0) findings.push('backlog-unclassified-nonzero');
  if (waiver.status !== 'waived-for-release-closeout') findings.push('backlog-waiver-status-invalid');
  if (Number(waiver.totals?.unclassified ?? -1) !== 0) findings.push('backlog-waiver-unclassified-nonzero');
  if (Number(waiver.totals?.waivedUnownedDeferred ?? -1) < 0) findings.push('backlog-waiver-deferred-missing');
  return findings;
}

function evaluateCharter(report: JsonRecord): string[] {
  const findings: string[] = [];
  if (report.status !== 'proven') findings.push('charter-report-not-proven');
  for (const source of report.sourceReports ?? []) {
    const relativePath = String(source.path ?? '');
    if (!relativePath || !existsSync(path.join(root, relativePath))) {
      findings.push(`charter-source-missing:${relativePath || 'unknown'}`);
      continue;
    }
    if (String(source.digest) !== sha256(readFileSync(path.join(root, relativePath)))) findings.push(`charter-source-digest-mismatch:${relativePath}`);
  }
  return findings;
}

export function compileReview(): JsonRecord {
  const findings: string[] = [];
  const inputs = [...objectiveSources.map((entry) => entry.path), ...otherSources].sort();
  const inputDigests = inputs.map((relativePath) => ({ path: relativePath, digest: sha256(readFileSync(path.join(root, relativePath))) }));
  const objectiveCounts: JsonRecord[] = [];
  for (const sourceSpec of objectiveSources) {
    const source = readJson(sourceSpec.path);
    const sourceFindings = evaluateObjectiveRows(source, sourceSpec.prefix, sourceSpec.count);
    findings.push(...sourceFindings.map((finding) => `${sourceSpec.path}:${finding}`));
    objectiveCounts.push({ path: sourceSpec.path, expectedRows: sourceSpec.count, observedRows: (source.rows ?? source.objectiveMappings ?? []).length, findings: sourceFindings });
  }
  const backlogFindings = evaluateBacklog(readJson(otherSources[0]), readJson(otherSources[1]));
  const charterFindings = evaluateCharter(readJson(otherSources[2]));
  findings.push(...backlogFindings, ...charterFindings);
  const targetHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  // A review is a function of its sealed source snapshot.  Wall-clock time
  // would make byte-stable replay impossible, so use the observed HEAD's
  // commit time as the stable timestamp of that snapshot.
  const generatedAt = execFileSync('git', ['show', '-s', '--format=%cI', targetHead], { cwd: root, encoding: 'utf8' }).trim();
  const unsigned = {
    schemaId: 'atm.fourPlanIndependentReview.v1', specVersion: '0.1.0', reviewerId: 'reviewer-a-objective-authority',
    reviewerRole: 'independent-objective-backlog-charter-reviewer', generatedAt, targetHead,
    inputDigests, objectiveCounts, backlog: { findings: backlogFindings }, charter: { findings: charterFindings },
    findings: [...new Set(findings)].sort(), verdict: findings.length === 0 ? 'proven' : 'not-proven',
    nonClaims: ['does-not-read-independent-certificate', 'does-not-read-release-closeback', 'does-not-read-runbook-completion-report', 'does-not-authorize-release']
  };
  return { ...unsigned, reviewDigest: stableDigest(unsigned) };
}

function main(): void {
  const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';
  if (mode !== 'validate' && mode !== 'write') throw new Error(`unknown --mode ${String(mode)}; expected validate or write`);
  const report = compileReview();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const absoluteOutput = path.join(root, outputPath);
  if (mode === 'write') {
    mkdirSync(path.dirname(absoluteOutput), { recursive: true });
    writeFileSync(absoluteOutput, serialized, 'utf8');
  }
  else if (!existsSync(absoluteOutput) || readFileSync(absoluteOutput, 'utf8') !== serialized) throw new Error('objective authority review is stale; rerun with --mode write');
  console.log(`[review-four-plan-objective-authority] ${report.verdict} findings=${report.findings.length} digest=${report.reviewDigest}`);
}

if (process.argv[1]?.endsWith('review-four-plan-objective-authority.ts')) main();
