import path from 'node:path';
import { calculateBrokerDecision } from './decision.ts';
import { buildVirtualAtomInUseRegistry, loadRegistry } from './registry.ts';
import { readGitHeadCommit } from './steward.ts';
import type { BrokerDecision, WriteIntent, WriteIntentAtomRef } from './types.ts';
import type { VirtualAtomInUseRegistryDocument } from './registry.ts';

export const DEFAULT_TEAM_STEWARD_ID = 'neutral-write-steward';
export const DEFAULT_BROKER_REGISTRY_RELATIVE_PATH = '.atm/runtime/write-broker.registry.json';

export type TeamBrokerChosenLane =
  | 'direct-brokered'
  | 'deterministic-composer'
  | 'neutral-steward'
  | 'serial'
  | 'blocked';

export interface TeamBrokerLaneEvidence {
  readonly schemaId: 'atm.teamBrokerLaneEvidence.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly actorId: string;
  readonly registryPath: string;
  readonly writeIntent: WriteIntent;
  readonly decision: BrokerDecision;
  readonly virtualAtomInUseRegistry: VirtualAtomInUseRegistryDocument;
  readonly chosenLane: TeamBrokerChosenLane;
  readonly stewardId: string | null;
  readonly composerPath: string | null;
  readonly safeToStart: boolean;
  readonly blockedReasons: readonly string[];
}

export interface TeamBrokerLaneResult {
  readonly ok: boolean;
  readonly evidence: TeamBrokerLaneEvidence;
}

export interface TeamBrokerRuntimeActivationHandshakeEvidence {
  readonly schemaId: 'atm.teamBrokerRuntimeActivationHandshake.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly actorId: string;
  readonly registryPath: string;
  readonly brokerLane: TeamBrokerLaneEvidence;
  readonly activationState: 'activated' | 'blocked';
  readonly scopedWriteExecution: {
    readonly approved: boolean;
    readonly allowedFiles: readonly string[];
    readonly evidencePath: string | null;
    readonly acceptedInputs: readonly ['PatchProposal', 'MergePlan', 'StewardPlan'];
  };
  readonly runtimeBoundary: {
    readonly gitWrite: false;
    readonly taskLifecycle: false;
    readonly selfClose: false;
  };
  readonly blockedReasons: readonly string[];
}

export interface TeamBrokerRuntimeActivationHandshakeResult {
  readonly ok: boolean;
  readonly evidence: TeamBrokerRuntimeActivationHandshakeEvidence;
}

export interface TeamBrokerFinding {
  readonly level: 'error' | 'warning';
  readonly code: string;
  readonly detail: string;
  readonly paths?: string[];
}

export function buildTeamWriteIntent(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly task: unknown;
  readonly writePaths: readonly string[];
}): WriteIntent {
  const task = input.task as Record<string, unknown> | null;
  const baseCommit = readGitHeadCommit(path.resolve(input.cwd)) ?? 'unknown-base-commit';
  const targetFiles = [...new Set(input.writePaths.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'team plan/start broker lane' },
    taskId: input.taskId,
    actorId: input.actorId,
    baseCommit,
    targetFiles,
    atomRefs: deriveTeamAtomRefs(task, input.taskId),
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'auto'
  };
}

export function resolveTeamBrokerLane(decision: BrokerDecision): {
  readonly chosenLane: TeamBrokerChosenLane;
  readonly stewardId: string | null;
  readonly composerPath: string | null;
  readonly safeToStart: boolean;
  readonly blockedReasons: readonly string[];
} {
  if (
    decision.verdict === 'blocked-cid-conflict'
    || decision.verdict === 'blocked-shared-surface'
    || decision.verdict === 'blocked-active-lease'
    || decision.lane === 'blocked'
  ) {
    return {
      chosenLane: 'blocked',
      stewardId: null,
      composerPath: null,
      safeToStart: false,
      blockedReasons: [
        decision.reason,
        ...decision.conflicts.map((conflict) => conflict.detail)
      ]
    };
  }

  if (decision.verdict === 'needs-physical-split') {
    return {
      chosenLane: 'neutral-steward',
      stewardId: DEFAULT_TEAM_STEWARD_ID,
      composerPath: 'broker compose -> steward plan/apply',
      safeToStart: true,
      blockedReasons: []
    };
  }

  if (decision.lane === 'deterministic-composer') {
    return {
      chosenLane: 'deterministic-composer',
      stewardId: null,
      composerPath: 'broker compose',
      safeToStart: true,
      blockedReasons: []
    };
  }

  return {
    chosenLane: decision.lane === 'serial' ? 'serial' : 'direct-brokered',
    stewardId: null,
    composerPath: null,
    safeToStart: true,
    blockedReasons: []
  };
}

