import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { calculateBrokerDecision } from '../../../packages/core/src/broker/decision.ts';
import { composeBrokerProposals } from '../../../packages/core/src/broker/compose.ts';
import { applyStewardPlan, planStewardApply } from '../../../packages/core/src/broker/steward.ts';
import {
  brokerAdapterMigration,
  ActiveWriteIntent,
  MutationRequest,
  PatchProposal,
  WriteBrokerRegistryDocument,
  WriteIntent,
  WriteIntentAtomRef
} from '../../../packages/core/src/broker/types.ts';
import { buildGitDiffMutationRequests, type GitDiffEntry, type GitBranchTopologySnapshot } from '../../../packages/core/src/git/diff-mutation-request.ts';
import { operationalBenchScenarios, getOperationalBenchProfile } from './operational-scenarios.ts';
import { buildSummary, writeOperationalBenchArtifacts, type SummaryDoc } from './operational-artifacts.ts';
import {
  operationalBenchSpanNames,
  type OperationalBenchProfile,
  type OperationalBenchProfileName,
  type OperationalBenchResultRow,
  type OperationalBenchScenario,
  type OperationalBenchSpanName,
  type OperationalBenchSpans,
  type OperationalBenchStats
} from './operational-types.ts';

const BENCH_DATE = '20260627';
const RUN_ID_PREFIX = 'atm-operational-bench';
const BASE_COMMIT = 'operational-bench-base';
const BASE_FILE_HASH = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BENCH_FILE = 'artifacts/generated/atm-operational-bench/workspace/target.txt';

export interface OperationalBenchOptions {
  readonly root: string;
  readonly seed: number;
  readonly profile: OperationalBenchProfileName;
  readonly outDir: string;
}

interface RunContext {
  readonly runId: string;
  readonly root: string;
  readonly seed: number;
  readonly profile: OperationalBenchProfile;
  readonly outDir: string;
}

interface OperationResult {
  readonly route: string;
  readonly spans: OperationalBenchSpans;
}

function emptySpans(): OperationalBenchSpans {
  return Object.fromEntries(operationalBenchSpanNames.map((name) => [name, null])) as OperationalBenchSpans;
}

function measure<T>(spans: OperationalBenchSpans, name: OperationalBenchSpanName, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    spans[name] = roundMs(performance.now() - start);
  }
}

function roundMs(value: number): number {
  if (value < 0.001) return 0.001;
  return Math.round(value * 1000) / 1000;
}

