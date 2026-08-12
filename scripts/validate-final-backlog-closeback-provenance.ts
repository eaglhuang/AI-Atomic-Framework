#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/final-backlog-closeback-provenance.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
  }
  return options;
}

function row(rows: any[], objectiveId: string): any {
  return rows.find((entry) => entry?.objectiveId === objectiveId) ?? {};
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const rows = Array.isArray(fixture.rows) ? fixture.rows : [];
  const findings: string[] = [];

  if (fixture.schemaId !== 'atm.finalBacklogClosebackProvenanceFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 4) findings.push(`expected 4 final provenance rows, observed ${rows.length}`);
  if (row(rows, 'P30-OBJ-15').backlogCensusMachineReadable !== true || row(rows, 'P30-OBJ-15').openItemRuleMachineCheckable !== true || row(rows, 'P30-OBJ-15').proseBacklogMayGreen !== false) findings.push('P30-OBJ-15 backlog rule must be machine-checkable');
  if (row(rows, 'P30-OBJ-16').targetPlanningClosebackShaExplicit !== true || row(rows, 'P30-OBJ-16').terminalReleasePushProvenanceRequired !== true || row(rows, 'P30-OBJ-16').scheduledClosebackMayGreen !== false) findings.push('P30-OBJ-16 closeback must require explicit SHA provenance');
  if (row(rows, 'P32-OBJ-06').targetPlanningCloseSeamVisible !== true || row(rows, 'P32-OBJ-06').closebackSuccessRequiresShaProvenance !== true || row(rows, 'P32-OBJ-06').successorTaskTextMayGreen !== false) findings.push('P32-OBJ-06 close seam must be visible and SHA-bound');
  if (row(rows, 'P32-OBJ-28').finalReleaseProvenanceRequired !== true || row(rows, 'P32-OBJ-28').pushShaRequired !== true || row(rows, 'P32-OBJ-28').receiptTextMaySubstituteSha !== false) findings.push('P32-OBJ-28 final release provenance must require push SHA');
  if (fixture.expectedVerdict !== 'final-backlog-closeback-provenance-boundaries-proven') findings.push('expected verdict mismatch');

  const diagnostics = [
    'backlog-census-machine-readable',
    'closeback-sha-explicit',
    'close-seam-visible',
    'final-release-push-sha-required'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.finalBacklogClosebackProvenanceValidation.v1',
    ok,
    findings,
    verdict: ok ? 'final-backlog-closeback-provenance-boundaries-proven' : 'final-backlog-closeback-provenance-boundaries-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-final-backlog-closeback-provenance] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-final-backlog-closeback-provenance] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
