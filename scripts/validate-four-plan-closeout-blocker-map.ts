#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/reports/plan-3x-4x-closeout-blocker-map.json');

type PlanId = '3.0' | '3.1' | '3.2' | '4.0';

const expectedObjectiveCounts: Record<PlanId, number> = {
  '3.0': 17,
  '3.1': 23,
  '3.2': 29,
  '4.0': 17
};

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
      console.log('Usage: node --strip-types scripts/validate-four-plan-closeout-blocker-map.ts [--input <json>] [--json]');
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

function rowsForReplay(report: any): readonly any[] {
  if (Array.isArray(report?.rows)) return report.rows;
  if (Array.isArray(report?.objectiveAnchors)) return report.objectiveAnchors;
  return [];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`closeout blocker map missing: ${path.relative(root, options.input)}`);
  const report = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  if (report.schemaId !== 'atm.fourPlanCloseoutBlockerMap.v1') findings.push('schemaId mismatch');
  if (!['actionable-not-complete', 'complete-closeout-certified'].includes(String(report.status))) findings.push('status invalid');
  if (report.nonClaim !== 'This map is an execution dashboard, not a completion certificate.') findings.push('nonClaim missing or weakened');

  const sourceReports = Array.isArray(report.sourceReports) ? report.sourceReports : [];
  for (const source of sourceReports) {
    const sourcePath = String(source.path ?? '');
    if (!sourcePath) {
      findings.push('source report path missing');
      continue;
    }
    if (!existsSync(path.join(root, sourcePath))) {
      findings.push(`source report missing: ${sourcePath}`);
      continue;
    }
    const observedDigest = sha256File(sourcePath);
    if (source.digest !== observedDigest) findings.push(`source digest mismatch: ${sourcePath}`);
  }

  const plan30 = readJson('docs/reports/plan-3-0-objective-replay.json');
  const plan31 = readJson('docs/reports/plan-3-1-objective-replay.json');
  const plan32 = readJson('docs/reports/plan-3-2-objective-replay.json');
  const plan4 = readJson('docs/reports/plan-4-foundation-replay.json');
  const certificate = readJson('docs/reports/plan-3x-4x-independent-certificate.json');
  const backlog = readJson('docs/reports/plan-3x-4x-backlog-disposition-census.json');

  const observedObjectiveCounts: Record<PlanId, number> = {
    '3.0': rowsForReplay(plan30).length,
    '3.1': rowsForReplay(plan31).length,
    '3.2': rowsForReplay(plan32).length,
    '4.0': rowsForReplay(plan4).length
  };
  for (const [planId, expected] of Object.entries(expectedObjectiveCounts) as [PlanId, number][]) {
    if (observedObjectiveCounts[planId] !== expected) {
      findings.push(`objective count mismatch: ${planId} expected ${expected}, observed ${observedObjectiveCounts[planId]}`);
    }
  }

  const unresolvedObjectiveRows =
    rowsForReplay(plan30).filter((row) => row.status !== 'verified').length +
    rowsForReplay(plan31).filter((row) => row.status !== 'verified').length +
    rowsForReplay(plan32).filter((row) => row.status !== 'verified').length +
    rowsForReplay(plan4).filter((row) => row.status !== 'verified').length;

  if (report.totals?.unresolvedObjectiveRows !== unresolvedObjectiveRows) {
    findings.push(`unresolved objective total mismatch: expected ${unresolvedObjectiveRows}, observed ${report.totals?.unresolvedObjectiveRows}`);
  }
  if (report.totals?.backlogDeferred !== backlog.counts?.deferred) {
    findings.push('backlog deferred count mismatch');
  }
  if (report.status === 'actionable-not-complete' && (certificate.overallVerdict !== 'not-complete' || certificate.releaseAuthorized !== false)) {
    findings.push('certificate must remain fail-closed while blocker map is actionable-not-complete');
  }
  if (report.status === 'complete-closeout-certified' && (certificate.overallVerdict !== 'complete' || certificate.releaseAuthorized !== true)) {
    findings.push('certificate must authorize release when blocker map is complete-closeout-certified');
  }
  if (!Array.isArray(report.blockerClasses) || report.blockerClasses.length === 0) {
    findings.push('blocker classes missing');
  }
  if (report.status === 'actionable-not-complete' && !report.nextExecutionOrder?.[0]?.id) findings.push('next execution order missing');
  if (report.status === 'complete-closeout-certified' && Array.isArray(report.nextExecutionOrder) && report.nextExecutionOrder.length !== 0) {
    findings.push('complete closeout must not expose pending execution order');
  }

  const ok = findings.length === 0;
  const output = {
    ok,
    findings,
    observedObjectiveCounts,
    unresolvedObjectiveRows,
    blockerClassCount: Array.isArray(report.blockerClasses) ? report.blockerClasses.length : 0
  };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (ok) {
    console.log(`[validate-four-plan-closeout-blocker-map] ok unresolvedObjectiveRows=${unresolvedObjectiveRows} blockerClasses=${output.blockerClassCount}`);
  } else {
    console.error(`[validate-four-plan-closeout-blocker-map] failed: ${findings.join('; ')}`);
  }
  process.exit(ok ? 0 : 1);
}

main();
