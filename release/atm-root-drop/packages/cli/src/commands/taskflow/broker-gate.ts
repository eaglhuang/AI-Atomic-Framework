import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry } from '../../../../core/src/broker/registry.ts';
import { calculateBrokerDecision } from '../../../../core/src/broker/decision.ts';
import type { ActiveWriteIntent, WriteIntent, WriteIntentAtomRef } from '../../../../core/src/broker/types.ts';
import { quoteCliValue, relativePathFrom } from '../shared.ts';

export interface TaskflowBrokerConflictGate {
  readonly schemaId: 'atm.taskflowBrokerConflictGate.v1';
  readonly verdict: 'confirmedConflict' | 'takeoverRequired' | 'insufficientMutationIntent' | 'noConflict';
  readonly confirmedConflict: boolean;
  readonly overlappingTaskIds: readonly string[];
  readonly summary: string;
  readonly requiredCommand: string | null;
  readonly brokerVerdict: string | null;
}

function uniqueTaskIds(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function wildcardToRegExp(pattern: string): RegExp {
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource = `^${escaped.replace(/\*\*/g, '::DOUBLE_STAR::').replace(/\*/g, '[^/]*').replace(/::DOUBLE_STAR::/g, '.*')}$`;
  return new RegExp(regexSource);
}

function brokerPathMatches(filePath: string, declaredPath: string): boolean {
  const file = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const declared = declaredPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!file || !declared) return false;
  if (declared.includes('*')) {
    return wildcardToRegExp(declared).test(file);
  }
  return file === declared || file.startsWith(`${declared}/`);
}

function activeIntentToWriteIntent(intent: ActiveWriteIntent): WriteIntent {
  const rangeByCid = new Map<string, Array<NonNullable<ActiveWriteIntent['resourceKeys']['atomRanges']>[number]>>();
  for (const range of intent.resourceKeys.atomRanges ?? []) {
    const bucket = rangeByCid.get(range.atomCid) ?? [];
    bucket.push(range);
    rangeByCid.set(range.atomCid, bucket);
  }
  const atomRefs: WriteIntentAtomRef[] = intent.resourceKeys.atomIds.map((atomId, index) => {
    const atomCid = intent.resourceKeys.atomCids[index] ?? atomId;
    const range = rangeByCid.get(atomCid)?.[0];
    return {
      atomId,
      atomCid,
      operation: 'modify' as const,
      ...(range ? {
        sourceRange: {
          filePath: range.filePath,
          lineStart: range.lineStart,
          lineEnd: range.lineEnd
        }
      } : {})
    };
  }).filter((ref) => ref.atomId && ref.atomCid);
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'derived-from-active-broker-intent' },
    taskId: intent.taskId,
    actorId: intent.actorId,
    baseCommit: intent.baseCommit,
    targetFiles: intent.resourceKeys.files,
    atomRefs,
    sharedSurfaces: {
      generators: intent.resourceKeys.generators,
      projections: intent.resourceKeys.projections,
      registries: intent.resourceKeys.registries,
      validators: intent.resourceKeys.validators,
      artifacts: intent.resourceKeys.artifacts
    },
    requestedLane: intent.lane
  };
}

