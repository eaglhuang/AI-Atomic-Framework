#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/reports/plan-3x-positive-current-receipts.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: reportPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
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
  const findings: string[] = [];

  if (report.schemaId !== 'atm.plan3xPositiveCurrentReceipts.v1') findings.push('schemaId mismatch');
  if (report.status !== 'positive-current-receipts-consumed') findings.push('status mismatch');
  if (report.nonClaim !== 'This report identifies Plan 3.x rows whose current objective-aligned receipts were consumed into source replay; it does not certify any plan complete while aggregate source replay verdicts remain not-complete.') {
    findings.push('nonClaim missing or weakened');
  }
  for (const source of report.sourceReports ?? []) {
    if (source.digest !== sha256File(String(source.path))) findings.push(`source digest mismatch: ${source.path}`);
  }

  const proofMap = readJson('docs/reports/plan-3x-current-row-proof-map.json');
  const freshFamily = (proofMap.proofFamilies ?? []).find((entry: any) => entry.id === 'fresh-command-replay-needed');
  const verifiedFamily = (proofMap.proofFamilies ?? []).find((entry: any) => entry.id === 'verified-current-receipt');
  const verifiedRefs = new Set((verifiedFamily?.rowRefs ?? []).map(String));
  const positiveRows = Array.isArray(report.positiveRows) ? report.positiveRows : [];
  const positiveRefs = positiveRows.map((row: any) => String(row.objectiveId));
  if (positiveRefs.length !== 15) findings.push(`positive row count mismatch: expected 15, observed ${positiveRefs.length}`);
  if (new Set(positiveRefs).size !== positiveRefs.length) findings.push('duplicate positive rows');
  for (const rowRef of positiveRefs) {
    if (!verifiedRefs.has(rowRef)) findings.push(`positive row was not consumed into verified-current-receipt family: ${rowRef}`);
  }
  if (report.totals?.freshCommandRows !== freshFamily?.rowCount) findings.push('freshCommandRows mismatch');
  if (report.totals?.positiveReceiptRowsReadyForSourceRecompute !== 0) findings.push('positiveReceiptRowsReadyForSourceRecompute must be zero after consumption');
  if (report.totals?.positiveReceiptRowsConsumedIntoSourceReplay !== positiveRefs.length) findings.push('positiveReceiptRowsConsumedIntoSourceReplay mismatch');
  if (report.totals?.objectiveAlignedNegativeControlRowsConsumed !== 4) findings.push('objectiveAlignedNegativeControlRowsConsumed mismatch');
  if (report.totals?.sourceRowsMutatedByThisReport !== positiveRefs.length) findings.push('sourceRowsMutatedByThisReport mismatch');

  const commandRuns = Array.isArray(report.commandReceipts) ? report.commandReceipts : [];
  for (const receipt of commandRuns) {
    if (receipt.exitCode !== 0) findings.push(`receipt exitCode must be zero: ${receipt.id}`);
    if (!Array.isArray(receipt.rowsCovered) || receipt.rowsCovered.length === 0) findings.push(`receipt rowsCovered missing: ${receipt.id}`);
  }
  const receiptCoveredRows = new Set(commandRuns.flatMap((receipt: any) => (receipt.rowsCovered ?? []).map(String)));
  for (const rowRef of positiveRefs) {
    if (!receiptCoveredRows.has(rowRef)) findings.push(`positive row lacks receipt coverage: ${rowRef}`);
  }

  const blocked = report.blockedPositiveRows?.[0];
  if (blocked?.coverage !== 'blocked-doctor-drift') findings.push('blocked doctor-drift section missing');
  if (blocked?.rowCount !== 2) findings.push('blocked doctor-drift row count mismatch');

  const plan30 = readJson('docs/reports/plan-3-0-objective-replay.json');
  const plan31 = readJson('docs/reports/plan-3-1-objective-replay.json');
  const plan32 = readJson('docs/reports/plan-3-2-objective-replay.json');
  for (const replay of [plan30, plan31, plan32]) {
    if (replay.verdict !== 'not-complete') findings.push(`source replay must remain not-complete until recompute: ${replay.planId}`);
  }

  const ok = findings.length === 0;
  const output = { ok, findings, positiveRows: positiveRefs.length, blockedDoctorRows: blocked?.rowCount ?? 0 };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan3x-positive-current-receipts] ok positiveRows=${positiveRefs.length}`);
  else console.error(`[validate-plan3x-positive-current-receipts] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
