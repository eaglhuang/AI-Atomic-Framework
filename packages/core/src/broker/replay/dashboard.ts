import { sha256Digest } from '../census/index.ts';

export type ReplayDashboardReadiness = 'ready' | 'not-ready';
export type ReplayDashboardPredicateStatus = 'pass' | 'fail' | 'unknown';

export interface ReplayDashboardParticipant {
  readonly participantId: string;
  readonly provider?: string;
  readonly role?: string;
  readonly taskId?: string;
  readonly actorId: string;
  readonly processId: number | string | null;
  readonly laneSessionId?: string | null;
  readonly worktreeRoot: string;
  readonly baseDigest: string;
  readonly headDigest: string;
  readonly buildDigest: string;
  readonly runnerDigest: string;
  readonly selectedTaskIds?: readonly string[];
  readonly queuedTaskIds?: readonly string[];
  readonly ticketDigest?: string | null;
  readonly ticketGeneration?: string | number | null;
  readonly waitedMs?: number;
  readonly wakeup?: 'auto' | 'manual' | 'none';
  readonly authority?: {
    readonly lane?: string | null;
    readonly proxyActor?: string | null;
    readonly takeover?: boolean;
    readonly borrowedActor?: boolean;
  };
  readonly producerLabel?: string;
}

export interface ReplayDashboardValidatorSeal {
  readonly policyDigest: string;
  readonly unionDigest: string;
  readonly selectionInputDigest: string;
  readonly negativeControlRevealedAt: string | null;
  readonly currentUnionDigest?: string;
}

export interface ReplayDashboardLogicalIntent {
  readonly intentId: string;
  readonly physicalPath: string;
  readonly digest: string;
  readonly privateOutputDigest?: string | null;
  readonly proposalRoot?: string | null;
}

export interface ReplayDashboardRunManifestInput {
  readonly runId: string;
  readonly generatedAt?: string;
  readonly participants: readonly ReplayDashboardParticipant[];
  readonly sharedPhysicalFile: string;
  readonly logicalIntents: readonly ReplayDashboardLogicalIntent[];
  readonly validatorSeal: ReplayDashboardValidatorSeal;
  readonly thresholds: Readonly<Record<string, number | string | boolean>>;
  readonly timeWindow: { readonly startedAt: string; readonly endedAt: string | null };
  readonly stopRule: string;
}

export interface ReplayDashboardRunManifest extends ReplayDashboardRunManifestInput {
  readonly schemaId: 'atm.replayRunManifest.v1';
  readonly specVersion: '0.1.0';
  readonly digest: string;
}

export interface ReplayDashboardInput extends ReplayDashboardRunManifestInput {
  readonly admissionFacadeDisposition: 'required' | 'not-required' | 'unknown';
  readonly adapterDecision?: string | null;
  readonly candidateOutputDigests?: readonly string[];
  readonly validatorRunDigests?: readonly string[];
  readonly commands?: readonly string[];
  readonly usageErrors?: readonly string[];
  readonly continuations?: readonly string[];
  readonly terminalPrunes?: readonly string[];
  readonly manualInterventions?: readonly string[];
  readonly falseStops?: readonly string[];
  readonly unavailableReceipts?: readonly string[];
  readonly cleanupRequired?: boolean;
  readonly manualRecoveryRequired?: boolean;
  readonly safeCompose?: boolean;
  readonly staleFallbackUsed?: boolean;
  readonly trueConflict?: boolean;
  readonly publication?: {
    readonly status: string;
    readonly sourceAvailable: boolean;
    readonly costRatio?: number;
    readonly throughputGainRatio?: number;
  };
  readonly receipts?: Readonly<Record<string, string | null>>;
  readonly admissionTrace?: readonly string[];
  readonly producerVerdictLabel?: string;
}

export interface ReplayDashboardPredicate {
  readonly id: string;
  readonly status: ReplayDashboardPredicateStatus;
  readonly reason: string;
}

export interface ReplayDashboardSnapshot {
  readonly schemaId: 'atm.replayDashboardSnapshot.v1';
  readonly manifest: ReplayDashboardRunManifest;
  readonly readiness: ReplayDashboardReadiness;
  readonly predicates: readonly ReplayDashboardPredicate[];
  readonly blockers: readonly string[];
  readonly observations: {
    readonly participantCount: number;
    readonly actorCount: number;
    readonly processCount: number;
    readonly worktreeRootCount: number;
    readonly baseDigestCount: number;
    readonly headDigestCount: number;
    readonly buildDigestCount: number;
    readonly runnerDigestCount: number;
    readonly sharedPhysicalFile: string;
    readonly logicalIntentCount: number;
    readonly logicalIntentDigestCount: number;
    readonly nonGitProposalRootCount: number;
    readonly commandCount: number;
    readonly usageErrorCount: number;
    readonly continuationCount: number;
    readonly terminalPruneCount: number;
    readonly manualInterventionCount: number;
    readonly falseStopCount: number;
    readonly unavailableReceiptCount: number;
    readonly candidateOutputDigestCount: number;
    readonly validatorRunDigestCount: number;
    readonly authorityLaneCount: number;
  };
  readonly decisions: {
    readonly adapterDecision: string | null;
    readonly safeCompose: boolean;
    readonly staleFallbackUsed: boolean;
    readonly trueConflict: boolean;
    readonly admissionFacadeDisposition: ReplayDashboardInput['admissionFacadeDisposition'];
    readonly publicationStatus: string | null;
    readonly sourceAvailable: boolean;
  };
  readonly digest: string;
}

