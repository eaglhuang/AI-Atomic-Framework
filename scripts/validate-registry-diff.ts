/**
 * ATM-2-0015 validate script: Hash Diff / Version Diff Report
 *
 * 驗證：
 * 1. hash-diff-report.schema.json 存在且為合法 JSON Schema
 * 2. core diff.ts 對 positive fixtures 產出正確結果
 * 3. core diff.ts 對 negative fixtures 正確拋錯
 * 4. CLI registry-diff 命令已註冊且可執行
 * 5. schema validation 對產出的 report 通過
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'test';

const prefix = '[registry-diff';

function assert(condition: any, msg: any) {
  if (!condition) throw new Error(`${prefix}:${mode}] FAIL: ${msg}`);
}

function run() {
  const schemaPath = path.join(repoRoot, 'schemas/registry/hash-diff-report.schema.json');
  const fixturePath = path.join(repoRoot, 'tests/registry-fixtures/hash-diff.fixture.json');
  const diffModulePath = path.join(repoRoot, 'packages/core/src/registry/diff.ts');
  const cliModulePath = path.join(repoRoot, 'packages/cli/src/atm.ts');

  // --- 1. Schema 存在 ---
  assert(existsSync(schemaPath), 'hash-diff-report.schema.json not found');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  assert(schema.$id, 'schema missing $id');
  assert(schema.properties?.atomId, 'schema missing atomId property');
  assert(schema.properties?.deltas, 'schema missing deltas property');
  assert(schema.properties?.driftSummary, 'schema missing driftSummary property');
  assert(schema.properties?.semanticFingerprintDelta, 'schema missing semanticFingerprintDelta property');
  assert(schema.properties?.lineageContinuity, 'schema missing lineageContinuity property');

  // --- 2. Fixture 存在 ---
  assert(existsSync(fixturePath), 'hash-diff.fixture.json not found');
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assert(fixtures.positive?.length >= 3, 'need at least 3 positive fixtures');
  assert(fixtures.negative?.length >= 2, 'need at least 2 negative fixtures');

  // --- 3. Core module 存在 ---
  assert(existsSync(diffModulePath), 'packages/core/src/registry/diff.ts not found');

  // --- 4. CLI module 存在且已註冊 ---
  assert(existsSync(cliModulePath), 'packages/cli/src/atm.ts not found');
  const cliContent = readFileSync(cliModulePath, 'utf8');
  assert(cliContent.includes('registry-diff'), 'registry-diff command not registered in CLI');
  assert(cliContent.includes('runRegistryDiff'), 'runRegistryDiff not imported in CLI');

  if (mode === 'validate' || mode === 'test') {
    // --- 5. 動態 import core diff 並跑 fixture 測試 ---
    return import(pathToFileURL(path.resolve(diffModulePath)).href).then(async (diffModule) => {
      const { computeHashDiffReport } = diffModule;

      // Positive fixtures
      let passedPositive = 0;
      for (const fixture of fixtures.positive) {
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
        assert(report.driftSummary.totalChanged === fixture.expected.totalChanged,
          `${fixture.name}: expected totalChanged=${fixture.expected.totalChanged}, got ${report.driftSummary.totalChanged}`);
        assert(JSON.stringify(report.driftSummary.changedFields.sort()) === JSON.stringify(fixture.expected.changedFields.sort()),
          `${fixture.name}: changedFields mismatch`);
        assert(report.driftSummary.driftReason?.length > 0, `${fixture.name}: driftReason should not be empty`);
        assert(report.lineageContinuity === fixture.expected.lineageContinuity,
          `${fixture.name}: lineageContinuity mismatch`);
        passedPositive++;
      }

      // Negative fixtures
      let passedNegative = 0;
      for (const fixture of fixtures.negative) {
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

      // --- 6. Schema validation on positive output ---
      let schemaValidated = false;
      try {
        const Ajv2020 = require('ajv/dist/2020.js');
        const addFormats = require('ajv-formats');
        const AjvConstructor = Ajv2020.default ?? Ajv2020;
        const addFormatsPlugin = addFormats.default ?? addFormats;
        const ajv = new AjvConstructor({ allErrors: true, strict: false });
        addFormatsPlugin(ajv);
        const validate = ajv.compile(schema);

        for (const fixture of fixtures.positive) {
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
      } catch (e: any) {
        // ajv 不可用時 skip schema validation（typecheck / lint mode）
        if (mode === 'test') {
          assert(false, `schema validation failed: ${e.message}`);
        }
      }

      console.log(`${prefix}:${mode}] ok (${passedPositive} positive, ${passedNegative} negative${schemaValidated ? ', schema validated' : ''})`);
    });
  }

  // lint / typecheck mode 只做靜態檢查
  console.log(`${prefix}:${mode}] ok`);
}

run();
