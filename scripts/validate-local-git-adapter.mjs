import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'adapter-local-git.fixture.json'), 'utf8'));
const adapterModule = await import(pathToFileURL(path.join(root, fixture.entrypoint)).href);

function fail(message) {
  console.error(`[adapter-local-git:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function assertResultShape(result, operation) {
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

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-local-git-'));
try {
  const repositoryRoot = path.join(tempRoot, 'repo');
  const adapter = adapterModule.createLocalGitAdapter();
  const context = {
    repositoryRoot,
    actor: 'fixture-agent',
    now: '2026-01-01T00:00:00.000Z'
  };

  assert(adapter.adapterName === '@ai-atomic-framework/adapter-local-git', 'adapter name mismatch');
  assert(adapter.defaultConfig.registryPath === fixture.registryPath, 'default registry path mismatch');
  assert(adapter.resolveRegistryPath(context).endsWith(path.join('repo', '.atm', 'registry')), 'relative registry path did not resolve under repository root');

  const dryRunContext = {
    repositoryRoot: path.join(tempRoot, 'dry-run-repo'),
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
  assert(doc.evidence.some((entry) => entry.evidenceKind === 'handoff'), 'doc no-op must expose handoff evidence');

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
    config: { registryPath: absoluteRegistryPath }
  };
  assert(adapter.resolveRegistryPath(absoluteContext) === path.normalize(absoluteRegistryPath), 'absolute registry path must be preserved');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[adapter-local-git:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}