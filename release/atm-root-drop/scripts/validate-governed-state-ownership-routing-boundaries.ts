#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/governed-state-ownership-routing-boundaries.json');

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

  if (fixture.schemaId !== 'atm.governedStateOwnershipRoutingBoundariesFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 9) findings.push(`expected 9 governed-state rows, observed ${rows.length}`);
  if (row(rows, 'P31-OBJ-04').machineAuthority !== true || row(rows, 'P31-OBJ-04').proseAuthorityMayGreen !== false) findings.push('P31-OBJ-04 must prefer machine authority over prose');
  if (row(rows, 'P31-OBJ-10').composeSeparatedFromSteward !== true || row(rows, 'P31-OBJ-10').singleActorMaySelfApprove !== false) findings.push('P31-OBJ-10 must separate compose and steward');
  if (row(rows, 'P31-OBJ-16').incidentDispositionExplicit !== true || row(rows, 'P31-OBJ-16').backlogCensusRequired !== true) findings.push('P31-OBJ-16 incident disposition must bind backlog census');
  if (row(rows, 'P31-OBJ-21').backlogInventoryMachineReadable !== true || row(rows, 'P31-OBJ-21').proseInventoryMayGreen !== false) findings.push('P31-OBJ-21 backlog inventory must be machine-readable');
  for (const id of ['P31-OBJ-23', 'P32-OBJ-25']) {
    const current = row(rows, id);
    if ((current.owningCardExplicit ?? current.owningCardPresent) !== true || current.ownerPresenceMayCertifyCompletion !== false) findings.push(`${id} owner presence must not certify completion`);
  }
  if (row(rows, 'P32-OBJ-13').foreignWorkFailsClosed !== true || row(rows, 'P32-OBJ-13').foreignWorkMayGreenCurrentRow !== false) findings.push('P32-OBJ-13 foreign work must fail closed');
  if (row(rows, 'P32-OBJ-17').staleRepairOwnedByGenericPolicy !== true || row(rows, 'P32-OBJ-17').adHocStaleRepairAllowed !== false) findings.push('P32-OBJ-17 stale repair must be generic-policy-owned');
  if (row(rows, 'P32-OBJ-20').staleBatchRoutingGeneric !== true || row(rows, 'P32-OBJ-20').routingMayCertifyCompletion !== false) findings.push('P32-OBJ-20 stale routing must not certify completion');
  if (fixture.expectedVerdict !== 'governed-state-ownership-routing-boundaries-proven') findings.push('expected verdict mismatch');

  const diagnostics = [
    'machine-authority-over-prose',
    'compose-steward-separated',
    'incident-and-backlog-machine-readable',
    'row-owner-not-completion',
    'foreign-work-fail-closed',
    'generic-stale-routing'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.governedStateOwnershipRoutingBoundariesValidation.v1',
    ok,
    findings,
    verdict: ok ? 'governed-state-ownership-routing-boundaries-proven' : 'governed-state-ownership-routing-boundaries-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-governed-state-ownership-routing-boundaries] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-governed-state-ownership-routing-boundaries] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
