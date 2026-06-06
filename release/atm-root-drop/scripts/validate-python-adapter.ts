import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPythonLanguageAdapter,
  detectPythonProjectProfile,
  planPythonAtomize,
  scanPythonEntrypoints,
  scanPythonImports,
  validatePythonComputeAtom
} from '../packages/language-python/src/index.ts';
import { inspectRuntimeAdapterReadiness } from '../packages/cli/src/commands/runtime-adapter-readiness.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(text: string): void {
  console.error(`[python-adapter:${mode}] ${text}`);
  process.exitCode = 1;
}

function requireFile(relative: string) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) {
    fail(`missing required file: ${relative}`);
    return null;
  }
  return absolute;
}

const adopterRoot = requireFile('fixtures/python-adapter/synthetic-adopter');
const pipeline = requireFile('fixtures/python-adapter/legacy-pipeline/messy_pipeline.py');
const packagePath = requireFile('packages/language-python/package.json');
const indexSourcePath = requireFile('packages/language-python/src/index.ts');
const adapterSourcePath = requireFile('packages/language-python/src/language-python-adapter.ts');

if (process.exitCode) {
  process.exit(1);
}

const packageManifest = JSON.parse(readFileSync(packagePath!, 'utf8')) as { name?: string };
if (packageManifest.name !== '@ai-atomic-framework/language-python') {
  fail(`packages/language-python/package.json name must be @ai-atomic-framework/language-python (got ${packageManifest.name})`);
}

const indexSource = readFileSync(indexSourcePath!, 'utf8');
for (const exportName of [
  'pythonLanguageAdapterPackage',
  'languagePythonPackage',
  'createPythonLanguageAdapter',
  'detectPythonProjectProfile',
  'scanPythonEntrypoints',
  'scanPythonImports',
  'planPythonAtomize',
  'defaultPythonImportPolicy',
  'pythonLanguageRuntime'
]) {
  if (!indexSource.includes(exportName)) {
    fail(`packages/language-python/src/index.ts must export ${exportName}`);
  }
}

const adapterSource = readFileSync(adapterSourcePath!, 'utf8');
for (const phrase of [
  'PIPELINE_FOLDER_HINTS',
  'detectPythonProjectProfile',
  'scanPythonEntrypoints',
  'scanPythonImports',
  'planPythonAtomize'
]) {
  if (!adapterSource.includes(phrase)) {
    fail(`language-python-adapter.ts missing ${phrase}`);
  }
}

const profile = detectPythonProjectProfile(adopterRoot!);
if (!profile.hasPyprojectToml || !profile.hasRequirementsTxt) {
  fail('synthetic adopter profile must detect pyproject.toml and requirements.txt');
}
if (!profile.declaredScripts.includes('synth')) {
  fail(`synthetic adopter [project.scripts] should expose 'synth' (got ${profile.declaredScripts.join(', ')})`);
}
if (!profile.testCommand) {
  fail('synthetic adopter should resolve a non-null test command.');
}
if (profile.testCommand !== 'poetry run pytest') {
  fail(`synthetic adopter should wrap pytest with the detected package manager (got ${profile.testCommand}).`);
}
if (profile.typecheckCommand !== 'poetry run mypy .') {
  fail(`synthetic adopter should wrap mypy with the detected package manager (got ${profile.typecheckCommand}).`);
}
if (profile.lintCommand !== 'poetry run ruff check .') {
  fail(`synthetic adopter should wrap ruff with the detected package manager (got ${profile.lintCommand}).`);
}

const pipelineSource = readFileSync(pipeline!, 'utf8');
const entrypoints = scanPythonEntrypoints({ filePath: 'fixtures/python-adapter/legacy-pipeline/messy_pipeline.py', sourceText: pipelineSource });
if (!entrypoints.some((entry) => entry.kind === 'script-main')) {
  fail('messy_pipeline.py should expose an `if __name__ == "__main__":` entrypoint.');
}
if (!entrypoints.some((entry) => entry.kind === 'declared-script' && entry.symbol === 'main')) {
  fail('messy_pipeline.py should expose a `def main(...)` declared script.');
}

const imports = scanPythonImports({ filePath: 'fixtures/python-adapter/legacy-pipeline/messy_pipeline.py', sourceText: pipelineSource });
if (!imports.some((entry) => entry.specifier === 'subprocess')) {
  fail('messy_pipeline.py imports should include subprocess.');
}

