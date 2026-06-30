import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: any) {
  console.error(`[test-facade:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function runFacade(args: any) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-validators.ts'), ...args, '--json'], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error: any) {
    fail(`run-validators output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
    parsed = {};
  }
  return {
    exitCode: result.status ?? 0,
    parsed
  };
}

for (const relativePath of ['scripts/run-validators.ts', 'scripts/validators.config.json', 'scripts/test-catalog.config.json', 'scripts/lib/test-catalog.ts']) {
  check(existsSync(path.join(root, relativePath)), `missing validator-facade dependency: ${relativePath}`);
}

const config = JSON.parse(readFileSync(path.join(root, 'scripts/validators.config.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(path.join(root, 'scripts/test-catalog.config.json'), 'utf8'));
check(Boolean(config?.profiles?.standard), 'validators.config.json must define standard profile');
check(Number.isInteger(config?.performanceDefaults?.fastValidatorBudgetMs), 'validators.config.json must define a shared fast validator duration budget');
check(Number.isInteger(config?.performanceDefaults?.slowValidatorBudgetMs), 'validators.config.json must define a shared slow validator duration budget');
check(catalog?.schemaId === 'atm.testCatalog.v1', 'test-catalog.config.json must define atm.testCatalog.v1');
check(Array.isArray(catalog?.entries), 'test catalog must define entries array');
check(catalog.entries.some((entry: any) => entry.capability === 'validator' && entry.family === 'language-static' && String(entry.adapter).includes('language-js')), 'test catalog must include JS/TS language-static validator entries');
check(catalog.entries.some((entry: any) => entry.capability === 'validator' && entry.family === 'language-static' && String(entry.adapter).includes('language-python')), 'test catalog must include Python language-static validator entries');
check(catalog.entries.some((entry: any) => entry.capability === 'validator' && entry.family === 'language-static' && String(entry.adapter).includes('language-csharp')), 'test catalog must include C# language-static validator entries');
check(catalog.entries.some((entry: any) => entry.capability === 'integration-test'), 'test catalog must include integration-test entries');

const quick = runFacade(['quick']);
check(quick.exitCode === 0, 'run-validators quick must exit 0 on baseline');
check(quick.parsed.profile === 'quick', 'run-validators quick must report profile=quick');
check(Array.isArray(quick.parsed.validators), 'run-validators quick must return validators array');
check(quick.parsed.total === quick.parsed.validators.length, 'run-validators quick total must equal validators.length');
check(quick.parsed.failed === 0, 'run-validators quick failed count must be 0 on baseline');
check(quick.parsed.performance?.schemaId === 'atm.validatorPerformanceReport.v1', 'run-validators quick must report validator performance diagnostics');
check(quick.parsed.selection?.schemaId === 'atm.validatorSelectionReport.v1', 'run-validators quick must report validator selection diagnostics');
check(quick.parsed.selection?.catalogSchemaId === 'atm.testCatalog.v1', 'selection diagnostics must be sourced from the unified test catalog');
check(Array.isArray(quick.parsed.selection?.families), 'selection diagnostics must include validator families');
check(Array.isArray(quick.parsed.selection?.duplicateDedupeKeys), 'selection diagnostics must include duplicate dedupe keys');
check(Array.isArray(quick.parsed.performance?.slowestValidators), 'performance diagnostics must include slowest validators');
check(Array.isArray(quick.parsed.performance?.slowestEntries), 'performance diagnostics must include catalog-aligned slowest entries');
check(Array.isArray(quick.parsed.performance?.familyHotspots), 'performance diagnostics must include family hotspots');
check(Array.isArray(quick.parsed.performance?.duplicateDedupeKeys), 'performance diagnostics must include duplicate dedupe keys');
check(Array.isArray(quick.parsed.performance?.budgetViolations), 'performance diagnostics must include budget violations array');
check(Array.isArray(quick.parsed.performance?.optimizationCandidates), 'performance diagnostics must include optimization candidates array');

const legacy = runFacade(['quick', '--legacy']);
check(legacy.exitCode === 0, 'run-validators quick --legacy must exit 0 on baseline');
check(legacy.parsed.legacy === true, 'legacy run must report legacy=true');
check(legacy.parsed.failed === 0, 'legacy run failed count must be 0 on baseline');
check(legacy.parsed.total === quick.parsed.total, 'legacy run total must match non-legacy total on baseline');
check(legacy.parsed.passed === quick.parsed.passed, 'legacy run passed count must match non-legacy total on baseline');

const filtered = runFacade(['quick', '--filter', 'tag:docs']);
check(filtered.exitCode === 0, 'run-validators filtered run must exit 0');
check(filtered.parsed.total > 0, 'filtered run must include at least one validator');
check(filtered.parsed.validators.every((entry: any) => Array.isArray(entry.tags) && entry.tags.some((tag: any) => String(tag).toLowerCase() === 'docs')), 'filtered run must keep only tag:docs validators');

const focused = runFacade(['standard', '--focus-path', 'integrations/codex-skills/atm-governance-router/SKILL.md']);
check(focused.exitCode === 0, 'run-validators focus-path run must exit 0 for integration surface');
check(Array.isArray(focused.parsed.focusPaths) && focused.parsed.focusPaths.length === 1, 'focus-path run must report normalized focusPaths');
check(focused.parsed.focusMode === 'paths', 'focus-path run must report focusMode=paths');
check(focused.parsed.baseValidatorCount > focused.parsed.focusReducedValidatorCount, 'focus-path run must shrink the selected standard validator set');
check(focused.parsed.validators.every((entry: any) => ['validate-integration-adapter', 'validate-skill-templates'].includes(String(entry?.name))), 'focus-path run must keep only matched integration validators');
check(focused.parsed.selection?.families?.length === 1, 'focus-path integration run should collapse into one managed family');
check(focused.parsed.selection?.families?.[0]?.familyId === 'integration-parity', 'focus-path integration run must classify into integration-parity family');

const parallel = runFacade(['quick', '--parallel']);
check(parallel.exitCode === 0, 'run-validators parallel run must exit 0');
check(parallel.parsed.parallel === true, 'parallel run must report parallel=true');
check(parallel.parsed.total > 0, 'parallel run must execute at least one validator');

const perfTemp = mkdtempSync(path.join(os.tmpdir(), 'atm-validator-performance-'));
try {
  const baselinePath = path.join(perfTemp, 'baseline.json');
  const outputPath = path.join(perfTemp, 'current.json');
  const baselineDocument = {
    schemaId: 'atm.validatorRunSummary.v1',
    validators: [
      {
        name: 'validate-product-charter',
        durationMs: 1
      }
    ]
  };
  writeFileSync(baselinePath, `${JSON.stringify(baselineDocument, null, 2)}\n`, 'utf8');
  const performanceRun = runFacade(['quick', '--filter', 'validate-product-charter', '--performance-baseline', baselinePath, '--performance-output', outputPath, '--fast-validator-budget-ms', '1']);
  check(performanceRun.exitCode === 0, 'run-validators performance baseline smoke must exit 0');
  check(existsSync(outputPath), 'run-validators --performance-output must write a summary file');
  check(performanceRun.parsed.performance?.baselinePresent === true, 'performance diagnostics must record baseline presence');
  check(Array.isArray(performanceRun.parsed.performance?.warnings), 'performance diagnostics must include warnings array');
  check(performanceRun.parsed.performance?.budgetViolations?.length >= 1, 'performance diagnostics must flag direct duration budget violations without needing a baseline');
  check(performanceRun.parsed.performance?.optimizationCandidates?.length >= 1, 'performance diagnostics must emit optimization candidates when budgets are exceeded');
} finally {
  rmSync(perfTemp, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[test-facade:${mode}] ok (profile, filter, focus-path, parallel, and legacy behaviors verified)`);
}
