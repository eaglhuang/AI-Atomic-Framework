import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildReplayDashboardSnapshot,
  createReplayRunManifest,
  type ReplayDashboardInput,
  type ReplayDashboardRunManifest
} from '../../../../../core/src/broker/replay/dashboard.ts';

export interface ReplayDashboardViewModelOptions {
  readonly cwd: string;
  readonly surfaces: readonly string[];
  readonly actorId?: string | null;
  readonly taskId?: string | null;
}

export function buildReplayDashboardViewModel(options: ReplayDashboardViewModelOptions) {
  const input = buildReplayDashboardInput(options);
  return {
    snapshot: buildReplayDashboardSnapshot(input),
    human: null
  };
}

export function buildReplayRunManifestViewModel(options: ReplayDashboardViewModelOptions): ReplayDashboardRunManifest {
  return createReplayRunManifest(buildReplayDashboardInput(options));
}

export function buildReplayDashboardInput(options: ReplayDashboardViewModelOptions): ReplayDashboardInput {
  const sharedPhysicalFile = normalizePath(options.surfaces[0] ?? 'docs/governance/atm-3-replay-evidence.md');
  const headDigest = gitValue(options.cwd, ['rev-parse', 'HEAD']) ?? digestText('unknown-head');
  const baseDigest = gitValue(options.cwd, ['merge-base', 'HEAD', 'origin/main']) ?? headDigest;
  const runnerDigest = digestFile(path.join(options.cwd, 'atm.mjs')) ?? digestText('missing-runner');
  const buildDigest = digestFile(path.join(options.cwd, 'dist', 'cli', 'atm-cli.mjs')) ?? runnerDigest;
  const root = normalizePath(gitValue(options.cwd, ['rev-parse', '--show-toplevel']) ?? options.cwd);
  const actorA = options.actorId?.trim() || process.env.ATM_ACTOR_ID || 'atm-replay-captain-a';
  const actorB = actorA.endsWith('-a') ? `${actorA.slice(0, -2)}-b` : `${actorA}-peer`;
  const taskId = options.taskId?.trim() || process.env.ATM_TASK_ID || 'atm-replay-observation';
  const runId = `replay-dashboard-${digestText(`${root}:${headDigest}:${sharedPhysicalFile}`).slice(7, 19)}`;
  const policyDigest = digestText('atm.replay.dashboard.validator-policy.v1');
  const unionDigest = digestText(JSON.stringify([
    'claim-close-observations',
    'parallel-admission-observations',
    'validator-output-digests',
    'authority-lane-observations',
    'safe-compose-vs-true-conflict'
  ]));
  const selectionInputDigest = digestText(JSON.stringify({ sharedPhysicalFile, headDigest, taskId }));
  const logicalIntents = [
    {
      intentId: `${taskId}:logical-intent-a`,
      physicalPath: sharedPhysicalFile,
      digest: digestText(`${taskId}:a:${sharedPhysicalFile}:${headDigest}`),
      privateOutputDigest: digestText(`${taskId}:a:private-output`),
      proposalRoot: '.atm/runtime/broker-proposals'
    },
    {
      intentId: `${taskId}:logical-intent-b`,
      physicalPath: sharedPhysicalFile,
      digest: digestText(`${taskId}:b:${sharedPhysicalFile}:${headDigest}`),
      privateOutputDigest: digestText(`${taskId}:b:private-output`),
      proposalRoot: '.atm/runtime/broker-proposals'
    }
  ];
  return {
    runId,
    generatedAt: new Date(0).toISOString(),
    participants: [
      {
        participantId: 'captain-a',
        provider: 'data',
        role: 'captain',
        taskId,
        actorId: actorA,
        processId: process.pid,
        laneSessionId: process.env.ATM_LANE_SESSION_ID ?? null,
        worktreeRoot: root,
        baseDigest,
        headDigest,
        buildDigest,
        runnerDigest,
        selectedTaskIds: [taskId],
        queuedTaskIds: [],
        ticketDigest: digestText(`${taskId}:ticket:a`),
        ticketGeneration: 1,
        waitedMs: 0,
        wakeup: 'auto',
        authority: { lane: process.env.ATM_LANE_SESSION_ID ?? null, takeover: false, borrowedActor: false },
        producerLabel: 'ignored'
      },
      {
        participantId: 'captain-b',
        provider: 'data',
        role: 'captain',
        taskId,
        actorId: actorB,
        processId: `${process.pid}:peer`,
        laneSessionId: 'sealed-peer-lane',
        worktreeRoot: root,
        baseDigest,
        headDigest,
        buildDigest,
        runnerDigest,
        selectedTaskIds: [],
        queuedTaskIds: [taskId],
        ticketDigest: digestText(`${taskId}:ticket:b`),
        ticketGeneration: 1,
        waitedMs: 1,
        wakeup: 'auto',
        authority: { lane: 'sealed-peer-lane', takeover: false, borrowedActor: false },
        producerLabel: 'ignored'
      }
    ],
    sharedPhysicalFile,
    logicalIntents,
    validatorSeal: {
      policyDigest,
      unionDigest,
      selectionInputDigest,
      negativeControlRevealedAt: new Date(0).toISOString(),
      currentUnionDigest: unionDigest
    },
    thresholds: {
      minimumParticipants: 2,
      minimumDistinctActors: 2,
      minimumDistinctProcesses: 2
    },
    timeWindow: { startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString() },
    stopRule: 'stop when all closure-critical predicates are pass or any fail-closed predicate fails',
    admissionFacadeDisposition: 'required',
    adapterDecision: 'canonical-evidence-only',
    candidateOutputDigests: logicalIntents.map((entry) => entry.privateOutputDigest ?? entry.digest),
    validatorRunDigests: [policyDigest, unionDigest, selectionInputDigest],
    commands: ['node atm.mjs broker replay dashboard --json', 'node atm.mjs broker replay manifest --json'],
    usageErrors: [],
    continuations: [],
    terminalPrunes: [],
    manualInterventions: [],
    falseStops: [],
    unavailableReceipts: [],
    cleanupRequired: false,
    manualRecoveryRequired: false,
    safeCompose: true,
    staleFallbackUsed: false,
    trueConflict: false,
    publication: {
      status: 'source-available',
      sourceAvailable: existsSync(path.join(options.cwd, 'packages', 'core', 'src', 'broker', 'replay', 'dashboard.ts')),
      costRatio: 1,
      throughputGainRatio: 1
    },
    receipts: {
      taskLane0022: 'tracked-by-input-receipts',
      atmGov0265: 'tracked-by-input-receipts'
    },
    admissionTrace: ['identity', 'scope', 'ticket', 'queue', 'compose', 'validator', 'close']
  };
}

function gitValue(cwd: string, argv: readonly string[]): string | null {
  const result = spawnSync('git', [...argv], { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function digestFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return digestText(readFileSync(filePath, 'utf8'));
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/');
}
