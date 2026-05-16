import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createTempWorkspace } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const requiredFiles = [
  'packages/integrations-core/package.json',
  'packages/integrations-core/README.md',
  'packages/integrations-core/src/index.ts',
  'schemas/integrations/install-manifest.schema.json',
  'tests/schema-fixtures/positive/integration-install-manifest.json',
  'integrations/codex-skills/atm-legacy-atomization-guidance/SKILL.md'
];

function fail(message: string) {
  console.error(`[integration-adapter:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function formatErrors(errors: any) {
  return (errors || [])
    .map((error: any) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

for (const requiredFile of requiredFiles) {
  if (!existsSync(path.join(root, requiredFile))) {
    fail(`missing required file: ${requiredFile}`);
  }
}

if (!process.exitCode) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const manifestSchema = readJson('schemas/integrations/install-manifest.schema.json');
  if (!ajv.validateSchema(manifestSchema)) {
    fail(`install manifest schema is invalid: ${formatErrors(ajv.errors)}`);
  }
  const validateManifest = ajv.compile(manifestSchema);
  const fixtureManifest = readJson('tests/schema-fixtures/positive/integration-install-manifest.json');
  if (!validateManifest(fixtureManifest)) {
    fail(`integration install manifest fixture failed schema validation: ${formatErrors(validateManifest.errors)}`);
  }

  const packageModule = await import(pathToFileURL(path.join(root, 'packages/integrations-core/src/index.ts')).href);
  assert(packageModule.integrationsCorePackage?.packageName === '@ai-atomic-framework/integrations-core', 'package descriptor mismatch');
  assert(typeof packageModule.sha256Bytes === 'function', 'missing sha256Bytes helper');
  assert(typeof packageModule.sha256File === 'function', 'missing sha256File helper');
  assert(typeof packageModule.createInstallManifest === 'function', 'missing createInstallManifest helper');
  assert(typeof packageModule.createCodexSkillsAdapter === 'function', 'missing createCodexSkillsAdapter reference factory');

  const codexSkillPath = 'integrations/codex-skills/atm-legacy-atomization-guidance/SKILL.md';
  const codexSkillContent = readFileSync(path.join(root, codexSkillPath));
  const codexSkillDigest = packageModule.sha256Bytes(codexSkillContent);
  assert(codexSkillDigest === fixtureManifest.files[0].sha256, 'fixture hash must match current Codex skill file');
  assert(codexSkillContent.byteLength === fixtureManifest.files[0].sizeBytes, 'fixture byte size must match current Codex skill file');

  const adapter = packageModule.createCodexSkillsAdapter([
    {
      relativePath: 'atm-legacy-atomization-guidance/SKILL.md',
      content: codexSkillContent,
      fileFormat: 'skill',
      source: 'template'
    }
  ]);
  assert(adapter.id === 'codex', 'Codex adapter id mismatch');
  assert(adapter.fileFormat === 'skill', 'Codex adapter fileFormat mismatch');
  assert(adapter.placeholderStyle === '$ARGUMENTS', 'Codex adapter placeholderStyle mismatch');
  assert(adapter.targetDir() === 'integrations/codex-skills', 'Codex adapter targetDir mismatch');
  assert(typeof adapter.install === 'function', 'Codex adapter missing install');
  assert(typeof adapter.verify === 'function', 'Codex adapter missing verify');
  assert(typeof adapter.uninstall === 'function', 'Codex adapter missing uninstall');

  const tempRoot = createTempWorkspace('atm-integration-adapter-');
  try {
    const repositoryRoot = path.join(tempRoot, 'repo');
    const context = {
      repositoryRoot,
      actor: 'fixture-agent',
      now: '2026-01-01T00:00:00.000Z'
    };
    const dryRunInstall = adapter.install({ ...context, dryRun: true });
    assert(dryRunInstall.ok === true, 'dry-run install must succeed');
    assert(dryRunInstall.dryRun === true, 'dry-run install must report dryRun=true');
    assert(!existsSync(path.join(repositoryRoot, codexSkillPath)), 'dry-run install must not write files');

    const install = adapter.install(context);
    assert(install.ok === true, 'install must succeed');
    assert(install.manifest.adapterId === 'codex', 'install manifest adapterId mismatch');
    assert(install.manifest.files.length === 1, 'install manifest must record injected files');
    assert(install.manifest.files[0].sha256 === fixtureManifest.files[0].sha256, 'install manifest must record sha256 for injected file');
    assert(validateManifest(install.manifest) === true, `install manifest schema mismatch: ${formatErrors(validateManifest.errors)}`);
    assert(existsSync(path.join(repositoryRoot, codexSkillPath)), 'install must write Codex skill');
    assert(existsSync(path.join(repositoryRoot, '.atm/integrations/manifest.json')), 'install must write manifest');

    const verify = adapter.verify(context, install.manifest);
    assert(verify.ok === true, 'verify must pass after install');
    assert(verify.driftedFiles.length === 0, 'verify must report zero drift after install');

    writeFileSync(path.join(repositoryRoot, codexSkillPath), `${codexSkillContent.toString('utf8')}\nlocal edit\n`);
    const verifyAfterEdit = adapter.verify(context, install.manifest);
    assert(verifyAfterEdit.ok === false, 'verify must fail after user edit');
    assert(verifyAfterEdit.driftedFiles.includes(codexSkillPath), 'verify must report edited skill as drifted');
    const uninstallAfterEdit = adapter.uninstall(context, install.manifest);
    assert(uninstallAfterEdit.ok === true, 'uninstall after edit must complete');
    assert(uninstallAfterEdit.preservedFiles.includes(codexSkillPath), 'uninstall must preserve edited files');
    assert(existsSync(path.join(repositoryRoot, codexSkillPath)), 'edited Codex skill must remain after uninstall');

    rmSync(repositoryRoot, { recursive: true, force: true });
    const cleanInstall = adapter.install(context);
    const cleanUninstall = adapter.uninstall(context, cleanInstall.manifest);
    assert(cleanUninstall.ok === true, 'clean uninstall must complete');
    assert(cleanUninstall.removedFiles.includes(codexSkillPath), 'clean uninstall must remove unchanged skill');
    assert(cleanUninstall.removedFiles.includes('.atm/integrations/manifest.json'), 'clean uninstall must remove unchanged manifest');
    assert(!existsSync(path.join(repositoryRoot, codexSkillPath)), 'unchanged Codex skill must be removed');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (!process.exitCode) {
  console.log(`[integration-adapter:${mode}] ok (interface, manifest schema, Codex reference install/verify/uninstall)`);
}