export function createReplayRunManifest(input: ReplayDashboardRunManifestInput): ReplayDashboardRunManifest {
  const withoutDigest = {
    schemaId: 'atm.replayRunManifest.v1' as const,
    specVersion: '0.1.0' as const,
    runId: input.runId,
    generatedAt: input.generatedAt ?? new Date(0).toISOString(),
    participants: [...input.participants].map(normalizeParticipant).sort(compareBy('participantId')),
    sharedPhysicalFile: normalizePath(input.sharedPhysicalFile),
    logicalIntents: [...input.logicalIntents].map(normalizeIntent).sort(compareBy('intentId')),
    validatorSeal: { ...input.validatorSeal },
    thresholds: sortRecord(input.thresholds),
    timeWindow: { ...input.timeWindow },
    stopRule: input.stopRule
  };
  return { ...withoutDigest, digest: sha256Digest(withoutDigest) };
}

export function buildReplayDashboardSnapshot(input: ReplayDashboardInput): ReplayDashboardSnapshot {
  const manifest = createReplayRunManifest(input);
  const participants = manifest.participants;
  const logicalIntents = manifest.logicalIntents;
  const actorCount = distinct(participants.map((entry) => entry.actorId)).size;
  const processCount = distinct(participants.map((entry) => entry.processId == null ? '' : String(entry.processId)).filter(Boolean)).size;
  const worktreeRootCount = distinct(participants.map((entry) => entry.worktreeRoot)).size;
  const baseDigestCount = distinct(participants.map((entry) => entry.baseDigest)).size;
  const headDigestCount = distinct(participants.map((entry) => entry.headDigest)).size;
  const buildDigestCount = distinct(participants.map((entry) => entry.buildDigest)).size;
  const runnerDigestCount = distinct(participants.map((entry) => entry.runnerDigest)).size;
  const intentDigestCount = distinct(logicalIntents.map((entry) => entry.digest)).size;
  const predicates: ReplayDashboardPredicate[] = [
    predicate('participants.two-or-more', participants.length >= 2, `${participants.length} participant(s) observed`),
    predicate('participants.distinct-actors', actorCount >= 2, `${actorCount} actor(s) observed`),
    predicate('participants.distinct-processes', processCount >= 2, `${processCount} process id(s) observed`),
    predicate('canonical-worktree.single-root', worktreeRootCount === 1, `${worktreeRootCount} canonical worktree root(s) observed`),
    predicate('canonical-source.single-base', baseDigestCount === 1, `${baseDigestCount} base digest(s) observed`),
    predicate('canonical-source.single-head', headDigestCount === 1, `${headDigestCount} head digest(s) observed`),
    predicate('canonical-build.single-build', buildDigestCount === 1, `${buildDigestCount} build digest(s) observed`),
    predicate('canonical-runner.single-runner', runnerDigestCount === 1, `${runnerDigestCount} runner digest(s) observed`),
    predicate('shared-file.present', Boolean(manifest.sharedPhysicalFile), `shared file: ${manifest.sharedPhysicalFile || 'missing'}`),
    predicate('logical-intents.distinct', logicalIntents.length >= 2 && intentDigestCount === logicalIntents.length, `${logicalIntents.length} logical intent(s), ${intentDigestCount} digest(s)`),
    predicate('validator.policy-sealed', Boolean(manifest.validatorSeal.policyDigest && manifest.validatorSeal.unionDigest && manifest.validatorSeal.selectionInputDigest), 'validator policy, union, and selection digests must be sealed before payload reveal'),
    predicate('validator.negative-control-revealed', Boolean(manifest.validatorSeal.negativeControlRevealedAt), 'negative control reveal timestamp must be present'),
    predicate('validator.union-not-mutated', !manifest.validatorSeal.currentUnionDigest || manifest.validatorSeal.currentUnionDigest === manifest.validatorSeal.unionDigest, 'current validator union must match sealed union'),
    predicate('admission.facade-required', input.admissionFacadeDisposition === 'required', `admission facade disposition: ${input.admissionFacadeDisposition}`),
    predicate('recovery.no-cleanup-required', !input.cleanupRequired && !input.manualRecoveryRequired, 'cleanup/manual recovery must not be required for readiness'),
    predicate('conflict.not-true-conflict', !input.trueConflict, 'true conflicts are not ready'),
    predicate('fallback.not-stale', !input.staleFallbackUsed, 'stale fallback readiness is fail-closed')
  ];
  const blockers = predicates.filter((entry) => entry.status !== 'pass').map((entry) => `${entry.id}: ${entry.reason}`);
  const withoutDigest = {
    schemaId: 'atm.replayDashboardSnapshot.v1' as const,
    manifest,
    readiness: blockers.length === 0 ? 'ready' as const : 'not-ready' as const,
    predicates,
    blockers,
    observations: {
      participantCount: participants.length,
      actorCount,
      processCount,
      worktreeRootCount,
      baseDigestCount,
      headDigestCount,
      buildDigestCount,
      runnerDigestCount,
      sharedPhysicalFile: manifest.sharedPhysicalFile,
      logicalIntentCount: logicalIntents.length,
      logicalIntentDigestCount: intentDigestCount,
      nonGitProposalRootCount: logicalIntents.filter((entry) => entry.proposalRoot).length,
      commandCount: input.commands?.length ?? 0,
      usageErrorCount: input.usageErrors?.length ?? 0,
      continuationCount: input.continuations?.length ?? 0,
      terminalPruneCount: input.terminalPrunes?.length ?? 0,
      manualInterventionCount: input.manualInterventions?.length ?? 0,
      falseStopCount: input.falseStops?.length ?? 0,
      unavailableReceiptCount: input.unavailableReceipts?.length ?? 0,
      candidateOutputDigestCount: input.candidateOutputDigests?.length ?? 0,
      validatorRunDigestCount: input.validatorRunDigests?.length ?? 0,
      authorityLaneCount: distinct(participants.map((entry) => entry.authority?.lane ?? '').filter(Boolean)).size
    },
    decisions: {
      adapterDecision: input.adapterDecision ?? null,
      safeCompose: input.safeCompose ?? false,
      staleFallbackUsed: input.staleFallbackUsed ?? false,
      trueConflict: input.trueConflict ?? false,
      admissionFacadeDisposition: input.admissionFacadeDisposition,
      publicationStatus: input.publication?.status ?? null,
      sourceAvailable: input.publication?.sourceAvailable ?? false
    }
  };
  return { ...withoutDigest, digest: sha256Digest(withoutDigest) };
}