export function evaluateTeamBrokerLane(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly task: unknown;
  readonly writePaths: readonly string[];
  readonly registryPath?: string;
}): TeamBrokerLaneResult {
  const registryPath = input.registryPath ?? path.join(path.resolve(input.cwd), DEFAULT_BROKER_REGISTRY_RELATIVE_PATH);
  const writeIntent = buildTeamWriteIntent(input);
  const registry = loadRegistry(registryPath);
  const virtualAtomInUseRegistry = buildVirtualAtomInUseRegistry(registry);
  const decision = calculateBrokerDecision(writeIntent, registry);
  const resolution = resolveTeamBrokerLane(decision);

  const evidence: TeamBrokerLaneEvidence = {
    schemaId: 'atm.teamBrokerLaneEvidence.v1',
    specVersion: '0.1.0',
    taskId: input.taskId,
    actorId: input.actorId,
    registryPath: DEFAULT_BROKER_REGISTRY_RELATIVE_PATH,
    writeIntent,
    decision,
    virtualAtomInUseRegistry,
    chosenLane: resolution.chosenLane,
    stewardId: resolution.stewardId,
    composerPath: resolution.composerPath,
    safeToStart: resolution.safeToStart,
    blockedReasons: resolution.blockedReasons
  };

  return {
    ok: resolution.safeToStart,
    evidence
  };
}

export function buildTeamBrokerEvidence(result: TeamBrokerLaneResult): TeamBrokerLaneEvidence {
  return result.evidence;
}

export function buildTeamBrokerRuntimeActivationHandshake(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly task: unknown;
  readonly writePaths: readonly string[];
  readonly registryPath?: string;
  readonly evidencePath?: string | null;
}): TeamBrokerRuntimeActivationHandshakeResult {
  const laneResult = evaluateTeamBrokerLane(input);
  const approved = laneResult.ok && laneResult.evidence.safeToStart;
  const allowedFiles = [...new Set(input.writePaths.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  const evidence: TeamBrokerRuntimeActivationHandshakeEvidence = {
    schemaId: 'atm.teamBrokerRuntimeActivationHandshake.v1',
    specVersion: '0.1.0',
    taskId: input.taskId,
    actorId: input.actorId,
    registryPath: laneResult.evidence.registryPath,
    brokerLane: laneResult.evidence,
    activationState: approved ? 'activated' : 'blocked',
    scopedWriteExecution: {
      approved,
      allowedFiles,
      evidencePath: input.evidencePath ?? null,
      acceptedInputs: ['PatchProposal', 'MergePlan', 'StewardPlan']
    },
    runtimeBoundary: {
      gitWrite: false,
      taskLifecycle: false,
      selfClose: false
    },
    blockedReasons: approved ? [] : [...laneResult.evidence.blockedReasons]
  };

  return {
    ok: approved,
    evidence
  };
}

export function brokerLaneToFindings(result: TeamBrokerLaneResult): TeamBrokerFinding[] {
  if (result.ok) {
    return [];
  }

  const { decision, blockedReasons } = result.evidence;
  const code = decision.verdict === 'blocked-shared-surface'
    ? 'blocked-broker-shared-surface'
    : 'blocked-broker-cid-conflict';

  return [{
    level: 'error',
    code,
    detail: blockedReasons[0] ?? decision.reason,
    paths: decision.conflicts
      .filter((conflict) => conflict.kind === 'file-range')
      .map((conflict) => {
        const match = /'([^']+)'/.exec(conflict.detail);
        return match?.[1] ?? '';
      })
      .filter(Boolean)
  }];
}

function deriveTeamAtomRefs(task: Record<string, unknown> | null, taskId: string): WriteIntentAtomRef[] {
  const atomizationImpact = task?.atomizationImpact as Record<string, unknown> | undefined;
  const ownerAtom = String(atomizationImpact?.ownerAtomOrMap ?? atomizationImpact?.owner_atom_or_map ?? taskId).trim();
  const atomCid = taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return [{
    atomId: ownerAtom,
    atomCid,
    operation: 'modify'
  }];
}
