#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runRegistryDiff } from '../packages/cli/src/commands/registry-diff.ts';
import { computeHashDiffReport, resolveRegistryDiffTarget } from '../packages/core/src/registry/diff.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'test';
const prefix = `[registry-diff:${mode}]`;
const hashDiffFixtures = readJson('tests/registry-fixtures/hash-diff.fixture.json');
const adopterLineageFixture = readJson('tests/registry-fixtures/adopter-lineage.fixture.json');

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error(`${prefix} FAIL: ${message}`);
  }
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function run() {
  const schemaPath = path.join(repoRoot, 'schemas/registry/hash-diff-report.schema.json');
  const fixturePath = path.join(repoRoot, 'tests/registry-fixtures/hash-diff.fixture.json');
  const diffModulePath = path.join(repoRoot, 'packages/core/src/registry/diff.ts');
  const cliModulePath = path.join(repoRoot, 'packages/cli/src/atm.ts');

  assert(existsSync(schemaPath), 'hash-diff-report.schema.json not found');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  assert(schema.$id, 'schema missing $id');
  assert(schema.properties?.atomId, 'schema missing atomId property');
  assert(schema.properties?.deltas, 'schema missing deltas property');
  assert(schema.properties?.driftSummary, 'schema missing driftSummary property');
  assert(schema.properties?.semanticFingerprintDelta, 'schema missing semanticFingerprintDelta property');
  assert(schema.properties?.lineageContinuity, 'schema missing lineageContinuity property');

  assert(existsSync(fixturePath), 'hash-diff.fixture.json not found');
  assert(hashDiffFixtures.positive?.length >= 3, 'need at least 3 positive fixtures');
  assert(hashDiffFixtures.negative?.length >= 2, 'need at least 2 negative fixtures');

  assert(existsSync(diffModulePath), 'packages/core/src/registry/diff.ts not found');
  assert(existsSync(cliModulePath), 'packages/cli/src/atm.ts not found');
  const cliContent = readFileSync(cliModulePath, 'utf8');
  assert(cliContent.includes('registry-diff'), 'registry-diff command not registered in CLI');
  assert(cliContent.includes('runRegistryDiff'), 'runRegistryDiff not imported in CLI');

  if (mode !== 'validate' && mode !== 'test') {
    console.log(`${prefix} ok`);
    return;
  }

  let passedPositive = 0;
  for (const fixture of hashDiffFixtures.positive) {
    const report = computeHashDiffReport({
      entry: fixture.input.registryEntry,
      fromVersion: fixture.input.fromVersion,
      toVersion: fixture.input.toVersion,
      driftReason: fixture.input.driftReason ?? undefined
    });

    assert(report.schemaId === 'atm.hashDiffReport', `${fixture.name}: wrong schemaId`);
    assert(report.atomId === fixture.input.registryEntry.atomId, `${fixture.name}: wrong atomId`);
    assert(report.fromVersion === fixture.input.fromVersion, `${fixture.name}: wrong fromVersion`);
    assert(report.toVersion === fixture.input.toVersion, `${fixture.name}: wrong toVersion`);
    const driftSummary = report.driftSummary as { totalChanged: number; changedFields: string[]; driftReason?: string };
    assert(driftSummary.totalChanged === fixture.expected.totalChanged,
      `${fixture.name}: expected totalChanged=${fixture.expected.totalChanged}, got ${driftSummary.totalChanged}`);
    assert(JSON.stringify(driftSummary.changedFields.sort()) === JSON.stringify(fixture.expected.changedFields.sort()),
      `${fixture.name}: changedFields mismatch`);
    assert(typeof driftSummary.driftReason === 'string' && driftSummary.driftReason.length > 0,
      `${fixture.name}: driftReason should not be empty`);
    assert(report.lineageContinuity === fixture.expected.lineageContinuity,
      `${fixture.name}: lineageContinuity mismatch`);
    passedPositive++;
  }

  let passedNegative = 0;
  for (const fixture of hashDiffFixtures.negative) {
    let threw = false;
    try {
      computeHashDiffReport({
        entry: fixture.input.registryEntry,
        fromVersion: fixture.input.fromVersion,
        toVersion: fixture.input.toVersion
      });
    } catch (error: any) {
      threw = true;
      assert(error.message.toLowerCase().includes(fixture.expectedError),
        `${fixture.name}: error message should contain "${fixture.expectedError}", got "${error.message}"`);
    }
    assert(threw, `${fixture.name}: expected error but none thrown`);
    passedNegative++;
  }

  let schemaValidated = false;
  try {
    const Ajv2020 = require('ajv/dist/2020.js');
    const addFormats = require('ajv-formats');
    const AjvConstructor = Ajv2020.default ?? Ajv2020;
    const addFormatsPlugin = addFormats.default ?? addFormats;
    const ajv = new AjvConstructor({ allErrors: true, strict: false });
    addFormatsPlugin(ajv);
    const validate = ajv.compile(schema);

    for (const fixture of hashDiffFixtures.positive) {
      const report = computeHashDiffReport({
        entry: fixture.input.registryEntry,
        fromVersion: fixture.input.fromVersion,
        toVersion: fixture.input.toVersion,
        driftReason: fixture.input.driftReason ?? undefined
      });
      const valid = validate(report);
      assert(valid, `${fixture.name}: report failed schema validation: ${JSON.stringify(validate.errors)}`);
    }
    schemaValidated = true;
  } catch (error: any) {
    if (mode === 'test') {
      assert(false, `schema validation failed: ${error.message}`);
    }
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-registry-diff-'));
  try {
    const adopterRegistryPath = path.join(tempRoot, 'atomic-registry.json');
    const missingLineageRegistryPath = path.join(tempRoot, 'atomic-registry-missing-lineage.json');
    writeJson(adopterRegistryPath, adopterLineageFixture.registryDocument);
    writeJson(missingLineageRegistryPath, adopterLineageFixture.missingLineageRegistryDocument);

    const resolution = resolveRegistryDiffTarget(adopterLineageFixture.registryDocument, adopterLineageFixture.atomId);
    assert(resolution.ok === true, 'adopter lineage fixture must resolve through member lineage');
    if (!resolution.ok) {
      throw new Error(`${prefix} FAIL: expected member lineage resolution`);
    }
    assert(resolution.entry.sourceKind === 'member-version-lineage', 'adopter lineage fixture must resolve via member-version-lineage');
    assert(resolution.entry.memberIndex === 0, 'adopter lineage fixture must identify the member index');
    assert(resolution.entry.mapId === 'ATM-MAP-0001', 'adopter lineage fixture must identify the owning map');
    assert(resolution.entry.sourceRef === 'atomic_workbench/maps/ATM-MAP-0001/lineage-log.json', 'adopter lineage fixture must preserve the lineage sourceRef');
    assert(resolution.entry.versions.length === 2, 'adopter lineage fixture must preserve version history');

    const report: any = computeHashDiffReport({
      entry: resolution.entry as any,
      fromVersion: adopterLineageFixture.fromVersion,
      toVersion: adopterLineageFixture.toVersion
    });
    assert(report.driftSummary.totalChanged === 3, 'adopter lineage fixture must report three changed hashes');
    assert(JSON.stringify(report.driftSummary.changedFields.sort()) === JSON.stringify(['codeHash', 'specHash', 'testHash']),
      'adopter lineage fixture must report all hash fields as changed');

    const cliSuccess: any = runRegistryDiff([
      adopterLineageFixture.atomId,
      '--from',
      adopterLineageFixture.fromVersion,
      '--to',
      adopterLineageFixture.toVersion,
      '--registry',
      adopterRegistryPath,
      '--json'
    ]);
    assert(cliSuccess.ok === true, 'registry-diff must succeed when member lineage is present');
    assert(cliSuccess.evidence?.sourceKind === 'member-version-lineage', 'registry-diff must report member-version-lineage sourceKind');
    assert(cliSuccess.evidence?.totalChanged === 3, 'registry-diff must preserve computed change count');
    assert((cliSuccess.evidence?.report?.driftSummary as { totalChanged?: number } | undefined)?.totalChanged === 3, 'registry-diff must embed the diff report');

    const cliFailure: any = runRegistryDiff([
      adopterLineageFixture.atomId,
      '--from',
      adopterLineageFixture.fromVersion,
      '--to',
      adopterLineageFixture.toVersion,
      '--registry',
      missingLineageRegistryPath,
      '--json'
    ]);
    assert(cliFailure.ok === false, 'registry-diff must fail when member lineage is missing');
    assert(cliFailure.messages?.[0]?.code === 'ATM_DIFF_LINEAGE_MISSING', 'registry-diff must return ATM_DIFF_LINEAGE_MISSING');
    assert(cliFailure.evidence?.resolution?.code === 'ATM_DIFF_LINEAGE_MISSING', 'registry-diff must expose the lineage-missing resolution');
    assert(cliFailure.evidence?.resolution?.details?.candidateMapIds?.includes('ATM-MAP-0001'),
      'registry-diff must expose the owning map as a candidate');
    assert(cliFailure.evidence?.resolution?.details?.candidateMemberPaths?.includes('ATM-MAP-0001#members[0]'),
      'registry-diff must expose the member path candidate');
    assert(cliFailure.evidence?.resolution?.details?.requiredContract?.field === 'members[].versionLineage',
      'registry-diff must point to the member versionLineage contract');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`${prefix} ok (${passedPositive} positive, ${passedNegative} negative${schemaValidated ? ', schema validated' : ''})`);
}

try {
  run();
} catch (error: any) {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
}
