#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/reports/plan-3x-fresh-command-replay-receipts.json');

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
      console.log('Usage: node --strip-types scripts/validate-plan3x-fresh-command-replay-receipts.ts [--input <json>] [--json]');
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

function sha256File(relativePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path.join(root, relativePath))).digest('hex')}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`fresh-command receipts missing: ${path.relative(root, options.input)}`);
  const report = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  if (report.schemaId !== 'atm.plan3xFreshCommandReplayReceipts.v1') findings.push('schemaId mismatch');
  if (report.status !== 'fresh-command-replay-partially-consumed') findings.push('status must be fresh-command-replay-partially-consumed');
  if (report.nonClaim !== 'These receipts prove that focused Plan 3.x validators execute against current files and that 13 rows were consumed into source replay; they do not certify any plan complete while source replay verdicts remain not-complete.') {
    findings.push('nonClaim missing or weakened');
  }
  for (const source of report.sourceReports ?? []) {
    const sourcePath = String(source.path ?? '');
    if (!sourcePath) {
      findings.push('source path missing');
      continue;
    }
    if (source.digest !== sha256File(sourcePath)) findings.push(`source digest mismatch: ${sourcePath}`);
  }

  const proofMap = readJson('docs/reports/plan-3x-current-row-proof-map.json');
  const freshFamily = (proofMap.proofFamilies ?? []).find((entry: any) => entry.id === 'fresh-command-replay-needed');
  if (!freshFamily) findings.push('fresh-command proof family missing from proof map');
  if (report.familyDisposition?.sourceRowCount !== freshFamily?.rowCount) findings.push('familyDisposition.sourceRowCount mismatch');
  if (report.familyDisposition?.rowsConsumedIntoSourceReplay !== 13) findings.push('rowsConsumedIntoSourceReplay mismatch');
  if (report.familyDisposition?.rowsCertifiedCompleteByTheseReceipts !== 0) findings.push('receipts must not certify rows complete');
  if (report.familyDisposition?.remainingRowsInFamily !== freshFamily?.rowCount) findings.push('remainingRowsInFamily mismatch');

  const commandRuns = Array.isArray(report.commandRuns) ? report.commandRuns : [];
  if (commandRuns.length !== 9) findings.push(`commandRuns count mismatch: expected 9, observed ${commandRuns.length}`);
  for (const run of commandRuns) {
    if (run.exitCode !== 0) findings.push(`command did not exit 0: ${run.id}`);
    if (!String(run.semanticBoundary ?? '').match(/not completion|not-complete|not positive completion|still need/i)) {
      findings.push(`semantic boundary missing not-terminal wording: ${run.id}`);
    }
  }

  const plan30 = readJson('docs/reports/plan-3-0-objective-replay.json');
  const plan31 = readJson('docs/reports/plan-3-1-objective-replay.json');
  const plan32 = readJson('docs/reports/plan-3-2-objective-replay.json');
  let verifiedRows = 0;
  for (const replay of [plan30, plan31, plan32]) {
    if (replay.verdict !== 'not-complete') findings.push(`source replay must remain not-complete: ${replay.planId}`);
    verifiedRows += Number(replay.statusCounts?.verified ?? 0);
  }
  if (verifiedRows !== 13) findings.push(`source replay verified count mismatch: expected 13, observed ${verifiedRows}`);

  const ok = findings.length === 0;
  const output = {
    ok,
    findings,
    commandRuns: commandRuns.length,
    sourceRowCount: report.familyDisposition?.sourceRowCount
  };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (ok) {
    console.log(`[validate-plan3x-fresh-command-replay-receipts] ok commandRuns=${commandRuns.length}`);
  } else {
    console.error(`[validate-plan3x-fresh-command-replay-receipts] failed: ${findings.join('; ')}`);
  }
  process.exit(ok ? 0 : 1);
}

main();
