import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createTempWorkspace } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'adapter-local-git.fixture.json'), 'utf8'));
const adapterModule = await import(pathToFileURL(path.join(root, fixture.entrypoint)).href);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(JSON.parse(readFileSync(path.join(root, 'schemas', 'governance', 'adapter-report.schema.json'), 'utf8')), 'governance-adapter-report');
const validateAtomizeAdapter = ajv.compile(JSON.parse(readFileSync(path.join(root, 'schemas', 'governance', 'atomize-adapter.schema.json'), 'utf8')));
const validateInfectAdapter = ajv.compile(JSON.parse(readFileSync(path.join(root, 'schemas', 'governance', 'infect-adapter.schema.json'), 'utf8')));

function fail(message: any) {
  console.error(`[adapter-local-git:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function assertResultShape(result: any, operation: any) {
  assert(typeof result.adapterName === 'string', `${operation} result missing adapterName`);
  assert(typeof result.lifecycleMode === 'string', `${operation} result missing lifecycleMode`);
  assert(result.operation === operation, `${operation} result operation mismatch`);
  assert(typeof result.ok === 'boolean', `${operation} result missing ok boolean`);
  assert(typeof result.dryRun === 'boolean', `${operation} result missing dryRun boolean`);
  assert(typeof result.noop === 'boolean', `${operation} result missing noop boolean`);
  assert(Array.isArray(result.messages), `${operation} result missing messages array`);
  assert(Array.isArray(result.evidence), `${operation} result missing evidence array`);
  assert(Array.isArray(result.lockRecords), `${operation} result missing lockRecords array`);
  assert(Array.isArray(result.artifacts), `${operation} result missing artifacts array`);
  assert(typeof result.registryPath === 'string', `${operation} result missing registryPath`);
}

function schemaDocumentFor(result: any, schemaId: any) {
  return {
    schemaId,
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Adapter runtime validation fixture.'
    },
    ...result
  };
}

const tempRoot = createTempWorkspace('atm-local-git-');
try {
  const repositoryRoot = path.join(tempRoot, 'repo');
  const adapter = adapterModule.createLocalGitAdapter();
  const context = {
    repositoryRoot,
    lifecycleMode: 'evolution',
    actor: 'fixture-agent',
    now: '2026-01-01T00:00:00.000Z'
  };

  assert(adapter.adapterName === '@ai-atomic-framework/adapter-local-git', 'adapter name mismatch');
  assert(adapter.defaultConfig.registryPath === fixture.registryPath, 'default registry path mismatch');
  assert(adapter.resolveRegistryPath(context).endsWith(path.join('repo', '.atm', 'registry')), 'relative registry path did not resolve under repository root');
  assert(Array.isArray(adapter.listHostGates(context)), 'local-git adapter must expose host gates array');
  assert(adapter.listHostGates(context).length === 0, 'local-git adapter host gates must default to empty');
  assert(Array.isArray(adapter.listNoTouchZones(context)), 'local-git adapter must expose no-touch zones array');
  assert(adapter.listNoTouchZones(context).length === 0, 'local-git adapter no-touch zones must default to empty');
  const mutationPolicy = adapter.resolveMutationPolicy(context);
  assert(mutationPolicy.requireSession === true, 'local-git mutation policy must require guidance session');
  assert(mutationPolicy.requireDryRunProposal === true, 'local-git mutation policy must require dry-run proposal');
  assert(mutationPolicy.requireReviewBeforeApply === true, 'local-git mutation policy must require review before apply');
  assert(mutationPolicy.allowUnguidedInCI === false, 'local-git mutation policy must forbid unguided CI mutation');

  const dryRunContext = {
    repositoryRoot: path.join(tempRoot, 'dry-run-repo'),
    lifecycleMode: 'evolution',
    config: { dryRun: true }
  };
  const dryRunScaffold = adapter.scaffold(dryRunContext);
  assertResultShape(dryRunScaffold, 'scaffold');
  assert(dryRunScaffold.dryRun === true, 'dry-run scaffold must report dryRun=true');
  assert(dryRunScaffold.mode === 'dry-run', 'dry-run scaffold must use dry-run mode');
  assert(!existsSync(path.join(dryRunContext.repositoryRoot, fixture.registryPath)), 'dry-run scaffold must not write registry directory');

  const scaffold = adapter.scaffold(context);
  assertResultShape(scaffold, 'scaffold');
  assert(scaffold.ok === true, 'scaffold must succeed');
  assert(scaffold.noop === false, 'scaffold is a filesystem operation, not a no-op');
  assert(existsSync(path.join(repositoryRoot, fixture.registryPath)), 'scaffold must create registry directory');
  assert(existsSync(path.join(repositoryRoot, fixture.reportsPath)), 'scaffold must create reports directory');

  const lock = adapter.lockScope(context, fixture.workItem, ['src/example.ts']);
  assertResultShape(lock, 'lock');
  assert(lock.ok === true, 'lock no-op must succeed');
  assert(lock.noop === true, 'lock must be explicit no-op');
  assert(lock.lockRecords[0]?.workItemId === fixture.workItem.workItemId, 'lock result must include in-memory lock record');
  assert(lock.lockRecords[0]?.lockedBy === 'fixture-agent', 'lock result must preserve actor');

  const gate = adapter.runGate(context, fixture.workItem);
  assertResultShape(gate, 'gate');
  assert(gate.ok === true, 'gate no-op must succeed');
  assert(gate.noop === true, 'gate must be explicit no-op');

  const doc = adapter.writeDocRecord(context, fixture.workItem, 'Fixture handoff summary.');
  assertResultShape(doc, 'doc');
  assert(doc.ok === true, 'doc no-op must succeed');
  assert(doc.noop === true, 'doc must be explicit no-op');
  assert(doc.evidence.some((entry: any) => entry.evidenceKind === 'handoff'), 'doc no-op must expose handoff evidence');

  const legacyResolution = adapter.resolveLegacyUri(context, fixture.legacyUri);
  assert(legacyResolution.scheme === 'legacy', 'legacy URI must resolve with legacy scheme');
  assert(legacyResolution.repositoryAlias === 'repo', 'legacy URI must preserve repository alias');
  assert(legacyResolution.relativePath === 'src/legacy-source.ts', 'legacy URI must preserve relative path');
  assert(legacyResolution.lineStart === 5 && legacyResolution.lineEnd === 8, 'legacy URI must preserve line fragment');
  assert(legacyResolution.absolutePath.endsWith(path.join('repo', 'src', 'legacy-source.ts')), 'legacy URI must resolve under repository root');

  const atomizeAdapter = adapter.runAtomizeAdapter(context, fixture.atomizeRequest);
  assertResultShape(atomizeAdapter, 'adapter');
  assert(atomizeAdapter.ok === true, 'atomize adapter dry-run must succeed for neutral payload');
  assert(atomizeAdapter.mode === 'dry-run', 'atomize adapter must always stay in dry-run mode');
  assert(atomizeAdapter.dryRunPatch.behaviorId === 'behavior.atomize', 'atomize adapter must preserve behaviorId');
  assert(atomizeAdapter.dryRunPatch.applyToHostProject === false, 'atomize adapter must forbid host mutation');
  assert(atomizeAdapter.neutrality.ok === true, 'atomize adapter must report neutrality pass for clean payload');
  assert(validateAtomizeAdapter(schemaDocumentFor(atomizeAdapter, 'atm.atomizeAdapter')) === true, `atomize adapter schema mismatch: ${ajv.errorsText(validateAtomizeAdapter.errors)}`);

  const infectAdapter = adapter.runInfectAdapter(context, fixture.infectRequest);
  assertResultShape(infectAdapter, 'adapter');
  assert(infectAdapter.ok === false, 'infect adapter must fail on adopter-private payload');
  assert(infectAdapter.dryRunPatch.behaviorId === 'behavior.infect', 'infect adapter must preserve behaviorId');
  assert(infectAdapter.neutrality.ok === false, 'infect adapter must surface neutrality failure');
  assert(infectAdapter.neutrality.violationCount > 0, 'infect adapter must report neutrality violations');
  assert(validateInfectAdapter(schemaDocumentFor(infectAdapter, 'atm.infectAdapter')) === true, `infect adapter schema mismatch: ${ajv.errorsText(validateInfectAdapter.errors)}`);

  const registryWrite = adapter.writeRegistryEntry(context, fixture.registryEntry);
  assertResultShape(registryWrite, 'registry');
  assert(registryWrite.ok === true, 'registry write must succeed');
  assert(registryWrite.noop === false, 'registry write must be a filesystem operation');
  const registryEntryPath = path.join(repositoryRoot, fixture.registryPath, 'atom.fixture.json');
  assert(existsSync(registryEntryPath), 'registry write must create entry file');
  const registryRead = adapter.readRegistryEntry(context, fixture.registryEntry.id);
  assert(registryRead?.id === fixture.registryEntry.id, 'registry read must return written entry');

  const absoluteRegistryPath = path.join(tempRoot, 'absolute-registry');
  const absoluteContext = {
    repositoryRoot,
    lifecycleMode: 'evolution',
    config: { registryPath: absoluteRegistryPath }
  };
  assert(adapter.resolveRegistryPath(absoluteContext) === path.normalize(absoluteRegistryPath), 'absolute registry path must be preserved');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[adapter-local-git:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}
