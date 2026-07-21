// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeResult, message } from '../shared.ts';
import type { ParsedBrokerOptions } from './parser.ts';
import {
  runFrozenParallelReplay,
  runRuntimeDogfoodLifecycle,
  selectRuntimeDogfoodTasks
} from './replay/implementation.ts';

const defaultIntersection = ['docs/governance/atm-3-replay-evidence.md'];

export async function handleBrokerReplayActions(options: ParsedBrokerOptions) {
  if (options.action !== 'replay') return null;
  const action = options.replayAction ?? 'status';
  if (action === 'status') return brokerReplayStatus(options);
  if (action === 'run') return brokerReplayRun(options);
  if (action === 'dogfood') return brokerReplayDogfood(options);
  return makeResult({
    ok: false,
    command: 'broker',
    cwd: options.cwd,
    messages: [
      message('error', 'ATM_CLI_USAGE', 'broker replay supports: status, run, dogfood.', {
        supportedActions: ['status', 'run', 'dogfood']
      })
    ],
    evidence: { action: 'replay-usage' }
  });
}

function brokerReplayStatus(options: ParsedBrokerOptions) {
  const requiredIntersection = requiredReplayIntersection(options);
  const dogfoodCandidates = selectRuntimeDogfoodTasks({
    cwd: options.cwd,
    requiredIntersection,
    minimum: 2
  });
  const matrix = inspectCommandBackedMatrix(options.cwd);
  const blockers = [
    ...(dogfoodCandidates.length >= 2 ? [] : [`real-dogfood-registered-candidates: found ${dogfoodCandidates.length}/2 registered planned/ready/running task candidates with declared intersection`]),
    ...(matrix.cellCount === 420 && matrix.commandBackedCount === 420 ? [] : [`command-backed-420-cell-matrix: ${matrix.cellCount} cells found, ${matrix.commandBackedCount}/420 include command/workload receipt evidence`])
  ];
  return makeResult({
    ok: blockers.length === 0,
    command: 'broker',
    cwd: options.cwd,
    messages: [
      message(blockers.length === 0 ? 'info' : 'warn', blockers.length === 0 ? 'ATM_BROKER_REPLAY_STATUS_READY' : 'ATM_BROKER_REPLAY_STATUS_REMAIN_OPEN', blockers.length === 0
        ? 'Broker replay closure prerequisites are present.'
        : 'Broker replay closure prerequisites are incomplete; Plan 3 remains open.', {
        blockerCount: blockers.length
      })
    ],
    evidence: {
      schemaId: 'atm.brokerReplayStatus.v1',
      action: 'replay-status',
      verdict: blockers.length === 0 ? 'ready-to-close' : 'remain-open',
      blockers,
      requiredIntersection,
      realDogfood: {
        requiredTaskCount: 2,
        candidateCount: dogfoodCandidates.length,
        candidates: dogfoodCandidates
      },
      publicFrozenCliSurface: {
        command: 'node atm.mjs broker replay status --json',
        actions: ['status', 'run', 'dogfood']
      },
      commandBackedMatrix: matrix
    }
  });
}

async function brokerReplayRun(options: ParsedBrokerOptions) {
  const evidence = await runFrozenParallelReplay({
    cwd: options.cwd,
    workerCount: 3,
    runnerPath: 'atm.mjs'
  });
  return makeResult({
    ok: evidence.verdict === 'pass',
    command: 'broker',
    cwd: options.cwd,
    messages: [
      message(evidence.verdict === 'pass' ? 'info' : 'warn', 'ATM_BROKER_REPLAY_RUN_COMPLETE', 'Controlled frozen broker replay run completed.', {
        verdict: evidence.verdict,
        workerCount: evidence.workerCount,
        commandReceiptCount: evidence.workerReceipts.reduce((count, worker) => count + (worker.commandReceipts?.length ?? 0), 0)
      })
    ],
    evidence: {
      action: 'replay-run',
      replayEvidence: evidence,
      closureWarning: 'Controlled replay is not final Plan 3 closure evidence without real dogfood and command-backed 420-cell matrix.'
    }
  });
}

async function brokerReplayDogfood(options: ParsedBrokerOptions) {
  const requiredIntersection = requiredReplayIntersection(options);
  try {
    const dogfood = await runRuntimeDogfoodLifecycle({
      cwd: options.cwd,
      requiredIntersection,
      runnerPath: 'atm.mjs',
      minimum: 2
    });
    return makeResult({
      ok: dogfood.evidence.terminalRefusalCount === 0 && dogfood.evidence.taskCount >= 2,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_REPLAY_DOGFOOD_COMPLETE', 'Runtime dogfood lifecycle replay completed.', {
          taskCount: dogfood.evidence.taskCount,
          actorCount: dogfood.evidence.actorCount
        })
      ],
      evidence: {
        action: 'replay-dogfood',
        dogfoodEvidence: dogfood.evidence,
        workerReceipts: dogfood.workerReceipts
      }
    });
  } catch (error) {
    return makeResult({
      ok: false,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_BROKER_REPLAY_DOGFOOD_BLOCKED', error instanceof Error ? error.message : String(error), {
          requiredIntersection
        })
      ],
      evidence: {
        action: 'replay-dogfood',
        verdict: 'remain-open',
        blockers: [error instanceof Error ? error.message : String(error)],
        requiredIntersection
      }
    });
  }
}

function requiredReplayIntersection(options: ParsedBrokerOptions): readonly string[] {
  const surfaces = options.surfaces.map((entry) => String(entry).trim()).filter(Boolean);
  return surfaces.length > 0 ? surfaces : defaultIntersection;
}

function inspectCommandBackedMatrix(cwd: string) {
  const cellsPath = path.join(cwd, 'artifacts/generated/atm-ab-v4/cells.json');
  if (!existsSync(cellsPath)) {
    return {
      cellsPath: 'artifacts/generated/atm-ab-v4/cells.json',
      cellCount: 0,
      commandBackedCount: 0,
      missing: true
    };
  }
  const cells = JSON.parse(readFileSync(cellsPath, 'utf8'));
  const cellArray = Array.isArray(cells) ? cells : [];
  const commandBackedCount = cellArray.filter((cell) =>
    Array.isArray(cell?.commandReceipts) ||
    Array.isArray(cell?.workloadReceipts) ||
    typeof cell?.commandDigest === 'string'
  ).length;
  return {
    cellsPath: 'artifacts/generated/atm-ab-v4/cells.json',
    cellCount: cellArray.length,
    commandBackedCount,
    missing: false
  };
}
