import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTempWorkspace } from './temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'governance-local.fixture.json'), 'utf8'));

function fail(message) {
  console.error(`[governance-local:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function writeHostFiles(hostRoot, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(hostRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2);
}

const governanceModule = await import(pathToFileURL(path.join(root, 'packages/plugin-governance-local/src/index.ts')).href);
const {
  adoptLocalGovernanceBundle,
  createLocalGovernanceAdapter,
  createOfficialBootstrapCommand,
  createRecommendedPrompt,
  createSelfHostingAlphaPrompt
} = governanceModule;

assert(createOfficialBootstrapCommand('.').includes('bootstrap --cwd .'), 'official bootstrap command must target the CLI bootstrap entrypoint');
assert(createRecommendedPrompt().includes('node atm.mjs next --json'), 'recommended prompt must route through next');
assert(createSelfHostingAlphaPrompt().includes('node atm.mjs next --json'), 'self-hosting alpha prompt must route through next');

const exampleReadme = readFileSync(path.join(root, 'examples/agent-bootstrap/README.md'), 'utf8');
assert(exampleReadme.includes('packages/plugin-governance-local/'), 'agent bootstrap example must mention the local governance package');
assert(exampleReadme.includes('.atm/history/reports/'), 'agent bootstrap example must mention the history reports store');

const tempRoot = createTempWorkspace('atm-governance-local-');
try {
  const hostRepo = path.join(tempRoot, 'host');
  mkdirSync(hostRepo, { recursive: true });
  writeHostFiles(hostRepo, fixture.hostFiles);

  const bootstrap = adoptLocalGovernanceBundle(hostRepo, {
    taskTitle: fixture.bootstrapTaskTitle
  });
  assert(bootstrap.adoptedProfile === 'default', 'bundle adoption must report adoptedProfile=default');
  for (const relativePath of fixture.expectedPaths) {
    assert(existsSync(path.join(hostRepo, relativePath)), `bundle adoption must create ${relativePath}`);
  }

  const adapter = createLocalGovernanceAdapter({
    repositoryRoot: hostRepo,
    now: () => fixture.timestamp
  });
  const { stores } = adapter;
  assert(adapter.adapterName === '@ai-atomic-framework/plugin-governance-local', 'adapterName must identify the governance local package');
  assert(adapter.layout.root === '.atm', 'adapter layout root must remain .atm');

  const createdTask = stores.taskStore.createTask(fixture.workItem);
  assert(createdTask.workItemId === fixture.workItem.workItemId, 'task store must preserve workItemId');
  assert(stores.taskStore.getTask(fixture.workItem.workItemId)?.title === fixture.workItem.title, 'task store must read back the stored task');
  stores.taskStore.updateTaskStatus(fixture.workItem.workItemId, 'locked');
  assert(stores.taskStore.listTasks().some((task) => task.workItemId === fixture.workItem.workItemId), 'task store must list the stored task');

  const lock = stores.lockStore.acquireLock(fixture.workItem, fixture.lockFiles, fixture.actor);
  assert(lock.lockedBy === fixture.actor, 'lock store must preserve the actor name');
  assert(lock.files.length === fixture.lockFiles.length, 'lock store must preserve scoped files');
  assert(stores.lockStore.getLock(fixture.workItem.workItemId)?.files.length === fixture.lockFiles.length, 'lock store must read back the lock record');
  stores.lockStore.releaseLock(fixture.workItem.workItemId, fixture.actor);
  const releasedLock = JSON.parse(readFileSync(path.join(hostRepo, '.atm/runtime/locks', `${fixture.workItem.workItemId}.lock.json`), 'utf8'));
  assert(releasedLock.released === true, 'lock release must persist a released marker');

  stores.documentIndex.updateDocument(fixture.document.path, fixture.document.metadata);
  assert(stores.documentIndex.resolveDocumentId(fixture.document.metadata.documentId) === fixture.document.path, 'document index must resolve documentId to path');
  assert(stores.documentIndex.searchDocuments('governance').includes(fixture.document.path), 'document index search must return the indexed document');

  stores.shardStore.writeShard(fixture.shard.path, fixture.shard.value);
  assert(stableStringify(stores.shardStore.readShard(fixture.shard.path)) === stableStringify(fixture.shard.value), 'shard store must round-trip JSON shard values');
  stores.shardStore.rebuildIndex(fixture.shard.indexPath);
  assert(existsSync(path.join(hostRepo, fixture.shard.indexPath)), 'shard store must rebuild an index file');

  const artifactRecord = stores.artifactStore.writeArtifact(fixture.artifact, `${JSON.stringify({ ok: true }, null, 2)}\n`);
  assert(artifactRecord.artifactPath === fixture.artifact.artifactPath, 'artifact store must return the original record');
  assert(existsSync(path.join(hostRepo, fixture.artifact.artifactPath)), 'artifact store must write the artifact file');
  assert(stores.artifactStore.listArtifacts(fixture.workItem.workItemId).length === 1, 'artifact store must list artifacts for the work item');

  stores.logStore.appendLog(fixture.workItem.workItemId, 'local governance smoke passed');
  assert(stores.logStore.readLog(fixture.workItem.workItemId).includes('local governance smoke passed'), 'log store must read back appended log content');

  stores.runReportStore.writeRunReport(fixture.runReport.reportId, fixture.runReport.report);
  assert(stableStringify(stores.runReportStore.readRunReport(fixture.runReport.reportId)) === stableStringify(fixture.runReport.report), 'run report store must round-trip the report payload');

  stores.stateStore.writeMarkdown(fixture.state.markdownPath, fixture.state.markdownContent);
  assert(stores.stateStore.readMarkdown(fixture.state.markdownPath) === fixture.state.markdownContent, 'state store must round-trip markdown content');
  stores.stateStore.writeJson(fixture.state.jsonPath, fixture.state.jsonValue);
  assert(stableStringify(stores.stateStore.readJson(fixture.state.jsonPath)) === stableStringify(fixture.state.jsonValue), 'state store must round-trip JSON content');

  const guardResult = stores.ruleGuard.runGuard(fixture.ruleGuard.guardId, fixture.ruleGuard.context);
  assert(guardResult.ok === true, 'rule guard store must report ok=true');
  assert(existsSync(path.join(hostRepo, '.atm/runtime/rules', `${fixture.ruleGuard.guardId}.json`)), 'rule guard must write a report file');

  stores.evidenceStore.writeEvidence(fixture.workItem.workItemId, fixture.evidence);
  assert(stores.evidenceStore.listEvidence(fixture.workItem.workItemId).length === 1, 'evidence store must list the recorded evidence');

  const registry = stores.registryStore.readRegistry();
  assert(registry.schemaId === 'atm.registry', 'registry store must initialize a default registry document');

  const seededPolicy = stores.contextBudgetGuard.readPolicy();
  assert(seededPolicy?.policyId === 'default-policy', 'context budget guard must seed a default policy');
  stores.contextBudgetGuard.writePolicy(fixture.contextBudget.policy);
  assert(stableStringify(stores.contextBudgetGuard.readPolicy(fixture.contextBudget.policy.policyId)) === stableStringify(fixture.contextBudget.policy), 'context budget guard must round-trip policy records');
  const budgetEvaluation = stores.contextBudgetGuard.evaluateBudget(fixture.contextBudget.evaluation);
  assert(budgetEvaluation.decision === 'summarize-before-continue', 'context budget guard must request summary when estimated load exceeds the summarize threshold');
  assert(existsSync(path.join(hostRepo, budgetEvaluation.reportPath)), 'context budget guard must write a report file');
  assert(typeof budgetEvaluation.summaryPath === 'string' && existsSync(path.join(hostRepo, budgetEvaluation.summaryPath)), 'context budget guard must write a summary file when summarization is required');

  stores.contextSummaryStore.writeSummary(fixture.summary);
  assert(stableStringify(stores.contextSummaryStore.readSummary(fixture.summary.workItemId)) === stableStringify(fixture.summary), 'context summary store must round-trip summary records');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[governance-local:${mode}] ok (local bundle adoption and store surface verified)`);
}