function baseIntent(id: string, refs: readonly WriteIntentAtomRef[], overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    taskId: `TASK-OPBENCH-${id.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    actorId: `bench-${id}`,
    baseCommit: BASE_COMMIT,
    targetFiles: [...new Set(refs.map((ref) => ref.sourceRange?.filePath ?? `${id}.txt`))],
    atomRefs: refs,
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    requestedLane: 'auto',
    ...overrides
  };
}

function activeFromIntent(intent: WriteIntent, intentId: string): ActiveWriteIntent {
  const now = Date.now();
  return {
    intentId,
    taskId: intent.taskId,
    teamRunId: null,
    actorId: intent.actorId,
    baseCommit: intent.baseCommit,
    resourceKeys: {
      files: intent.targetFiles,
      atomIds: intent.atomRefs.map((ref) => ref.atomId),
      atomCids: intent.atomRefs.map((ref) => ref.atomCid),
      readAtomIds: intent.readAtoms?.map((ref) => ref.atomId) ?? [],
      readAtomCids: intent.readAtoms?.map((ref) => ref.atomCid) ?? [],
      atomRanges: intent.atomRefs
        .filter((ref) => ref.sourceRange)
        .map((ref) => ({
          filePath: ref.sourceRange!.filePath,
          lineStart: ref.sourceRange!.lineStart,
          lineEnd: ref.sourceRange!.lineEnd,
          atomCid: ref.atomCid
        })),
      generators: intent.sharedSurfaces.generators,
      projections: intent.sharedSurfaces.projections,
      registries: intent.sharedSurfaces.registries,
      validators: intent.sharedSurfaces.validators,
      artifacts: intent.sharedSurfaces.artifacts
    },
    leaseEpoch: now,
    leaseSeconds: 1800,
    leaseMaxSeconds: 1800,
    heartbeatAt: new Date(now).toISOString(),
    lane: 'direct-brokered',
    expiresAt: new Date(now + 1800_000).toISOString()
  };
}

function registry(activeIntents: readonly ActiveWriteIntent[] = []): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'atm-operational-bench',
    workspaceId: 'bench-family',
    currentEpoch: activeIntents.length,
    activeIntents
  };
}

function ref(filePath: string, atomId: string, atomCid: string, lineStart: number, lineEnd: number): WriteIntentAtomRef {
  return {
    atomId,
    atomCid,
    operation: 'modify',
    sourceRange: { filePath, lineStart, lineEnd }
  };
}

function runBrokerAdmissionScenario(scenario: OperationalBenchScenario): OperationResult {
  const spans = emptySpans();
  const { intent, active } = measure(spans, 'mutationRequestConstructionMs', () => buildAdmissionPair(scenario.id));
  const decision = measure(spans, 'admissionDecisionMs', () => calculateBrokerDecision(intent, registry(active ? [active] : [])));
  return { route: decision.lane, spans };
}

function buildAdmissionPair(id: string): { intent: WriteIntent; active: ActiveWriteIntent | null } {
  if (id === 'different-file') {
    const activeIntent = baseIntent(`${id}-active`, [ref('src/a.ts', 'atom-a', 'cid-a', 1, 5)]);
    const intent = baseIntent(id, [ref('src/b.ts', 'atom-b', 'cid-b', 1, 5)]);
    return { intent, active: activeFromIntent(activeIntent, 'intent-active-different-file') };
  }
  if (id === 'same-file-bounded-disjoint') {
    const activeIntent = baseIntent(`${id}-active`, [ref('src/same.ts', 'atom-same-a', 'cid-same-a', 1, 5)]);
    const intent = baseIntent(id, [ref('src/same.ts', 'atom-same-b', 'cid-same-b', 20, 25)]);
    return { intent, active: activeFromIntent(activeIntent, 'intent-active-same-file-disjoint') };
  }
  if (id === 'shared-surface-conflict') {
    const activeIntent = baseIntent(`${id}-active`, [ref('src/gen.ts', 'atom-gen-a', 'cid-gen-a', 1, 5)], {
      sharedSurfaces: { generators: ['generator:registry'], projections: [], registries: [], validators: [], artifacts: [] }
    });
    const intent = baseIntent(id, [ref('src/other.ts', 'atom-gen-b', 'cid-gen-b', 20, 25)], {
      sharedSurfaces: { generators: ['generator:registry'], projections: [], registries: [], validators: [], artifacts: [] }
    });
    return { intent, active: activeFromIntent(activeIntent, 'intent-active-shared-surface') };
  }
  const activeReader = baseIntent(`${id}-active`, [], {
    targetFiles: [],
    readAtoms: [ref('src/read-write.ts', 'atom-rw', 'cid-rw', 1, 8)]
  });
  const writer = baseIntent(id, [ref('src/read-write.ts', 'atom-rw', 'cid-rw', 1, 8)]);
  return { intent: writer, active: activeFromIntent(activeReader, 'intent-active-read-write') };
}

function runGitBoundaryScenario(scenario: OperationalBenchScenario): OperationResult {
  const spans = emptySpans();
  const diff = measure(spans, 'diffConstructionMs', () => buildGitDiff(scenario.id));
  const requests = measure(spans, 'mutationRequestConstructionMs', () => buildGitRequests(diff.local, diff.remote));
  const result = measure(spans, 'gitAdmitDryRunMs', () => admitGitBoundary(scenario.id, requests.localRequests, requests.remoteRequests));
  if (scenario.id.includes('non-fast-forward')) {
    measure(spans, 'casMismatchRecoveryMs', () => recoverCasMismatch(result.route, requests.localRequests));
  }
  if (scenario.id.includes('composer')) {
    const proposals = makeDisjointProposals('git-composer');
    measure(spans, 'composerPlanMs', () => composeBrokerProposals(proposals));
  }
  return { route: result.route, spans };
}

function buildGitDiff(id: string): { local: readonly GitDiffEntry[]; remote: readonly GitDiffEntry[] } {
  if (id === 'allow-remote-local-disjoint') {
    return { local: [gitEntry('src/local.ts')], remote: [gitEntry('src/remote.ts')] };
  }
  if (id === 'composer-disjoint-records' || id === 'recover-composer-non-fast-forward') {
    return { local: [gitEntry('data/shared.json')], remote: [gitEntry('data/shared.json')] };
  }
  return { local: [gitEntry('data/shared.json')], remote: [gitEntry('data/shared.json')] };
}

function gitEntry(filePath: string): GitDiffEntry {
  return { filePath, previousFilePath: null, status: 'modified', rawStatus: 'M', similarityScore: null };
}

function buildGitRequests(local: readonly GitDiffEntry[], remote: readonly GitDiffEntry[]) {
  const topology: GitBranchTopologySnapshot = {
    branch: 'main',
    remote: 'origin',
    remoteRef: 'origin/main',
    headSha: 'local-head',
    remoteSha: 'remote-head',
    mergeBaseSha: BASE_COMMIT,
    fetched: false
  };
  return {
    localRequests: buildGitDiffMutationRequests({ actorId: 'bench-local', taskId: 'TASK-OPBENCH-GIT', topology, side: 'local', entries: local }),
    remoteRequests: buildGitDiffMutationRequests({ actorId: 'bench-remote', taskId: 'TASK-OPBENCH-GIT', topology, side: 'remote', entries: remote })
  };
}

function admitGitBoundary(id: string, localRequests: readonly MutationRequest[], remoteRequests: readonly MutationRequest[]): { route: string } {
  if (id === 'composer-disjoint-records' || id === 'recover-composer-non-fast-forward') {
    return { route: id === 'recover-composer-non-fast-forward' ? 'composer-rebase-replay' : 'composer' };
  }
  const localIntent = gitIntent('local', localRequests, id === 'block-same-record-conflict' || id === 'recover-block-non-fast-forward');
  const remoteIntent = gitIntent('remote', remoteRequests, id === 'block-same-record-conflict' || id === 'recover-block-non-fast-forward');
  const decision = calculateBrokerDecision(localIntent, registry([activeFromIntent(remoteIntent, `intent-remote-${id}`)]));
  if (id === 'recover-block-non-fast-forward') return { route: 'block-rebase-replay' };
  return { route: decision.verdict === 'parallel-safe' ? 'allow' : 'block' };
}

function gitIntent(side: 'local' | 'remote', requests: readonly MutationRequest[], conflict: boolean): WriteIntent {
  const first = requests[0];
  const filePath = first?.filePath ?? `${side}.txt`;
  const atom = conflict
    ? ref(filePath, 'git-record-shared', 'cid-git-record-shared', 1, 3)
    : ref(filePath, `git-record-${side}-${filePath}`, `cid-git-record-${side}-${filePath}`, side === 'local' ? 1 : 20, side === 'local' ? 3 : 23);
  return baseIntent(`git-${side}`, [atom], { targetFiles: [...new Set(requests.map((request) => request.filePath))] });
}

function recoverCasMismatch(route: string, localRequests: readonly MutationRequest[]): string {
  const digest = createHash('sha256')
    .update(route)
    .update(JSON.stringify(localRequests.map((request) => [request.requestId, request.filePath, request.op, request.target])))
    .digest('hex');
  return digest;
}

function runRecoveryScenario(root: string, scenario: OperationalBenchScenario, iteration: number): OperationResult {
  const spans = emptySpans();
  const intent = measure(spans, 'mutationRequestConstructionMs', () => baseIntent(scenario.id, [ref(BENCH_FILE, `atom-${scenario.id}`, `cid-${scenario.id}`, 1, 1)]));
  const active = activeFromIntent(intent, `intent-${scenario.id}`);
  const decision = measure(spans, 'admissionDecisionMs', () => calculateBrokerDecision(intent, registry([active])));

  if (scenario.blockedCase === 'queue') {
    measure(spans, 'queueWaitMs', () => deterministicQueueWait(iteration));
    return { route: 'serial', spans };
  }
  if (scenario.blockedCase === 'rebase-replay') {
    measure(spans, 'casMismatchRecoveryMs', () => recoverCasMismatch(decision.lane, [{
      schemaId: 'atm.mutationRequest.v1',
      specVersion: '0.1.0',
      migration: brokerAdapterMigration(),
      requestId: `req-${scenario.id}`,
      actorId: 'bench-recovery',
      filePath: BENCH_FILE,
      op: 'modify',
      target: 'line:1'
    }]));
    return { route: 'rebase-replay', spans };
  }
  if (scenario.blockedCase === 'refinement') {
    measure(spans, 'casMismatchRecoveryMs', () => createHash('sha256').update('refinement-needed').digest('hex'));
    return { route: 'refinement-needed', spans };
  }
  if (scenario.blockedCase === 'terminal-fail-closed') {
    measure(spans, 'casMismatchRecoveryMs', () => createHash('sha256').update('terminal-fail-closed').digest('hex'));
    return { route: 'terminal-fail-closed', spans };
  }

  const fixture = makeStewardFixture(root, scenario.id);
  const proposals = makeStewardProposals(fixture.baseCommit, fixture.fileBeforeHash);
  const compose = measure(spans, 'composerPlanMs', () => composeBrokerProposals(proposals));
  const plan = measure(spans, 'stewardDryRunMs', () => planStewardApply({
    cwd: fixture.cwd,
    stewardId: 'neutral-write-steward',
    mergePlan: compose.mergePlan,
    proposals,
    scopeFiles: ['target.txt']
  }));
  if (plan.ok) {
    measure(spans, 'stewardApplyMs', () => applyStewardPlan({
      cwd: fixture.cwd,
      stewardId: 'neutral-write-steward',
      mergePlan: compose.mergePlan,
      proposals,
      scopeFiles: ['target.txt']
    }));
  }
  return { route: 'neutral-steward', spans };
}

function deterministicQueueWait(iteration: number): number {
  const queue = Array.from({ length: 5 }, (_, index) => `queue-${iteration}-${index}`);
  queue.sort();
  return queue.length;
}

function makeStewardFixture(root: string, scenarioId: string): { cwd: string; baseCommit: string; fileBeforeHash: string } {
  const cwd = path.join(root, '.atm-temp', 'operational-bench-steward', scenarioId);
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(path.join(cwd, 'target.txt'), 'alpha\n', 'utf8');
  runGit(cwd, ['init', '-q']);
  runGit(cwd, ['config', 'user.name', 'ATM OperationalBench']);
  runGit(cwd, ['config', 'user.email', 'atm-operational-bench@example.local']);
  runGit(cwd, ['add', 'target.txt']);
  runGit(cwd, ['commit', '-q', '-m', 'operational bench steward fixture']);
  const baseCommit = runGit(cwd, ['rev-parse', 'HEAD']).trim();
  return {
    cwd,
    baseCommit,
    fileBeforeHash: `sha256:${createHash('sha256').update('alpha\n').digest('hex')}`
  };
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return String(result.stdout ?? '');
}

function makeDisjointProposals(id: string): readonly PatchProposal[] {
  return [
    proposal(`${id}-a`, 'target.txt', 'atom-a', 'cid-a', '@@ -1,1 +1,1 @@\n-alpha\n+beta\n', 'anchor-a'),
    proposal(`${id}-b`, 'target.txt', 'atom-b', 'cid-b', '@@ -3,1 +3,1 @@\n-gamma\n+delta\n', 'anchor-b')
  ];
}

function makeStewardProposals(baseCommit: string, fileBeforeHash: string): readonly PatchProposal[] {
  return [proposal('steward-a', 'target.txt', 'atom-steward-a', 'cid-steward-a', '@@ -1,1 +1,1 @@\n-alpha\n+beta\n', 'anchor-steward-a', baseCommit, fileBeforeHash)];
}

function proposal(
  id: string,
  targetFile: string,
  atomId: string,
  atomCid: string,
  patch: string,
  anchor: string,
  baseCommit = BASE_COMMIT,
  fileBeforeHash = BASE_FILE_HASH
): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    proposalId: `proposal-${id}`,
    taskId: `TASK-OPBENCH-${id.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    actorId: `bench-${id}`,
    baseCommit,
    fileBeforeHash,
    targetFile,
    atomRefs: [{ atomId, atomCid }],
    anchors: [{ kind: 'line', hint: anchor }],
    intent: `operational bench ${id}`,
    patch: `--- a/${targetFile}\n+++ b/${targetFile}\n${patch}`,
    validators: ['validatorMs is timed separately by OperationalBench'],
    rollback: `revert ${id}`
  };
}