export function evaluateTaskflowBrokerConflictGate(input: {
  cwd: string;
  taskId: string;
  declaredFiles: readonly string[];
  actorId?: string | null;
}): TaskflowBrokerConflictGate {
  const registryPath = path.join(input.cwd, '.atm', 'runtime', 'write-broker.registry.json');
  const currentFiles = [...input.declaredFiles];
  if (!existsSync(registryPath) || currentFiles.length === 0) {
    return {
      schemaId: 'atm.taskflowBrokerConflictGate.v1',
      verdict: 'noConflict',
      confirmedConflict: false,
      overlappingTaskIds: [],
      summary: 'No broker conflict evidence is available for this close.',
      requiredCommand: null,
      brokerVerdict: null
    };
  }

  const registry = loadRegistry(registryPath);
  const currentIntent = registry.activeIntents.find((entry) => entry.taskId === input.taskId) ?? null;
  const overlapping = registry.activeIntents.filter((entry) =>
    entry.taskId !== input.taskId
    && entry.resourceKeys.files.some((entryFile) => currentFiles.some((file) => brokerPathMatches(file, entryFile) || brokerPathMatches(entryFile, file)))
  );

  const staleEpochOverlap = typeof (registry as { currentEpoch?: unknown }).currentEpoch === 'number'
    ? overlapping.filter((entry) => typeof entry.leaseEpoch === 'number' && entry.leaseEpoch < (registry as { currentEpoch: number }).currentEpoch)
    : [];

  if (overlapping.length === 0) {
    return {
      schemaId: 'atm.taskflowBrokerConflictGate.v1',
      verdict: 'noConflict',
      confirmedConflict: false,
      overlappingTaskIds: [],
      summary: 'No overlapping broker-tracked write intents affect this close.',
      requiredCommand: null,
      brokerVerdict: null
    };
  }

  if (staleEpochOverlap.length > 0) {
    const repairTarget = staleEpochOverlap[0]?.taskId ?? null;
    const actorId = input.actorId?.trim() || currentIntent?.actorId || '<actor>';
    return {
      schemaId: 'atm.taskflowBrokerConflictGate.v1',
      verdict: 'takeoverRequired',
      confirmedConflict: false,
      overlappingTaskIds: staleEpochOverlap.map((entry) => entry.taskId),
      summary: `Broker found stale or malformed active lease epoch state (${staleEpochOverlap.map((entry) => entry.taskId).join(', ')}). Repair or take over the stale broker lane before continuing, so shared hot files do not fall through to hook-time scope drift.`,
      requiredCommand: repairTarget
        ? `node atm.mjs tasks repair-claim --task ${repairTarget} --actor ${quoteCliValue(actorId)} --json`
        : null,
      brokerVerdict: 'blocked-active-lease'
    };
  }

  if (!currentIntent) {
    return {
      schemaId: 'atm.taskflowBrokerConflictGate.v1',
      verdict: 'insufficientMutationIntent',
      confirmedConflict: false,
      overlappingTaskIds: overlapping.map((entry) => entry.taskId),
      summary: 'Broker found overlapping active write intents, but this task has no registered broker mutation intent to confirm whether the overlap is real. Supplement mutation intent for precision; close remains advisory here.',
      requiredCommand: null,
      brokerVerdict: null
    };
  }

  const currentWriteIntent = activeIntentToWriteIntent(currentIntent);
  if (currentWriteIntent.atomRefs.length === 0) {
    return {
      schemaId: 'atm.taskflowBrokerConflictGate.v1',
      verdict: 'insufficientMutationIntent',
      confirmedConflict: false,
      overlappingTaskIds: overlapping.map((entry) => entry.taskId),
      summary: 'Broker found overlapping active write intents, but the registered mutation intent lacks atom-level detail. Supplement mutation intent for precision; close remains advisory here.',
      requiredCommand: null,
      brokerVerdict: null
    };
  }

  const comparisonRegistry = {
    ...registry,
    activeIntents: overlapping
  };
  const decision = calculateBrokerDecision(currentWriteIntent, comparisonRegistry);
  if (decision.verdict === 'blocked-cid-conflict') {
    return {
      schemaId: 'atm.taskflowBrokerConflictGate.v1',
      verdict: 'confirmedConflict',
      confirmedConflict: true,
      overlappingTaskIds: overlapping.map((entry) => entry.taskId),
      summary: 'Broker reports a confirmed CID/read-set conflict with another active write intent. taskflow close --write must stop until the conflict is resolved.',
      requiredCommand: null,
      brokerVerdict: decision.verdict
    };
  }

  if (decision.verdict === 'blocked-active-lease') {
    const staleLeaseBlockingTasks = uniqueTaskIds(
      (decision.conflictMatrix?.conflicts ?? [])
        .filter((entry) => entry.kind === 'lease' && typeof entry.blockingTask === 'string' && entry.blockingTask !== 'self')
        .map((entry) => entry.blockingTask)
    );
    const repairTarget = staleLeaseBlockingTasks[0] ?? overlapping[0]?.taskId ?? null;
    const actorId = input.actorId?.trim() || currentIntent.actorId || '<actor>';
    return {
      schemaId: 'atm.taskflowBrokerConflictGate.v1',
      verdict: 'takeoverRequired',
      confirmedConflict: false,
      overlappingTaskIds: overlapping.map((entry) => entry.taskId),
      summary: staleLeaseBlockingTasks.length > 0
        ? `Broker found stale or malformed active lease state (${staleLeaseBlockingTasks.join(', ')}). Repair or take over the stale broker lane before continuing, so shared hot files do not fall through to hook-time scope drift.`
        : 'Broker found stale or malformed active lease state. Repair or take over the stale broker lane before continuing, so shared hot files do not fall through to hook-time scope drift.',
      requiredCommand: repairTarget
        ? `node atm.mjs tasks repair-claim --task ${repairTarget} --actor ${quoteCliValue(actorId)} --json`
        : null,
      brokerVerdict: decision.verdict
    };
  }

  if (decision.verdict === 'needs-physical-split' || decision.verdict === 'blocked-shared-surface') {
    return {
      schemaId: 'atm.taskflowBrokerConflictGate.v1',
      verdict: 'insufficientMutationIntent',
      confirmedConflict: false,
      overlappingTaskIds: overlapping.map((entry) => entry.taskId),
      summary: 'Broker found overlapping write surfaces, but not a confirmed CID conflict. Supplement mutation intent for precision; close remains advisory here.',
      requiredCommand: null,
      brokerVerdict: decision.verdict
    };
  }

  return {
    schemaId: 'atm.taskflowBrokerConflictGate.v1',
    verdict: 'noConflict',
    confirmedConflict: false,
    overlappingTaskIds: overlapping.map((entry) => entry.taskId),
    summary: 'Broker re-check found no confirmed CID conflict for this close.',
    requiredCommand: null,
    brokerVerdict: decision.verdict
  };
}
