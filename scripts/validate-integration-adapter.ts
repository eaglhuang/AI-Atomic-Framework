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
  'packages/integration-claude-code/package.json',
  'packages/integration-claude-code/README.md',
  'packages/integration-claude-code/src/index.ts',
  'packages/integration-copilot/package.json',
  'packages/integration-copilot/README.md',
  'packages/integration-copilot/src/index.ts',
  'packages/integration-cursor/package.json',
  'packages/integration-cursor/README.md',
  'packages/integration-cursor/src/index.ts',
  'packages/integration-gemini/package.json',
  'packages/integration-gemini/README.md',
  'packages/integration-gemini/src/index.ts',
  'schemas/integrations/install-manifest.schema.json',
  'tests/schema-fixtures/positive/integration-install-manifest.json',
  'integrations/codex-skills/atm-legacy-atomization-guidance/SKILL.md'
];

const requestedAdapterFilter = process.argv.includes('--filter')
  ? process.argv[process.argv.indexOf('--filter') + 1]
  : null;

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
  assert(typeof packageModule.createStaticIntegrationAdapter === 'function', 'missing createStaticIntegrationAdapter helper');
  assert(typeof packageModule.createCodexSkillsAdapter === 'function', 'missing createCodexSkillsAdapter reference factory');
  assert(packageModule.atmFirstCommand === 'node atm.mjs next --json', 'first command constant mismatch');
  assert(packageModule.charterInvariantsPlaceholder === '{{CHARTER_INVARIANTS}}', 'charter invariants placeholder mismatch');
  assert(packageModule.minimumAtmEntrySkillDefinitions.length === 7, 'minimum ATM entry skill set must contain seven entries');

  const codexSkillPath = 'integrations/codex-skills/atm-legacy-atomization-guidance/SKILL.md';
  const codexSkillContent = readFileSync(path.join(root, codexSkillPath));
  const codexSkillDigest = packageModule.sha256Bytes(codexSkillContent);
  assert(codexSkillDigest === fixtureManifest.files[0].sha256, 'fixture hash must match current Codex skill file');
  assert(codexSkillContent.byteLength === fixtureManifest.files[0].sizeBytes, 'fixture byte size must match current Codex skill file');

  const codexAdapter = packageModule.createCodexSkillsAdapter([
    {
      relativePath: 'atm-legacy-atomization-guidance/SKILL.md',
      content: codexSkillContent,
      fileFormat: 'skill',
      source: 'template'
    }
  ]);

  const adapterSpecs = [
    {
      id: 'codex',
      adapter: codexAdapter,
      expectedTargetDir: 'integrations/codex-skills',
      expectedFileFormat: 'skill',
      expectedPlaceholderStyle: '$ARGUMENTS',
      expectedMinimumFiles: 1,
      requireMinimumEntrySet: false,
      requireCharterPlaceholder: false,
      requireFirstCommand: false
    },
    await createAdapterSpec('claude-code', 'packages/integration-claude-code/src/index.ts', 'createClaudeCodeIntegrationAdapter', '.claude/skills', 'skill', '$ARGUMENTS'),
    await createAdapterSpec('copilot', 'packages/integration-copilot/src/index.ts', 'createCopilotIntegrationAdapter', '.github', 'instructions-md', '{{vars}}', 15),
    await createAdapterSpec('cursor', 'packages/integration-cursor/src/index.ts', 'createCursorIntegrationAdapter', '.cursor/rules/skills', 'markdown', '$ARGUMENTS'),
    await createAdapterSpec('gemini', 'packages/integration-gemini/src/index.ts', 'createGeminiIntegrationAdapter', '.gemini/commands', 'toml', 'toml-fields')
  ].filter((adapterSpec: any) => requestedAdapterFilter ? adapterSpec.id === requestedAdapterFilter : true);

  assert(adapterSpecs.length > 0, `no integration adapter matched filter: ${requestedAdapterFilter}`);

  for (const adapterSpec of adapterSpecs) {
    exerciseAdapter(adapterSpec, validateManifest, fixtureManifest, packageModule.sha256Bytes);
  }
}

if (!process.exitCode) {
  console.log(`[integration-adapter:${mode}] ok (interface, manifest schema, Codex + 4 agent adapters install/verify/uninstall)`);
}

async function createAdapterSpec(
  adapterId: string,
  modulePath: string,
  factoryName: string,
  expectedTargetDir: string,
  expectedFileFormat: string,
  expectedPlaceholderStyle: string,
  expectedMinimumFiles = 7
) {
  const adapterModule = await import(pathToFileURL(path.join(root, modulePath)).href);
  assert(typeof adapterModule[factoryName] === 'function', `${adapterId} package missing factory: ${factoryName}`);
  return {
    id: adapterId,
    adapter: adapterModule[factoryName](),
    expectedTargetDir,
    expectedFileFormat,
    expectedPlaceholderStyle,
    expectedMinimumFiles,
    requireMinimumEntrySet: true,
    requireCharterPlaceholder: true,
    requireFirstCommand: true
  };
}