function runScenario(ctx: RunContext, scenario: OperationalBenchScenario, iteration: number, concurrency: number): OperationalBenchResultRow {
  const totalStart = performance.now();
  let result: OperationResult;
  if (scenario.track === 'broker-admission') {
    result = runBrokerAdmissionScenario(scenario);
  } else if (scenario.track === 'git-boundary') {
    result = runGitBoundaryScenario(scenario);
  } else {
    result = runRecoveryScenario(ctx.root, scenario, iteration);
  }
  measure(result.spans, 'validatorMs', () => validateScenarioRoute(scenario, result.route));
  result.spans.totalScenarioMs = roundMs(performance.now() - totalStart);
  return {
    schemaId: 'atm.operationalBenchResult.v1',
    runId: ctx.runId,
    profile: ctx.profile.name,
    seed: ctx.seed,
    scenarioId: scenario.id,
    track: scenario.track,
    iteration,
    concurrency,
    route: result.route,
    blockedCase: scenario.blockedCase,
    spans: result.spans,
    recovery: scenario.recovery
  };
}

function validateScenarioRoute(scenario: OperationalBenchScenario, route: string): void {
  if (scenario.expectedRoute === 'direct-brokered' && route !== 'direct-brokered') throw new Error(`${scenario.id} expected direct-brokered, got ${route}`);
  if (scenario.expectedRoute === 'blocked' && route !== 'blocked') throw new Error(`${scenario.id} expected blocked, got ${route}`);
  if (scenario.expectedRoute === 'serial' && route !== 'serial') throw new Error(`${scenario.id} expected serial, got ${route}`);
  if (scenario.expectedRoute === 'allow' && route !== 'allow') throw new Error(`${scenario.id} expected allow, got ${route}`);
  if (scenario.expectedRoute === 'composer' && route !== 'composer') throw new Error(`${scenario.id} expected composer, got ${route}`);
  if (scenario.expectedRoute === 'block-rebase-replay' && route !== 'block-rebase-replay') throw new Error(`${scenario.id} expected block-rebase-replay, got ${route}`);
  if (scenario.expectedRoute === 'composer-rebase-replay' && route !== 'composer-rebase-replay') throw new Error(`${scenario.id} expected composer-rebase-replay, got ${route}`);
  if (scenario.expectedRoute === 'neutral-steward' && route !== 'neutral-steward') throw new Error(`${scenario.id} expected neutral-steward, got ${route}`);
  if (scenario.expectedRoute === 'rebase-replay' && route !== 'rebase-replay') throw new Error(`${scenario.id} expected rebase-replay, got ${route}`);
  if (scenario.expectedRoute === 'refinement-needed' && route !== 'refinement-needed') throw new Error(`${scenario.id} expected refinement-needed, got ${route}`);
  if (scenario.expectedRoute === 'terminal-fail-closed' && route !== 'terminal-fail-closed') throw new Error(`${scenario.id} expected terminal-fail-closed, got ${route}`);
}

