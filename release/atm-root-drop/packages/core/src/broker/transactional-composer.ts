import { createHash } from 'node:crypto';
import { computeCasResult, hashContent } from './adapters/cas.ts';
import { jsonRecordAdapter } from './adapters/json-record.ts';
import { textRangeAdapter } from './adapters/text-range.ts';
import { brokerAdapterMigration, type FileDescriptor, type FileMutationAdapter, type MigrationRecord, type MutationRequest } from './types.ts';

export type CompositionMemberVerdict = 'selected' | 'skipped' | 'blocked';

export interface CompositionMemberAttribution {
  readonly requestId: string;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly transactionIds: readonly string[];
  readonly filePath: string;
  readonly adapterId: string | null;
  readonly verdict: CompositionMemberVerdict;
  readonly reason: string;
}

export interface CompositionFileSlice {
  readonly filePath: string;
  readonly adapterId: string;
  readonly baseHash: string;
  readonly outputHash: string;
  readonly selectedRequestIds: readonly string[];
}

export interface CompositionRollbackReceipt {
  readonly strategy: 'discard-temp-tree';
  readonly tempTreeMutation: false;
  readonly liveWorktreeMutation: false;
  readonly returnedQueueRequestIds: readonly string[];
}

export interface CompositionSerializabilityProof {
  readonly legalSerialOrder: readonly string[];
  readonly permutationStable: boolean;
  readonly equivalentOutputHash: string;
  readonly checkedPermutationCount: number;
}

export interface TransactionalCompositionPlan {
  readonly schemaId: 'atm.compositionPlan.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly planId: string;
  readonly baseTree: 'in-memory';
  readonly outputTree: 'in-memory';
  readonly bounded: true;
  readonly selectedRequestIds: readonly string[];
  readonly skippedRequestIds: readonly string[];
  readonly blockedRequestIds: readonly string[];
  readonly fileSlices: readonly CompositionFileSlice[];
  readonly memberAttribution: readonly CompositionMemberAttribution[];
  readonly serializabilityProof: CompositionSerializabilityProof;
  readonly rollback: CompositionRollbackReceipt;
  readonly validatorRefs: readonly string[];
}

export interface TransactionalComposeResult {
  readonly ok: boolean;
  readonly plan: TransactionalCompositionPlan;
  readonly outputFiles: readonly FileDescriptor[];
}

const DEFAULT_ADAPTERS: readonly FileMutationAdapter[] = [jsonRecordAdapter, textRangeAdapter];

export function composeTransactionalMutations(input: {
  readonly files: readonly FileDescriptor[];
  readonly requests: readonly MutationRequest[];
  readonly validators?: readonly string[];
  readonly adapters?: readonly FileMutationAdapter[];
  readonly maxPermutationChecks?: number;
}): TransactionalComposeResult {
  const adapters = input.adapters ?? DEFAULT_ADAPTERS;
  const fileMap = new Map(input.files.map((file) => [normalizePath(file.filePath), file]));
  const grouped = groupRequests(input.requests);
  const outputFiles = new Map(input.files.map((file) => [normalizePath(file.filePath), { ...file }]));
  const attribution: CompositionMemberAttribution[] = [];
  const slices: CompositionFileSlice[] = [];
  const selected: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];

  for (const [filePath, requests] of grouped) {
    const file = fileMap.get(filePath);
    if (!file) {
      for (const request of requests) {
        blocked.push(request.requestId);
        attribution.push(attributionFor(request, null, 'blocked', 'target file is missing from bounded input set'));
      }
      continue;
    }

    const adapter = adapters.find((candidate) => candidate.supports(file));
    if (!adapter) {
      for (const request of requests) {
        blocked.push(request.requestId);
        attribution.push(attributionFor(request, null, 'blocked', 'no adapter supports target file'));
      }
      continue;
    }

    const baseHash = hashContent(file.content);
    const cas = computeCasResult({ filePath, expectedBaseHash: baseHash, currentFileContents: file.content });
    if (!cas.ok) {
      for (const request of requests) {
        blocked.push(request.requestId);
        attribution.push(attributionFor(request, adapter.id, 'blocked', 'base hash CAS mismatch'));
      }
      continue;
    }

    const parsed = adapter.parse(file);
    const normalized = requests.map((request) => adapter.normalize(request));
    const accepted: typeof normalized = [];
    for (const candidate of normalized) {
      const decision = adapter.canMerge([...accepted, candidate], parsed);
      const original = requests.find((request) => request.requestId === candidate.requestId)!;
      if (decision.verdict === 'conflict') {
        skipped.push(candidate.requestId);
        attribution.push(attributionFor(original, adapter.id, 'skipped', decision.reason));
      } else {
        accepted.push(candidate);
        selected.push(candidate.requestId);
        attribution.push(attributionFor(original, adapter.id, 'selected', decision.reason));
      }
    }

    if (accepted.length > 0) {
      const merged = adapter.merge(accepted, parsed);
      const content = adapter.serialize(merged);
      outputFiles.set(filePath, { filePath, content });
      slices.push({
        filePath,
        adapterId: adapter.id,
        baseHash,
        outputHash: hashContent(content),
        selectedRequestIds: accepted.map((request) => request.requestId)
      });
    }
  }

  const selectedSorted = selected.sort(compare);
  const skippedSorted = skipped.sort(compare);
  const blockedSorted = blocked.sort(compare);
  const proof = buildSerializabilityProof({
    files: input.files,
    selectedRequests: input.requests.filter((request) => selectedSorted.includes(request.requestId)),
    adapters,
    maxPermutationChecks: input.maxPermutationChecks ?? 24
  });
  const plan: TransactionalCompositionPlan = {
    schemaId: 'atm.compositionPlan.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    planId: buildPlanId(input.requests.map((request) => request.requestId), slices.map((slice) => slice.outputHash)),
    baseTree: 'in-memory',
    outputTree: 'in-memory',
    bounded: true,
    selectedRequestIds: selectedSorted,
    skippedRequestIds: skippedSorted,
    blockedRequestIds: blockedSorted,
    fileSlices: slices.sort((left, right) => left.filePath.localeCompare(right.filePath)),
    memberAttribution: attribution.sort((left, right) => left.requestId.localeCompare(right.requestId)),
    serializabilityProof: proof,
    rollback: {
      strategy: 'discard-temp-tree',
      tempTreeMutation: false,
      liveWorktreeMutation: false,
      returnedQueueRequestIds: [...skippedSorted, ...blockedSorted].sort(compare)
    },
    validatorRefs: [...new Set(input.validators ?? [])].sort(compare)
  };
  return { ok: blockedSorted.length === 0, plan, outputFiles: [...outputFiles.values()].sort((left, right) => left.filePath.localeCompare(right.filePath)) };
}

