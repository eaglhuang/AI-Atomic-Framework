import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'language-js-fixtures', 'import-policy.fixture.json'), 'utf8'));
const adapterModule = await import(pathToFileURL(path.join(root, fixture.entrypoint)).href);

function fail(message: any) {
  console.error(`[language-js:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function assertReportShape(report: any, label: any) {
  assert(typeof report.ok === 'boolean', `${label} report missing ok boolean`);
  assert(report.profile && typeof report.profile === 'object', `${label} report missing profile`);
  assert(Array.isArray(report.imports), `${label} report missing imports array`);
  assert(Array.isArray(report.messages), `${label} report missing messages array`);
  assert(report.commandRunnerContract?.executionMode === 'delegated', `${label} report must use delegated command contract`);
  assert(Array.isArray(report.commandRunnerContract.commands), `${label} command contract missing commands array`);
  assert(Array.isArray(report.evidence), `${label} report missing evidence array`);
}

function assertMessage(report: any, code: any) {
  assert(report.messages.some((message: any) => message.code === code), `expected message code ${code}`);
}

function validateNoDownstreamTerms() {
  const protectedFiles = [
    'packages/language-js/package.json',
    'packages/language-js/src/index.ts',
    'packages/language-js/src/language-js-adapter.ts',
    'packages/language-js/README.md',
    'scripts/validate-language-js.ts',
    'tests/language-js-fixtures/import-policy.fixture.json'
  ];
  const bannedTerms = [
    ['3K', 'Life'].join(''),
    ['Co', 'cos'].join(''),
    ['html', '-to-', 'ucuf'].join(''),
    ['ga', 'cha'].join(''),
    ['UC', 'UF'].join(''),
    ['task', '-lock'].join(''),
    ['compute', '-gate'].join(''),
    ['docs', '/agent-', 'briefs/'].join('')
  ];
  for (const relativePath of protectedFiles) {
    const content = readFileSync(path.join(root, relativePath), 'utf8');
    for (const term of bannedTerms) {
      assert(!content.includes(term), `${relativePath} contains downstream-only term: ${term}`);
    }
  }
}

for (const relativePath of [fixture.entrypoint, 'packages/language-js/src/index.ts', 'packages/language-js/README.md']) {
  assert(existsSync(path.join(root, relativePath)), `missing language-js file: ${relativePath}`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-language-js-'));
try {
  const repositoryRoot = path.join(tempRoot, 'repo');
  mkdirSync(repositoryRoot, { recursive: true });
  writeFileSync(path.join(repositoryRoot, 'package.json'), JSON.stringify(fixture.projectPackageJson, null, 2), 'utf8');
  writeFileSync(path.join(repositoryRoot, 'package-lock.json'), '{}\n', 'utf8');

  const adapter = adapterModule.createJavaScriptLanguageAdapter(fixture.policy);
  assert(adapter.adapterName === '@ai-atomic-framework/language-js', 'adapter name mismatch');
  assert(adapter.languageIds.includes('javascript') && adapter.languageIds.includes('typescript'), 'adapter must support javascript and typescript');

  const profile = adapter.detectProjectProfile(repositoryRoot);
  assert(profile.packageManager === 'npm', 'profile must detect npm from package-lock.json');
  assert(profile.testCommand === 'npm run test', 'profile must expose test command');
  assert(profile.typecheckCommand === 'npm run typecheck', 'profile must expose typecheck command');
  assert(profile.lintCommand === 'npm run lint', 'profile must expose lint command');

  const validReport = adapter.validateComputeAtom(fixture.validComputeAtom, profile);
  assertReportShape(validReport, 'valid compute atom');
  assert(validReport.ok === true, 'valid compute atom must pass');
  assertMessage(validReport, 'ATM_JS_VALIDATE_OK');
  assert(validReport.imports.some((importRecord: any) => importRecord.specifier === 'node:path'), 'valid compute atom must scan node:path import');
  assert(validReport.commandRunnerContract.commands.some((command: any) => command.commandKind === 'test' && command.command === 'npm run test'), 'command contract must include delegated test command');

  const forbiddenReport = adapter.validateComputeAtom(fixture.forbiddenImportAtom, profile);
  assertReportShape(forbiddenReport, 'forbidden import atom');
  assert(forbiddenReport.ok === false, 'forbidden import atom must fail');
  assertMessage(forbiddenReport, 'ATM_JS_FORBIDDEN_IMPORT');

  const missingEntrypointReport = adapter.validateComputeAtom(fixture.missingEntrypointAtom, profile);
  assertReportShape(missingEntrypointReport, 'missing entrypoint atom');
  assert(missingEntrypointReport.ok === false, 'missing entrypoint atom must fail');
  assertMessage(missingEntrypointReport, 'ATM_JS_ENTRYPOINT_EXPORT_MISSING');

  const requireImports = adapter.scanImports({
    filePath: 'src/legacy.cjs',
    sourceText: "const childProcess = require('node:child_process');\nconst moduleName = await import('node:path');\n"
  });
  assert(requireImports.some((importRecord: any) => importRecord.statementKind === 'require' && importRecord.specifier === 'node:child_process'), 'scanImports must detect require calls');
  assert(requireImports.some((importRecord: any) => importRecord.statementKind === 'dynamic-import' && importRecord.specifier === 'node:path'), 'scanImports must detect dynamic imports');

  validateNoDownstreamTerms();
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[language-js:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}