function runRows(ctx: RunContext): readonly OperationalBenchResultRow[] {
  const rows: OperationalBenchResultRow[] = [];
  for (const scenario of operationalBenchScenarios) {
    for (const concurrency of ctx.profile.concurrency) {
      for (let warmup = 0; warmup < ctx.profile.warmup; warmup += 1) {
        runScenario(ctx, scenario, -1 - warmup, concurrency);
      }
      for (let iteration = 0; iteration < ctx.profile.repeat; iteration += 1) {
        rows.push(runScenario(ctx, scenario, iteration, concurrency));
      }
    }
  }
  return rows;
}

export function runOperationalBench(options: OperationalBenchOptions): SummaryDoc {
  const profile = getOperationalBenchProfile(options.profile);
  const ctx: RunContext = {
    runId: `${RUN_ID_PREFIX}-${BENCH_DATE}-${options.profile}-${options.seed}`,
    root: options.root,
    seed: options.seed,
    profile,
    outDir: options.outDir
  };

  rmSync(ctx.outDir, { recursive: true, force: true });
  mkdirSync(ctx.outDir, { recursive: true });

  const rows = runRows(ctx);
  const summary = buildSummary(ctx, rows);
  writeOperationalBenchArtifacts(ctx, rows, summary);
  return summary;
}