function buildSerializabilityProof(input: {
  readonly files: readonly FileDescriptor[];
  readonly selectedRequests: readonly MutationRequest[];
  readonly adapters: readonly FileMutationAdapter[];
  readonly maxPermutationChecks: number;
}): CompositionSerializabilityProof {
  const legalOrder = [...input.selectedRequests].sort(compareRequests).map((request) => request.requestId);
  const baseline = digestOutput(composeTransactionalMutationsUnchecked(input.files, [...input.selectedRequests].sort(compareRequests), input.adapters));
  const permutations = boundedPermutations(input.selectedRequests, input.maxPermutationChecks);
  let checked = 0;
  let stable = true;
  for (const permutation of permutations) {
    checked += 1;
    const outputHash = digestOutput(composeTransactionalMutationsUnchecked(input.files, permutation, input.adapters));
    if (outputHash !== baseline) {
      stable = false;
      break;
    }
  }
  return {
    legalSerialOrder: legalOrder,
    permutationStable: stable,
    equivalentOutputHash: baseline,
    checkedPermutationCount: checked
  };
}

function composeTransactionalMutationsUnchecked(
  files: readonly FileDescriptor[],
  requests: readonly MutationRequest[],
  adapters: readonly FileMutationAdapter[]
): readonly FileDescriptor[] {
  const outputFiles = new Map(files.map((file) => [normalizePath(file.filePath), { ...file }]));
  for (const [filePath, group] of groupRequests(requests)) {
    const file = outputFiles.get(filePath);
    if (!file) continue;
    const adapter = adapters.find((candidate) => candidate.supports(file));
    if (!adapter) continue;
    const parsed = adapter.parse(file);
    const normalized = group.map((request) => adapter.normalize(request));
    const merged = adapter.merge(normalized, parsed);
    outputFiles.set(filePath, { filePath, content: adapter.serialize(merged) });
  }
  return [...outputFiles.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function groupRequests(requests: readonly MutationRequest[]): Map<string, MutationRequest[]> {
  const groups = new Map<string, MutationRequest[]>();
  for (const request of [...requests].sort(compareRequests)) {
    const filePath = normalizePath(request.filePath);
    const group = groups.get(filePath) ?? [];
    group.push(request);
    groups.set(filePath, group);
  }
  return groups;
}

function attributionFor(
  request: MutationRequest,
  adapterId: string | null,
  verdict: CompositionMemberVerdict,
  reason: string
): CompositionMemberAttribution {
  return {
    requestId: request.requestId,
    actorId: request.actorId,
    taskId: request.taskId ?? null,
    transactionIds: [...new Set([request.transactionId, ...(request.transactionIds ?? []), ...(request.transaction_ids ?? [])].filter(Boolean) as string[])].sort(compare),
    filePath: normalizePath(request.filePath),
    adapterId,
    verdict,
    reason
  };
}

function boundedPermutations<T>(items: readonly T[], max: number): readonly T[][] {
  if (items.length <= 1) return [[...items]];
  const output: T[][] = [];
  const visit = (prefix: T[], rest: T[]) => {
    if (output.length >= max) return;
    if (rest.length === 0) {
      output.push(prefix);
      return;
    }
    for (let index = 0; index < rest.length; index += 1) {
      visit([...prefix, rest[index]], [...rest.slice(0, index), ...rest.slice(index + 1)]);
    }
  };
  visit([], [...items]);
  return output;
}

function digestOutput(files: readonly FileDescriptor[]): string {
  return hashText(files.map((file) => `${normalizePath(file.filePath)}\0${hashContent(file.content)}`).join('\n'));
}

function buildPlanId(requestIds: readonly string[], outputHashes: readonly string[]): string {
  return `composition-${hashText([...requestIds, ...outputHashes].sort(compare).join('\n')).slice('sha256:'.length, 'sha256:'.length + 16)}`;
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function compare(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareRequests(left: MutationRequest, right: MutationRequest): number {
  const fileCompare = normalizePath(left.filePath).localeCompare(normalizePath(right.filePath));
  if (fileCompare !== 0) return fileCompare;
  const targetCompare = left.target.localeCompare(right.target);
  if (targetCompare !== 0) return targetCompare;
  return left.requestId.localeCompare(right.requestId);
}
