#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/reports/plan-3x-4x-charter-current-verdict.json');

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
      console.log('Usage: node --strip-types scripts/validate-four-plan-charter-current-verdict.ts [--input <json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function readJson(relativePath: string) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing file: ${relativePath}`);
  return JSON.parse(readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readText(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing file: ${relativePath}`);
  return readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '');
}

function sha256File(relativePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path.join(root, relativePath))).digest('hex')}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`charter verdict report missing: ${path.relative(root, options.input)}`);
  const report = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  const invariants = readJson('.atm/charter/charter-invariants.json');
  const charterText = readText('.atm/charter/atomic-charter.md');
  const firstPrinciplesText = readText('.atm/charter/atm-first-principles.md');
  const blockerMap = readJson('docs/reports/plan-3x-4x-closeout-blocker-map.json');
  const certificate = readJson('docs/reports/plan-3x-4x-independent-certificate.json');

  if (report.schemaId !== 'atm.fourPlanCharterCurrentVerdict.v1') findings.push('schemaId mismatch');
  if (report.status !== 'proven') findings.push('charter current verdict must be proven when all invariant checks pass');
  if (report.nonClaim !== 'This report proves charter conformance of the current closeout evidence shape; it does not certify objective completion.') {
    findings.push('nonClaim missing or weakened');
  }
  if (invariants.charterHash !== sha256File('.atm/charter/atomic-charter.md')) findings.push('atomic charter hash mismatch');
  if (invariants.firstPrinciplesHash !== sha256File('.atm/charter/atm-first-principles.md')) findings.push('first principles hash mismatch');
  if (!Array.isArray(invariants.invariants) || invariants.invariants.length < 11) findings.push('expected at least 11 charter invariants');
  for (const requiredId of ['INV-ATM-008', 'INV-ATM-009', 'INV-ATM-010', 'INV-ATM-011']) {
    if (!invariants.invariants.some((entry: any) => entry.id === requiredId)) findings.push(`missing invariant: ${requiredId}`);
    if (!charterText.includes(requiredId)) findings.push(`charter text missing invariant: ${requiredId}`);
  }
  const firstPrinciplesLower = firstPrinciplesText.toLowerCase();
  for (const [semanticCheck, requiredTerms] of [
    ['cost-boundary', ['cost']],
    ['end-to-end-time-boundary', ['end-to-end time']],
    ['token-diagnostics-boundary', ['token', 'diagnostic']]
  ] as [string, string[]][]) {
    if (!requiredTerms.every((term) => firstPrinciplesLower.includes(term))) {
      findings.push(`first principles missing semantic check: ${semanticCheck}`);
    }
  }
  if (blockerMap.status !== 'actionable-not-complete') findings.push('blocker map must remain actionable-not-complete');
  if (certificate.overallVerdict !== 'not-complete' || certificate.releaseAuthorized !== false) {
    findings.push('certificate must remain fail-closed while objective verdict is not-complete');
  }
  const invariantChecks = Array.isArray(report.invariantChecks) ? report.invariantChecks : [];
  for (const requiredId of ['INV-ATM-008', 'INV-ATM-009', 'INV-ATM-010', 'INV-ATM-011']) {
    const check = invariantChecks.find((entry: any) => entry.invariantId === requiredId);
    if (!check) {
      findings.push(`report missing invariant check: ${requiredId}`);
      continue;
    }
    if (check.status !== 'proven') findings.push(`invariant check not proven: ${requiredId}`);
    if (!Array.isArray(check.evidenceRefs) || check.evidenceRefs.length === 0) findings.push(`invariant check lacks evidence: ${requiredId}`);
  }
  for (const source of report.sourceReports ?? []) {
    const sourcePath = String(source.path ?? '');
    if (!sourcePath) {
      findings.push('source path missing');
      continue;
    }
    if (source.digest !== sha256File(sourcePath)) findings.push(`source digest mismatch: ${sourcePath}`);
  }

  const ok = findings.length === 0;
  const output = {
    ok,
    findings,
    invariantCheckCount: invariantChecks.length,
    charterVersion: invariants.charterVersion
  };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (ok) {
    console.log(`[validate-four-plan-charter-current-verdict] ok charterVersion=${invariants.charterVersion} invariantChecks=${invariantChecks.length}`);
  } else {
    console.error(`[validate-four-plan-charter-current-verdict] failed: ${findings.join('; ')}`);
  }
  process.exit(ok ? 0 : 1);
}

main();
