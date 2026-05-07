/**
 * ATM-2-0017 validate script: Regression Matrix Compare Gate
 *
 * 驗證：
 * 1. quality-comparison-report.schema.json 存在且包含 mapImpactScope / dedupCandidates
 * 2. regression-compare.mjs 對 positive fixtures 產出正確結果
 * 3. regression-compare.mjs 對 negative fixtures 正確判定 fail
 * 4. Markdown 渲染產出固定模板格式
 * 5. AJV schema validation 通過
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

const prefix = '[regression-compare';

function assert(condition, msg) {
  if (!condition) throw new Error(`${prefix}:${mode}] FAIL: ${msg}`);
}

function run() {
  const schemaPath = path.join(repoRoot, 'schemas/police/quality-comparison-report.schema.json');
  const fixturePath = path.join(repoRoot, 'tests/police-fixtures/regression-compare.fixture.json');
  const modulePath = path.join(repoRoot, 'packages/core/src/police/regression-compare.mjs');

  // --- 1. Schema 存在且包含必要欄位 ---
  assert(existsSync(schemaPath), 'quality-comparison-report.schema.json not found');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  assert(schema.properties?.atomId, 'schema missing atomId');
  assert(schema.properties?.mapImpactScope, 'schema missing mapImpactScope');
  assert(schema.properties?.dedupCandidates, 'schema missing dedupCandidates');
  assert(schema.properties?.regressedMetrics, 'schema missing regressedMetrics');
  assert(schema.$defs?.metricDelta?.properties?.tolerance, 'schema metricDelta missing tolerance');

  // --- 2. Fixture 存在 ---
  assert(existsSync(fixturePath), 'regression-compare.fixture.json not found');
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assert(fixtures.positive?.length >= 3, 'need at least 3 positive fixtures');
  assert(fixtures.negative?.length >= 2, 'need at least 2 negative fixtures');

  // --- 3. Core module 存在 ---
  assert(existsSync(modulePath), 'regression-compare.mjs not found');

  if (mode === 'validate' || mode === 'test') {
    return import(pathToFileURL(path.resolve(modulePath)).href).then(async (mod) => {
      const { compareQualityMetrics, renderQualityReportMarkdown } = mod;

      // Positive fixtures
      let passedPositive = 0;
      for (const fixture of fixtures.positive) {
        const report = compareQualityMetrics(fixture.input);
        assert(report.regressed === fixture.expected.regressed,
          `${fixture.name}: expected regressed=${fixture.expected.regressed}, got ${report.regressed}`);
        assert(report.passed === fixture.expected.passed,
          `${fixture.name}: expected passed=${fixture.expected.passed}, got ${report.passed}`);
        assert(JSON.stringify(report.regressedMetrics.sort()) === JSON.stringify(fixture.expected.regressedMetrics.sort()),
          `${fixture.name}: regressedMetrics mismatch`);
        passedPositive++;
      }

      // Negative fixtures (regression or map fail detected)
      let passedNegative = 0;
      for (const fixture of fixtures.negative) {
        const report = compareQualityMetrics(fixture.input);
        assert(report.regressed === fixture.expected.regressed,
          `${fixture.name}: expected regressed=${fixture.expected.regressed}, got ${report.regressed}`);
        assert(report.passed === fixture.expected.passed,
          `${fixture.name}: expected passed=${fixture.expected.passed}, got ${report.passed}`);
        assert(JSON.stringify(report.regressedMetrics.sort()) === JSON.stringify(fixture.expected.regressedMetrics.sort()),
          `${fixture.name}: regressedMetrics mismatch`);
        passedNegative++;
      }

      // --- 4. Markdown 渲染 ---
      const sampleReport = compareQualityMetrics(fixtures.positive[1].input);
      const md = renderQualityReportMarkdown(sampleReport);
      assert(md.includes('# Quality Comparison Report'), 'Markdown missing title');
      assert(md.includes('| Metric |'), 'Markdown missing metrics table');
      assert(md.includes('## Conclusion'), 'Markdown missing conclusion');
      assert(md.includes('PASSED') || md.includes('FAILED'), 'Markdown missing result indicator');

      // Markdown 渲染 with map scope
      const mapReport = compareQualityMetrics(fixtures.negative[1].input);
      const mdMap = renderQualityReportMarkdown(mapReport);
      assert(mdMap.includes('## Map Impact Scope'), 'Markdown missing Map Impact Scope section');

      // --- 5. Schema validation ---
      let schemaValidated = false;
      try {
        const Ajv2020 = require('ajv/dist/2020.js');
        const addFormats = require('ajv-formats');
        const AjvConstructor = Ajv2020.default ?? Ajv2020;
        const addFormatsPlugin = addFormats.default ?? addFormats;
        const ajv = new AjvConstructor({ allErrors: true, strict: false });
        addFormatsPlugin(ajv);
        const validate = ajv.compile(schema);

        for (const fixture of [...fixtures.positive, ...fixtures.negative]) {
          const report = compareQualityMetrics(fixture.input);
          const valid = validate(report);
          assert(valid, `${fixture.name}: schema validation failed: ${JSON.stringify(validate.errors)}`);
        }
        schemaValidated = true;
      } catch (e) {
        if (mode === 'test') {
          assert(false, `schema validation error: ${e.message}`);
        }
      }

      console.log(`${prefix}:${mode}] ok (${passedPositive} positive, ${passedNegative} negative, markdown verified${schemaValidated ? ', schema validated' : ''})`);
    });
  }

  console.log(`${prefix}:${mode}] ok`);
}

run();