const validReport = validatePythonComputeAtom({
  atomId: 'ATM-PY-FIXTURE',
  entrypoint: 'fixtures/python-adapter/legacy-pipeline/messy_pipeline.py',
  sourceFiles: [{ filePath: 'fixtures/python-adapter/legacy-pipeline/messy_pipeline.py', sourceText: pipelineSource }]
}, profile);
if (!validReport.ok || !validReport.messages.some((entry) => entry.code === 'ATM_PY_VALIDATE_OK')) {
  fail('validatePythonComputeAtom should pass the messy pipeline fixture without a forbidden import policy.');
}
if (!validReport.entrypoints.some((entry) => entry.kind === 'script-main')) {
  fail('validatePythonComputeAtom should include scanned entrypoints in the report.');
}
if (!validReport.commandRunnerContract.commands.some((command) => command.commandKind === 'test' && command.command === 'poetry run pytest')) {
  fail('validatePythonComputeAtom should include the delegated pytest command in its command runner contract.');
}

const forbiddenReport = validatePythonComputeAtom({
  atomId: 'ATM-PY-FORBIDDEN',
  entrypoint: 'fixtures/python-adapter/legacy-pipeline/messy_pipeline.py',
  sourceFiles: [{ filePath: 'fixtures/python-adapter/legacy-pipeline/messy_pipeline.py', sourceText: pipelineSource }],
  importPolicy: { forbiddenSpecifiers: ['subprocess'] }
}, profile);
if (forbiddenReport.ok || !forbiddenReport.messages.some((entry) => entry.code === 'ATM_PY_FORBIDDEN_IMPORT')) {
  fail('validatePythonComputeAtom should fail when host policy forbids subprocess.');
}

const missingSignatureReport = validatePythonComputeAtom({
  atomId: 'ATM-PY-MISSING-SIGNATURE',
  entrypoint: 'scratch/no_entrypoint.py',
  sourceFiles: [{ filePath: 'scratch/no_entrypoint.py', sourceText: 'import json\nVALUE = 1\n' }]
}, profile);
if (missingSignatureReport.ok || !missingSignatureReport.messages.some((entry) => entry.code === 'ATM_PY_ENTRYPOINT_SIGNATURE_MISSING')) {
  fail('validatePythonComputeAtom should fail when the entrypoint source has no main signature.');
}

const plan = planPythonAtomize({
  atomId: 'ATM-CORE-FIXTURE',
  entrypoint: 'fixtures/python-adapter/legacy-pipeline/messy_pipeline.py',
  sourceFiles: [{ filePath: 'fixtures/python-adapter/legacy-pipeline/messy_pipeline.py', sourceText: pipelineSource }]
});
if (plan.executionMode !== 'dry-run' || plan.mutates.length !== 0) {
  fail('planPythonAtomize must be dry-run and never report mutated paths.');
}
if (!plan.steps.some((step) => step.stepKind === 'evidence-required')) {
  fail('planPythonAtomize must include an evidence-required step.');
}

const adapter = createPythonLanguageAdapter();
if (adapter.adapterName !== '@ai-atomic-framework/language-python' || !adapter.supportsAtomizeDryRun) {
  fail('createPythonLanguageAdapter must report the expected adapter name and supportsAtomizeDryRun=true.');
}

const readiness = inspectRuntimeAdapterReadiness(adopterRoot!);
if (!readiness.pythonOnlyHost) {
  fail(`synthetic adopter should be detected as python-only host (got ${JSON.stringify(readiness.detectedLanguages)}).`);
}
if (!readiness.pythonLanguageAdapterAvailable) {
  fail('runtime adapter readiness should report pythonLanguageAdapterAvailable=true when the bundled adapter is present.');
}
if (readiness.atomBirthApplyDeferred) {
  fail('atom birth/apply should no longer be deferred when the Python language adapter is bundled.');
}
if (readiness.needsRuntimeAdapterHint) {
  fail('needsRuntimeAdapterHint must be false when the Python adapter is bundled.');
}

if (!process.exitCode) {
  console.log(`[python-adapter:${mode}] ok (synthetic adopter detection, entrypoint scan, dry-run plan, runtime readiness)`);
}