function exerciseAdapter(adapterSpec: any, validateManifest: any, fixtureManifest: any, sha256Bytes: (input: string | Uint8Array) => string) {
  const adapter = adapterSpec.adapter;
  assert(adapter.id === adapterSpec.id, `${adapterSpec.id} adapter id mismatch`);
  assert(adapter.fileFormat === adapterSpec.expectedFileFormat, `${adapterSpec.id} adapter fileFormat mismatch`);
  assert(adapter.placeholderStyle === adapterSpec.expectedPlaceholderStyle, `${adapterSpec.id} adapter placeholderStyle mismatch`);
  assert(adapter.targetDir() === adapterSpec.expectedTargetDir, `${adapterSpec.id} adapter targetDir mismatch`);
  assert(typeof adapter.install === 'function', `${adapterSpec.id} adapter missing install`);
  assert(typeof adapter.verify === 'function', `${adapterSpec.id} adapter missing verify`);
  assert(typeof adapter.uninstall === 'function', `${adapterSpec.id} adapter missing uninstall`);

  const tempRoot = createTempWorkspace(`atm-integration-${adapterSpec.id}-`);
  try {
    const repositoryRoot = path.join(tempRoot, 'repo');
    const context = {
      repositoryRoot,
      actor: 'fixture-agent',
      now: '2026-01-01T00:00:00.000Z'
    };
    const dryRunInstall = adapter.install({ ...context, dryRun: true });
    assert(dryRunInstall.ok === true, `${adapterSpec.id} dry-run install must succeed`);
    assert(dryRunInstall.dryRun === true, `${adapterSpec.id} dry-run install must report dryRun=true`);
    for (const fileRecord of dryRunInstall.manifest.files) {
      assert(!existsSync(path.join(repositoryRoot, fileRecord.path)), `${adapterSpec.id} dry-run install must not write ${fileRecord.path}`);
    }

    const install = adapter.install(context);
    assert(install.ok === true, `${adapterSpec.id} install must succeed`);
    assert(install.manifest.adapterId === adapterSpec.id, `${adapterSpec.id} install manifest adapterId mismatch`);
    assert(install.manifest.files.length >= adapterSpec.expectedMinimumFiles, `${adapterSpec.id} install manifest must record expected files`);
    assert(validateManifest(install.manifest) === true, `${adapterSpec.id} install manifest schema mismatch: ${formatErrors(validateManifest.errors)}`);
    assert(existsSync(path.join(repositoryRoot, '.atm/integrations/manifest.json')), `${adapterSpec.id} install must write manifest`);

    if (adapterSpec.id === 'codex') {
      assert(install.manifest.files[0].sha256 === fixtureManifest.files[0].sha256, 'Codex install manifest must record sha256 for injected file');
    }

    const installedPaths = install.manifest.files.map((fileRecord: any) => fileRecord.path);
    if (adapterSpec.requireMinimumEntrySet) {
      for (const entryId of ['atm-next', 'atm-orient', 'atm-create', 'atm-lock', 'atm-evidence', 'atm-upgrade-scan', 'atm-handoff']) {
        assert(installedPaths.some((installedPath: string) => installedPath.includes(entryId)), `${adapterSpec.id} missing entry file for ${entryId}`);
      }
    }

    for (const fileRecord of install.manifest.files) {
      const installedPath = path.join(repositoryRoot, fileRecord.path);
      assert(existsSync(installedPath), `${adapterSpec.id} must write ${fileRecord.path}`);
      const installedContent = readFileSync(installedPath, 'utf8');
      assert(sha256Bytes(readFileSync(installedPath)) === fileRecord.sha256, `${adapterSpec.id} manifest hash mismatch for ${fileRecord.path}`);
      if (adapterSpec.requireCharterPlaceholder) {
        assert(installedContent.includes('{{CHARTER_INVARIANTS}}'), `${adapterSpec.id} file missing charter invariants placeholder: ${fileRecord.path}`);
      }
      if (adapterSpec.requireFirstCommand) {
        assert(installedContent.includes('node atm.mjs next --json'), `${adapterSpec.id} file missing first command: ${fileRecord.path}`);
      }
    }

    const verify = adapter.verify(context, install.manifest);
    assert(verify.ok === true, `${adapterSpec.id} verify must pass after install`);
    assert(verify.driftedFiles.length === 0, `${adapterSpec.id} verify must report zero drift after install`);

    const editedPath = install.manifest.files[0].path;
    writeFileSync(path.join(repositoryRoot, editedPath), `${readFileSync(path.join(repositoryRoot, editedPath), 'utf8')}\nlocal edit\n`);
    const verifyAfterEdit = adapter.verify(context, install.manifest);
    assert(verifyAfterEdit.ok === false, `${adapterSpec.id} verify must fail after user edit`);
    assert(verifyAfterEdit.driftedFiles.includes(editedPath), `${adapterSpec.id} verify must report edited file as drifted`);
    const uninstallAfterEdit = adapter.uninstall(context, install.manifest);
    assert(uninstallAfterEdit.ok === true, `${adapterSpec.id} uninstall after edit must complete`);
    assert(uninstallAfterEdit.preservedFiles.includes(editedPath), `${adapterSpec.id} uninstall must preserve edited files`);
    assert(existsSync(path.join(repositoryRoot, editedPath)), `${adapterSpec.id} edited file must remain after uninstall`);

    rmSync(repositoryRoot, { recursive: true, force: true });
    const cleanInstall = adapter.install(context);
    const cleanUninstall = adapter.uninstall(context, cleanInstall.manifest);
    assert(cleanUninstall.ok === true, `${adapterSpec.id} clean uninstall must complete`);
    for (const fileRecord of cleanInstall.manifest.files) {
      assert(cleanUninstall.removedFiles.includes(fileRecord.path), `${adapterSpec.id} clean uninstall must remove ${fileRecord.path}`);
      assert(!existsSync(path.join(repositoryRoot, fileRecord.path)), `${adapterSpec.id} unchanged file must be removed: ${fileRecord.path}`);
    }
    assert(cleanUninstall.removedFiles.includes('.atm/integrations/manifest.json'), `${adapterSpec.id} clean uninstall must remove unchanged manifest`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