export function renderReplayDashboardHuman(snapshot: ReplayDashboardSnapshot): string {
  const failed = snapshot.predicates.filter((entry) => entry.status !== 'pass');
  return [
    `Replay dashboard: ${snapshot.readiness}`,
    `digest: ${snapshot.digest}`,
    `participants: ${snapshot.observations.participantCount} (${snapshot.observations.actorCount} actors, ${snapshot.observations.processCount} processes)`,
    `shared file: ${snapshot.observations.sharedPhysicalFile}`,
    `logical intents: ${snapshot.observations.logicalIntentCount}`,
    `validator union: ${snapshot.manifest.validatorSeal.unionDigest}`,
    `admission facade: ${snapshot.decisions.admissionFacadeDisposition}`,
    failed.length === 0 ? 'blockers: none' : `blockers: ${failed.map((entry) => entry.id).join(', ')}`
  ].join('\n');
}

function normalizeParticipant(participant: ReplayDashboardParticipant): ReplayDashboardParticipant {
  return {
    ...participant,
    worktreeRoot: normalizePath(participant.worktreeRoot),
    selectedTaskIds: participant.selectedTaskIds ? [...participant.selectedTaskIds].sort() : undefined,
    queuedTaskIds: participant.queuedTaskIds ? [...participant.queuedTaskIds].sort() : undefined
  };
}

function normalizeIntent(intent: ReplayDashboardLogicalIntent): ReplayDashboardLogicalIntent {
  return { ...intent, physicalPath: normalizePath(intent.physicalPath), proposalRoot: intent.proposalRoot ? normalizePath(intent.proposalRoot) : intent.proposalRoot };
}

function predicate(id: string, pass: boolean, reason: string): ReplayDashboardPredicate {
  return { id, status: pass ? 'pass' : 'fail', reason };
}

function normalizePath(value: string): string {
  return String(value ?? '').trim().replace(/\\/g, '/');
}

function distinct(values: readonly string[]): Set<string> {
  return new Set(values.filter(Boolean));
}

function compareBy<T>(key: keyof T) {
  return (left: T, right: T) => String(left[key]).localeCompare(String(right[key]));
}

function sortRecord(record: Readonly<Record<string, number | string | boolean>>): Record<string, number | string | boolean> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}
