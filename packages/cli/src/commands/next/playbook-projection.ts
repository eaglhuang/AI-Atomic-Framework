// @ts-nocheck
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadHumanReviewQueueDocument } from '../../../../plugin-human-review/src/index.ts';
import { buildGovernanceReadinessHintContract } from './governance-readiness.ts';
import { buildTeamRecommendation } from '../team.ts';
import { buildTeamKnowledgeSummary } from '../team-knowledge.ts';
import { createFrameworkModeStatus } from '../framework-development.ts';
import { inspectIntegrationBootstrap, describeIntegrationInstallHint } from '../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
import { allowedGuidanceBootstrapCommands, blockedMutationCommands } from './channel-strategy.ts';
import { ensureDecisionTrail, readTaskId } from './next-action-assembly.ts';
import { shouldEmitPromptWorktreeHint } from './worktree-hints.ts';
import { buildTaskScopedClaimCommand } from './task-scoped-claim-command.ts';
import { parseMarkdownFrontmatter, normalizeTaskRouteStatus, normalizeOptionalTaskPath, normalizeSearchText, readStringArray } from './intent-normalizers.ts';
import { isFrameworkMaintenancePrompt, type ImportedTaskQueue, type ImportedTaskSummary } from './route-predicates.ts';
import { dedupeStrings, quoteCliValue, toTaskCandidateView, uniqueSorted } from './view-projections.ts';
import { extractPathLikeStringsFromPrompt, isPathAllowedByScope } from '../work-channels.ts';
import { CliError, makeResult, message, parseJsonText } from '../shared.ts';
import { allowsPlanningMirror, compareGuidedLegacyQueuePriority, compareIsoDesc } from './match-and-sort.ts';
import { finalizeImportedTaskSummary, normalizeOptionalString } from './route-resolution.ts';
import { listActorWorkSessions, resolveActorWorkSession } from '../actor-session.ts';

const NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS = 30 * 60;

export function enrichWithLegacyPlan(cwd: string, base: GuidanceNextAction, plan: LegacyRoutePlan, sessionId: string): GuidanceNextAction {
  const safeSegments = plan.segments.filter((s: LegacyRoutePlanSegment) => plan.safeFirstAtoms.includes(s.symbolName));
  const preferredSegment: LegacyRoutePlanSegment | null =
    safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'split')
    ?? safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'infect')
    ?? safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'atomize')
    ?? null;
  const blockedSegments: readonly string[] = plan.trunkFunctions;

  if (!preferredSegment) {
    return {
      ...base,
      status: 'blocked',
      reason: 'No safe leaf segment is available in the LegacyRoutePlan. Submit a split proposal before proceeding.',
      blockedSegments
    };
  }

  const legacyTarget = `${plan.targetFile}#${preferredSegment.symbolName}`;
  const queueMatch = findMatchingGuidedLegacyProposal(cwd, {
    guidanceSession: sessionId,
    legacyTarget,
    behaviorId: `behavior.${preferredSegment.recommendedBehavior}`
  });
  if (queueMatch) {
    const actualPatchEvidence = queueMatch.status === 'approved'
      ? findGuidedLegacyActualPatchEvidence(cwd, queueMatch.proposalId)
      : null;
    const command = actualPatchEvidence
      ? `node atm.mjs review rollout-ready ${quoteCliValue(queueMatch.proposalId)} --json`
      : queueMatch.status === 'approved'
        ? `node atm.mjs review apply-ready ${quoteCliValue(queueMatch.proposalId)} --json`
      : `node atm.mjs review show ${quoteCliValue(queueMatch.proposalId)} --json`;
    const waitingForReview = queueMatch.status === 'pending' || queueMatch.status === 'blocked';
    const missingEvidence = reconcileProposalMissingEvidence(base.missingEvidence, preferredSegment.recommendedBehavior, queueMatch.status);
    return {
      ...base,
      status: 'action',
      command,
      reason: actualPatchEvidence
        ? `Approved guided legacy proposal ${queueMatch.proposalId} already has actual patch, smoke evidence, and rollback-ready proof; inspect the rollout-ready packet before closing the governed rollout.`
        : queueMatch.status === 'approved'
        ? `Approved guided legacy dry-run proposal ${queueMatch.proposalId} already covers ${legacyTarget}; inspect the approved boundary and proceed with actual patch planning inside that safe leaf.`
        : `Matching guided legacy dry-run proposal ${queueMatch.proposalId} already exists for ${legacyTarget}; inspect that proposal instead of generating a duplicate.`,
      allowedCommands: Array.from(new Set([...base.allowedCommands, command])),
      selectedSegment: preferredSegment.symbolName,
      legacyTarget,
      targetFile: plan.targetFile,
      selectedBehavior: preferredSegment.recommendedBehavior,
      blockedSegments,
      proposalId: queueMatch.proposalId,
      proposalStatus: queueMatch.status,
      nextRouteState: actualPatchEvidence
        ? 'proposal-rollout-ready'
        : queueMatch.status === 'approved'
        ? 'proposal-approved'
        : queueMatch.status === 'rejected'
          ? 'proposal-rejected'
          : 'proposal-pending-review',
      missingEvidence: actualPatchEvidence
        ? []
        : waitingForReview
        ? dedupeStrings([...missingEvidence, 'human review before apply'])
        : missingEvidence
    };
  }

  const command = `node atm.mjs upgrade --propose --behavior behavior.${preferredSegment.recommendedBehavior} --legacy-target ${quoteCliValue(legacyTarget)} --guidance-session ${quoteCliValue(sessionId)} --dry-run --json`;

  return {
    ...base,
    status: 'action',
    command,
    allowedCommands: Array.from(new Set([...base.allowedCommands, command])),
    selectedSegment: preferredSegment.symbolName,
    legacyTarget,
    targetFile: plan.targetFile,
    selectedBehavior: preferredSegment.recommendedBehavior,
    blockedSegments,
    nextRouteState: 'proposal-required'
  };
}

interface MatchingGuidedLegacyProposal {
  readonly proposalId: string;
  readonly status: HumanReviewQueueStatus;
}

interface GuidedLegacyActualPatchEvidence {
  readonly reportPath: string;
  readonly proposalId: string;
  readonly generatedAt?: string;
  readonly smokeEvidence?: readonly unknown[];
  readonly rollbackReadyProof?: {
    readonly proofPath?: string;
    readonly patchPath?: string;
  } | null;
}

function findMatchingGuidedLegacyProposal(
  cwd: string,
  criteria: {
    readonly guidanceSession: string;
    readonly legacyTarget: string;
    readonly behaviorId: string;
  }
): MatchingGuidedLegacyProposal | null {
  const queuePath = path.join(cwd, '.atm', 'history', 'reports', 'upgrade-proposals.json');
  const queue = loadHumanReviewQueueDocument(queuePath);
  if (!queue) {
    return null;
  }

  const matches = queue.entries
    .filter((entry) => isMatchingGuidedLegacyProposal(entry, criteria))
    .sort(compareGuidedLegacyQueuePriority);

  const selected = matches[0];
  if (!selected) {
    return null;
  }

  return {
    proposalId: selected.proposalId,
    status: selected.status
  };
}

function isMatchingGuidedLegacyProposal(
  entry: HumanReviewQueueRecord,
  criteria: {
    readonly guidanceSession: string;
    readonly legacyTarget: string;
    readonly behaviorId: string;
  }
) {
  return entry.proposal.guidanceSession === criteria.guidanceSession
    && entry.proposal.legacyTarget === criteria.legacyTarget
    && entry.proposal.behaviorId === criteria.behaviorId;
}



function findGuidedLegacyActualPatchEvidence(cwd: string, proposalId: string): GuidedLegacyActualPatchEvidence | null {
  const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
  if (!existsSync(reportsRoot)) {
    return null;
  }

  const matches = readdirSync(reportsRoot)
    .filter((entry) => entry.startsWith('actual-patch-evidence.') && entry.endsWith('.json'))
    .flatMap((entry): GuidedLegacyActualPatchEvidence[] => {
      const reportPath = path.join(reportsRoot, entry);
      try {
        const parsed = parseJsonText(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
        if (parsed['proposalId'] !== proposalId) {
          return [];
        }
        const smokeEvidence = Array.isArray(parsed['smokeEvidence']) ? parsed['smokeEvidence'] : [];
        const rollbackReadyProof = parsed['rollbackReadyProof'] && typeof parsed['rollbackReadyProof'] === 'object'
          ? parsed['rollbackReadyProof'] as { readonly proofPath?: string; readonly patchPath?: string; }
          : null;
        if (smokeEvidence.length === 0 || !rollbackReadyProof?.proofPath) {
          return [];
        }
        return [{
          reportPath: path.relative(cwd, reportPath).replace(/\\/g, '/'),
          proposalId,
          generatedAt: typeof parsed['generatedAt'] === 'string' ? parsed['generatedAt'] : undefined,
          smokeEvidence,
          rollbackReadyProof
        }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => compareIsoDesc(left.generatedAt, right.generatedAt));

  return matches[0] ?? null;
}


function reconcileProposalMissingEvidence(
  missingEvidence: readonly string[],
  behavior: string,
  proposalStatus: HumanReviewQueueStatus
) {
  const filtered = missingEvidence.filter((entry) => entry !== `${behavior} dry-run proposal`);
  if (proposalStatus === 'approved' || proposalStatus === 'rejected') {
    return filtered.filter((entry) => entry !== 'human review before apply');
  }
  return filtered;
}

function mapStatusToSlashCommandId(status: string): string {
  if (status === 'needs-bootstrap' || status === 'needs-onboarding-refresh') {
    return 'atm-next';
  }
  if (status === 'needs-guidance-start') {
    return 'atm-orient';
  }
  if (status === 'needs-evidence' || status === 'needs-validation' || status === 'blocked') {
    return 'atm-evidence';
  }
  if (status === 'needs-handoff') {
    return 'atm-handoff';
  }
  return 'atm-next';
}

export function buildAgentPackHint(status: string, command?: string | null, reason?: string | null) {
  return {
    slashCommandId: mapStatusToSlashCommandId(status),
    route: status,
    command: command ?? '',
    reason: reason ?? ''
  };
}

function buildTaskflowCloseOperatorCommands(taskId: string, actor: string) {
  const id = taskId || '<task-id>';
  return {
    preClose: `node atm.mjs taskflow pre-close --task ${id} --actor ${actor} --json`,
    dryRun: `node atm.mjs taskflow close --task ${id} --actor ${actor} --json`,
    write: `node atm.mjs taskflow close --task ${id} --actor ${actor} --write --json`
  };
}

export function buildTaskDeliveryPrinciple(input: { readonly channel: 'normal' | 'batch'; readonly taskId?: string }) {
  return {
    schemaId: 'atm.taskDeliveryPrinciple.v1',
    taskId: input.taskId ?? null,
    channel: input.channel,
    principle: 'The goal is to deliver the requested task content, not to close task cards.',
    instruction: 'Implement or update the real non-.atm deliverables first; only close the task after those deliverables exist and validators/evidence pass.',
    doneMeans: 'done records completed delivery; it is not the objective itself.',
    notAllowedAsCompletion: [
      'changing only .atm/history task status or task events',
      'adding text-only evidence without real deliverable files',
      'replaying or cherry-picking old close commits',
      'batch-closing later tasks before the current queue head is delivered'
    ],
    nextStep: input.channel === 'batch'
      ? 'Work only on the current queue head, produce its real deliverables, then run node atm.mjs batch checkpoint --actor <id> --json.'
      : 'Run taskflow pre-close, then taskflow close dry-run (no --write), read evidence.writeReadinessHint.blockers[].requiredCommand, then taskflow close --write.'
  };
}

export function buildMirrorSyncNextAction(input: {
  readonly task: ImportedTaskSummary;
  readonly classification: TaskDeliveryClassification;
}): NextActionLike {
  const sourcePath = input.task.sourcePlanPath ?? '<source-task-card-path>';
  const hasActiveClaim = typeof input.task.activeClaimActorId === 'string' && input.task.activeClaimActorId.length > 0;
  const importCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --write --force --json`;
  const dryRunCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --dry-run --json`;

  if (hasActiveClaim) {
    return {
      status: 'task-mirror-sync-blocked',
      command: dryRunCommand,
      reason: `Task ${input.task.workItemId} has an active claim by actor ${input.task.activeClaimActorId}. Mirror-sync write is blocked to prevent claim/lock overwrite.`,
      recommendedChannel: 'mirror-sync' as const,
      riskLevel: 'high' as const,
      requiredCommand: null,
      deliveryClassification: input.classification,
      mirrorSync: {
        schemaId: 'atm.taskMirrorSync.v1',
        taskId: input.task.workItemId,
        targetRepo: input.classification.targetRepo,
        closureAuthority: input.classification.closureAuthority,
        planningRepo: input.classification.planningRepo,
        ledgerStatus: input.classification.ledgerStatus,
        sourceStatus: input.classification.sourceStatus,
        statusDivergence: input.classification.statusDivergence,
        sourcePlanPath: input.task.sourcePlanPath,
        ledgerMirrorPath: input.task.taskPath,
        recommendedCommandSequence: [
          `# WARNING: Active claim exists for ${input.task.activeClaimActorId}`,
          `# Release or handoff the task before performing a forced mirror write.`,
          dryRunCommand
        ],
        doNotDeliverHere: true
      },
      allowedCommands: [
        dryRunCommand,
        'node atm.mjs tasks audit --task <task-id> --json',
        'node atm.mjs framework-mode status --json'
      ],
      blockedCommands: [
        importCommand,
        'editing or staging this task\'s deliverables in the current repo',
        'node atm.mjs next --claim for this task in the current repo',
        'node atm.mjs tasks close for this task in the current repo'
      ]
    };
  }

  return {
    status: 'task-mirror-sync-required',
    command: input.classification.statusDivergence ? importCommand : dryRunCommand,
    reason: input.classification.reason,
    recommendedChannel: 'mirror-sync' as const,
    riskLevel: 'low' as const,
    requiredCommand: input.classification.statusDivergence ? importCommand : dryRunCommand,
    deliveryClassification: input.classification,
    mirrorSync: {
      schemaId: 'atm.taskMirrorSync.v1',
      taskId: input.task.workItemId,
      targetRepo: input.classification.targetRepo,
      closureAuthority: input.classification.closureAuthority,
      planningRepo: input.classification.planningRepo,
      ledgerStatus: input.classification.ledgerStatus,
      sourceStatus: input.classification.sourceStatus,
      statusDivergence: input.classification.statusDivergence,
      sourcePlanPath: input.task.sourcePlanPath,
      ledgerMirrorPath: input.task.taskPath,
      recommendedCommandSequence: input.classification.statusDivergence
        ? [
          importCommand,
          `git add ${quoteCliValue(input.task.taskPath)}`,
          `git commit -m "atm: sync ${input.task.workItemId} ledger mirror from planning source"`
        ]
        : [dryRunCommand],
      doNotDeliverHere: true
    },
    allowedCommands: [
      importCommand,
      dryRunCommand,
      'node atm.mjs tasks audit --task <task-id> --json',
      'node atm.mjs framework-mode status --json'
    ],
    blockedCommands: [
      'editing or staging this task\'s deliverables in the current repo',
      'node atm.mjs next --claim for this task in the current repo',
      'node atm.mjs tasks close for this task in the current repo',
      'creating evidence for non-existent deliverable files'
    ]
  };
}

type BatchPlaybookState = 'queue-preview' | 'queue-head-active' | 'repair-required';

interface ActiveTaskDivergence {
  readonly activeTask: ImportedTaskSummary;
  readonly reasons: readonly string[];
  readonly promptPaths: readonly string[];
  readonly mentionedOtherTaskIds: readonly string[];
}

export function buildActiveTaskDivergenceResult(input: {
  readonly cwd: string;
  readonly taskIntent: TaskIntent | null;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  const divergence = detectActiveTaskDivergence(input.cwd, input.taskIntent, input.importedTaskQueue);
  if (!divergence) return null;
  const activeTaskId = divergence.activeTask.workItemId;
  const nextAction = {
    status: 'active-task-divergence-blocked',
    command: 'node atm.mjs next --prompt "<specific task id or imported task card>" --json',
    reason: `the prompt appears to diverge from active task ${activeTaskId}; ATM will not attach new work to the active task silently`,
    activeTask: toTaskCandidateView(divergence.activeTask),
    divergence,
    decisionOptions: [
      'Open or import a new task card for the new work.',
      `Repair ${activeTaskId} metadata if the prompt really belongs to the active task.`,
      `Continue intentionally by naming ${activeTaskId} in the prompt.`
    ],
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands(),
    decisionTrail: [
      {
        check: 'route-status',
        result: 'blocked',
        reason: `ATM detected prompt divergence from active task ${activeTaskId}.`
      },
      {
        check: 'active-task-divergence',
        result: 'blocked',
        reason: divergence.reasons.join('; ')
      }
    ] satisfies NextDecisionTrailEntry[]
  };
  return makeResult({
    ok: false,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      null,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message('error', 'ATM_NEXT_ACTIVE_TASK_DIVERGENCE_BLOCKED', `Prompt diverges from active task ${activeTaskId}; ATM refused to auto-attach it.`, {
        activeTaskId,
        reasons: divergence.reasons,
        promptPaths: divergence.promptPaths,
        mentionedOtherTaskIds: divergence.mentionedOtherTaskIds,
        remediation: nextAction.decisionOptions
      })
    ),
    evidence: {
      nextAction,
      taskIntent: input.taskIntent,
      importedTaskQueue: input.importedTaskQueue,
      activeTaskDivergence: divergence,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
}

function detectActiveTaskDivergence(
  cwd: string,
  taskIntent: TaskIntent | null,
  importedTaskQueue: ImportedTaskQueue
): ActiveTaskDivergence | null {
  const prompt = taskIntent?.userPrompt?.trim() ?? '';
  if (!prompt) return null;
  if (importedTaskQueue.promptScope && importedTaskQueue.promptScope.status !== 'not-found') return null;
  const activeTasks = readActiveClaimedTasks(cwd);
  if (activeTasks.length === 0) return null;
  const activeTaskIds = activeTasks.map((task) => task.workItemId.toUpperCase());
  const mentionedTaskIds = uniqueSorted([
    ...(taskIntent?.mentionedTaskIds ?? []),
    ...(taskIntent?.explicitTaskIds ?? [])
  ].map((taskId) => taskId.toUpperCase()));
  if (mentionedTaskIds.some((taskId) => activeTaskIds.includes(taskId))) return null;

  const reasons: string[] = [];
  const mentionedOtherTaskIds = mentionedTaskIds.filter((taskId) => !activeTaskIds.includes(taskId));
  if (mentionedOtherTaskIds.length > 0) {
    reasons.push(`prompt names other task id(s): ${mentionedOtherTaskIds.join(', ')}`);
  }
  if (mentionsNotCurrentTask(prompt)) {
    reasons.push('prompt explicitly says it is not the current active task');
  }
  const promptPaths = extractPathLikeStringsFromPrompt(prompt)
    .map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim())
    .filter((entry) => entry.length > 0);
  const activeScope = uniqueSorted(activeTasks.flatMap((task) => [
    ...task.scopePaths,
    ...task.targetAllowedFiles
  ]));
  const outsidePromptPaths = promptPaths.filter((entry) => !isPathAllowedByScope(entry, activeScope));
  if (outsidePromptPaths.length > 0) {
    reasons.push(`prompt path(s) are outside active task scope(s): ${outsidePromptPaths.join(', ')}`);
  }
  return reasons.length > 0
    ? { activeTask: activeTasks[0], reasons, promptPaths, mentionedOtherTaskIds }
    : null;
}

function readActiveClaimedTasks(cwd: string): ImportedTaskSummary[] {
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskStorePath)) return [];
  return readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ImportedTaskSummary[] => {
      const filePath = path.join(taskStorePath, entry);
      try {
        const parsed = parseJsonText(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
        if (!workItemId || normalizeTaskRouteStatus(normalizeOptionalString(parsed.status) ?? '') !== 'running') return [];
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
          ? parsed.claim as Record<string, unknown>
          : {};
        if (claimRecord.state !== 'active') return [];
        const source = parsed.source && typeof parsed.source === 'object' && !Array.isArray(parsed.source)
          ? parsed.source as Record<string, unknown>
          : {};
        return [finalizeImportedTaskSummary({
          workItemId,
          title: normalizeOptionalString(parsed.title) ?? workItemId,
          status: normalizeOptionalString(parsed.status) ?? 'running',
          closedAt: normalizeOptionalString(parsed.closedAt ?? parsed.closed_at),
          closedByActor: normalizeOptionalString(parsed.closedByActor ?? parsed.closed_by_actor),
          closurePacket: normalizeOptionalString(parsed.closurePacket ?? parsed.closure_packet),
          lastTransitionId: normalizeOptionalString(parsed.lastTransitionId ?? parsed.last_transition_id),
          lastTransitionAt: normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at),
          milestone: normalizeOptionalString(parsed.milestone),
          dependencies: readStringArray(parsed.dependencies),
          taskPath: path.relative(cwd, filePath).replace(/\\/g, '/'),
          format: 'json',
          sourcePlanPath: normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path),
          nearbyPlanPaths: [],
          scopePaths: uniqueSorted([
            ...readStringArray(parsed.scope),
            ...readStringArray(parsed.scopePaths),
            ...readStringArray(parsed.files),
            ...readStringArray(claimRecord.files)
          ]),
          outOfScope: readStringArray(parsed.outOfScope ?? parsed.out_of_scope),
          targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo),
          planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
          allowPlanningMirror: allowsPlanningMirror(parsed),
          closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
          activeClaimActorId: normalizeOptionalString(claimRecord.actorId),
          activeClaimIntent: normalizeOptionalString(claimRecord.intent) ?? 'write'
        }, cwd)];
      } catch {
        return [];
      }
    });
}

export interface ActiveWorkSummary {
  readonly schemaId: 'atm.activeWorkSummary.v1';
  readonly generatedAt: string;
  readonly activeClaimCount: number;
  readonly activeActors: readonly {
    readonly actorId: string;
    readonly taskIds: readonly string[];
    readonly fileCount: number;
    readonly sessionIds: readonly string[];
    readonly sessionCount: number;
    readonly editors: readonly string[];
  }[];
  readonly activeClaims: readonly {
    readonly taskId: string;
    readonly title: string;
    readonly actorId: string;
    readonly leaseId: string | null;
    readonly sessionId: string | null;
    readonly editor: string | null;
    readonly gitName: string | null;
    readonly intent: string;
    readonly claimedAt: string | null;
    readonly heartbeatAt: string | null;
    readonly heartbeatAgeSeconds: number | null;
    readonly ttlSeconds: number | null;
    readonly leaseFresh: boolean | null;
    readonly files: readonly string[];
  }[];
  readonly activeLocks: readonly {
    readonly workItemId: string;
    readonly actorId: string;
    readonly heartbeatAt: string | null;
    readonly heartbeatAgeSeconds: number | null;
    readonly ttlSeconds: number | null;
    readonly leaseFresh: boolean | null;
    readonly files: readonly string[];
  }[];
  readonly freshReservationCount: number;
  readonly freshReservations: readonly {
    readonly taskId: string;
    readonly title: string;
    readonly actorId: string;
    readonly createdAt: string | null;
    readonly importedAt: string | null;
    readonly ageSeconds: number;
    readonly ttlSeconds: number;
    readonly leaseFresh: boolean;
    readonly files: readonly string[];
  }[];
  readonly stagedFiles: readonly string[];
  readonly hasForeignActiveWork: boolean;
  readonly teamLevelRecommendation: {
    readonly level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
    readonly reason: string;
    readonly ownFiles: readonly string[];
    readonly overlappingFiles: readonly string[];
    readonly foreignActors: readonly string[];
    readonly foreignSessions: readonly string[];
  };
  readonly brokerRecommendation: {
    readonly enabled: boolean;
    readonly reason: string | null;
    readonly statusCommand: string;
    readonly brokerStatusCommand: string;
    readonly teamStatusCommand: string;
  };
}

export function buildActiveWorkSummary(cwd: string, currentActorId?: string | null, ownFiles: readonly string[] = []): ActiveWorkSummary {
  const now = Date.now();
  const currentActor = currentActorId?.trim() || null;
  const normalizedOwnFiles = uniqueSorted(ownFiles.map(normalizeWorkPath).filter(Boolean));
  const activeClaims = readActiveClaimRecords(cwd, now);
  const activeLocks = readActiveLockRecords(cwd, now);
  const freshReservations = readFreshTaskReservations(cwd, now);
  const stagedFiles = readStagedFiles(cwd);
  const currentSession = resolveActorWorkSession(cwd, {});
  const currentSessionId = currentSession?.sessionId ?? null;
  const actorMap = new Map<string, { taskIds: Set<string>; files: Set<string>; sessionIds: Set<string>; editors: Set<string> }>();
  for (const claim of activeClaims) {
    const bucket = actorMap.get(claim.actorId) ?? { taskIds: new Set<string>(), files: new Set<string>(), sessionIds: new Set<string>(), editors: new Set<string>() };
    bucket.taskIds.add(claim.taskId);
    for (const file of claim.files) bucket.files.add(file);
    if (claim.sessionId) bucket.sessionIds.add(claim.sessionId);
    if (claim.editor) bucket.editors.add(claim.editor);
    actorMap.set(claim.actorId, bucket);
  }
  for (const lock of activeLocks) {
    const bucket = actorMap.get(lock.actorId) ?? { taskIds: new Set<string>(), files: new Set<string>(), sessionIds: new Set<string>(), editors: new Set<string>() };
    bucket.taskIds.add(lock.workItemId);
    for (const file of lock.files) bucket.files.add(file);
    actorMap.set(lock.actorId, bucket);
  }
  for (const reservation of freshReservations) {
    const bucket = actorMap.get(reservation.actorId) ?? { taskIds: new Set<string>(), files: new Set<string>(), sessionIds: new Set<string>(), editors: new Set<string>() };
    bucket.taskIds.add(reservation.taskId);
    for (const file of reservation.files) bucket.files.add(file);
    actorMap.set(reservation.actorId, bucket);
  }
  const activeActors = [...actorMap.entries()]
    .map(([actorId, value]) => ({
      actorId,
      taskIds: [...value.taskIds].sort((left, right) => left.localeCompare(right)),
      fileCount: value.files.size,
      sessionIds: [...value.sessionIds].sort((left, right) => left.localeCompare(right)),
      sessionCount: value.sessionIds.size,
      editors: [...value.editors].sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  const foreignActors = activeActors.filter((actor) => !currentActor || actor.actorId !== currentActor);
  const foreignSessions = activeClaims.filter((claim) =>
    claim.sessionId
    && currentActor
    && claim.actorId === currentActor
    && (!currentSessionId || claim.sessionId !== currentSessionId)
  );
  const foreignActorIds = uniqueSorted([
    ...foreignActors.map((actor) => actor.actorId),
    ...foreignSessions.map((claim) => claim.actorId)
  ]);
  const foreignSessionIds = uniqueSorted(foreignSessions.map((claim) => claim.sessionId).filter((entry): entry is string => Boolean(entry)));
  const hasForeignActiveWork = foreignActors.length > 0 || foreignSessionIds.length > 0 || stagedFiles.length > 0;
  const teamLevelRecommendation = buildTeamLevelRecommendation({
    ownFiles: normalizedOwnFiles,
    activeClaims,
    activeLocks,
    freshReservations,
    stagedFiles,
    foreignActorIds,
    foreignSessionIds
  });
  const reasonParts = [
    ...(foreignActors.length > 0 ? [`${foreignActors.length} other active actor(s): ${foreignActors.map((entry) => entry.actorId).join(', ')}`] : []),
    ...(foreignSessionIds.length > 0 ? [`${foreignSessionIds.length} other active session(s) for current actor: ${foreignSessionIds.join(', ')}`] : []),
    ...(freshReservations.length > 0 ? [`${freshReservations.length} fresh task reservation(s) visible`] : []),
    ...(stagedFiles.length > 0 ? [`${stagedFiles.length} staged file(s) present in the shared index`] : [])
  ];
  return {
    schemaId: 'atm.activeWorkSummary.v1',
    generatedAt: new Date(now).toISOString(),
    activeClaimCount: activeClaims.length,
    activeActors,
    activeClaims,
    activeLocks,
    freshReservationCount: freshReservations.length,
    freshReservations,
    stagedFiles,
    hasForeignActiveWork,
    teamLevelRecommendation,
    brokerRecommendation: {
      enabled: hasForeignActiveWork,
      reason: reasonParts.length > 0 ? reasonParts.join('; ') : null,
      statusCommand: 'node atm.mjs tasks status --json',
      brokerStatusCommand: 'node atm.mjs broker status --json',
      teamStatusCommand: 'node atm.mjs team status --compact --json'
    }
  };
}

function buildTeamLevelRecommendation(input: {
  readonly ownFiles: readonly string[];
  readonly activeClaims: ActiveWorkSummary['activeClaims'];
  readonly activeLocks: ActiveWorkSummary['activeLocks'];
  readonly freshReservations: ActiveWorkSummary['freshReservations'];
  readonly stagedFiles: readonly string[];
  readonly foreignActorIds: readonly string[];
  readonly foreignSessionIds: readonly string[];
}): ActiveWorkSummary['teamLevelRecommendation'] {
  const ownSet = new Set(input.ownFiles);
  const foreignFiles = uniqueSorted([
    ...input.activeClaims.filter((claim) => input.foreignActorIds.includes(claim.actorId) || (claim.sessionId && input.foreignSessionIds.includes(claim.sessionId))).flatMap((claim) => claim.files),
    ...input.activeLocks.filter((lock) => input.foreignActorIds.includes(lock.actorId)).flatMap((lock) => lock.files),
    ...input.freshReservations.filter((reservation) => input.foreignActorIds.includes(reservation.actorId)).flatMap((reservation) => reservation.files)
  ]);
  const overlappingFiles = input.ownFiles.length > 0
    ? foreignFiles.filter((file) => ownSet.has(file))
    : [];
  const stagedOverlap = input.ownFiles.length > 0
    ? input.stagedFiles.filter((file) => ownSet.has(file))
    : [];
  const foreignActorCount = new Set(input.foreignActorIds).size;
  const foreignSessionCount = new Set(input.foreignSessionIds).size;
  const freshForeignReservationCount = input.freshReservations.filter((reservation) => input.foreignActorIds.includes(reservation.actorId)).length;
  const sharedIndexActive = input.stagedFiles.length > 0;
  const overlapCount = uniqueSorted([...overlappingFiles, ...stagedOverlap]).length;
  const foreignWorkCount = foreignActorCount + foreignSessionCount;
  const frameworkFoundationRisk = input.ownFiles.some(isFrameworkFoundationPath);
  if (frameworkFoundationRisk && (foreignWorkCount > 0 || sharedIndexActive || overlapCount > 0)) {
    return {
      level: 'L5',
      reason: 'Framework foundation files are in scope while other active work or shared-index state exists; use the full Team Agent Broker lane.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (frameworkFoundationRisk) {
    return {
      level: 'L4',
      reason: 'Framework foundation files are in scope; use elevated coordination even without visible overlap.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (foreignWorkCount >= 3 || (overlapCount > 0 && sharedIndexActive && foreignWorkCount >= 2)) {
    return {
      level: 'L5',
      reason: 'Multiple active actors plus overlapping files or shared staged index require full Broker coordination with review and validation roles.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (overlapCount > 1 || (overlapCount > 0 && sharedIndexActive)) {
    return {
      level: 'L4',
      reason: 'Active foreign work overlaps this scope across multiple files or the shared index, so add a coordinator plus review/validation coverage.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (overlapCount === 1 || sharedIndexActive) {
    return {
      level: 'L3',
      reason: 'A concrete same-file or shared-index risk is present; use Broker arbitration with an implementer and validator lane.',
      ownFiles: input.ownFiles,
      overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (freshForeignReservationCount > 0) {
    return {
      level: 'L3',
      reason: 'Fresh foreign-created task reservations are visible; use Broker arbitration before claiming another captain\'s newly opened work.',
      ownFiles: input.ownFiles,
      overlappingFiles: [],
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  if (foreignWorkCount > 0) {
    return {
      level: 'L2',
      reason: 'Other active actors exist but no file overlap is visible for this scope; keep coordination light and monitor Broker status.',
      ownFiles: input.ownFiles,
      overlappingFiles: [],
      foreignActors: uniqueSorted(input.foreignActorIds),
      foreignSessions: uniqueSorted(input.foreignSessionIds)
    };
  }
  return {
    level: 'L1',
    reason: 'No foreign active work or shared-index risk is visible; a single coordinator/implementer path is enough.',
    ownFiles: input.ownFiles,
    overlappingFiles: [],
    foreignActors: [],
    foreignSessions: []
  };
}

function isFrameworkFoundationPath(filePath: string): boolean {
  const normalized = normalizeWorkPath(filePath);
  return normalized.startsWith('packages/core/')
    || /^packages\/cli\/src\/commands\/(?:next(?:\.ts|\/)|broker\.ts|team\.ts|taskflow\.ts|git-governance\.ts|integration-hooks\.ts|hook\/pre-commit\.ts|tasks\/(?:claim-intent|close-window-lock|import-orchestrator|legacy-impl|task-option-parsers)\.ts)/.test(normalized)
    || normalized.startsWith('packages/cli/src/commands/next/')
    || normalized.startsWith('packages/cli/src/commands/taskflow/')
    || normalized.startsWith('packages/cli/src/commands/framework-development/')
    || normalized.startsWith('packages/integrations-core/src/compiler/')
    || normalized.startsWith('packages/core/src/broker/')
    || normalized.startsWith('packages/core/src/team-runtime/');
}

export function inspectFreshTaskReservationForTask(
  cwd: string,
  task: ImportedTaskSummary,
  currentActorId: string | null | undefined,
  now: number
): ActiveWorkSummary['freshReservations'][number] | null {
  const reservations = readFreshTaskReservations(cwd, now);
  const currentActor = currentActorId?.trim() || null;
  return reservations.find((reservation) =>
    reservation.taskId === task.workItemId
    && (!currentActor || reservation.actorId !== currentActor)
  ) ?? null;
}

function readFreshTaskReservations(cwd: string, now: number): ActiveWorkSummary['freshReservations'] {
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskStorePath)) return [];
  return readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ActiveWorkSummary['freshReservations'] => {
      const filePath = path.join(taskStorePath, entry);
      try {
        const parsed = parseJsonText(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
        if (!workItemId) return [];
        if (!isTaskFreshReservationCandidate(parsed)) return [];
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
          ? parsed.claim as Record<string, unknown>
          : {};
        if (claimRecord.state === 'active') return [];
        const source = parsed.source && typeof parsed.source === 'object' && !Array.isArray(parsed.source)
          ? parsed.source as Record<string, unknown>
          : {};
        const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
        const sourceOwner = readPlanningCardOwner(cwd, sourcePlanPath);
        const actorId = sourceOwner
          ?? normalizeOptionalString(parsed.owner ?? parsed.ownerActorId ?? parsed.createdByActor ?? parsed.createdBy ?? parsed.importedByActor ?? parsed.importedBy ?? source.owner ?? source.actorId);
        if (!actorId) return [];
        const createdAt = normalizeOptionalString(parsed.createdAt ?? parsed.created_at ?? source.createdAt ?? source.created_at);
        const importedAt = normalizeOptionalString(parsed.importedAt ?? parsed.imported_at ?? source.importedAt ?? source.imported_at);
        const referenceAt = parseIsoMillis(importedAt) ?? parseIsoMillis(createdAt) ?? parseIsoMillis(normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at));
        if (referenceAt === null) return [];
        const ageSeconds = Math.max(0, Math.floor((now - referenceAt) / 1000));
        if (ageSeconds > NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS) return [];
        const files = uniqueSorted([
          ...readStringArray(parsed.scope),
          ...readStringArray(parsed.scopePaths),
          ...readStringArray(parsed.files),
          ...readStringArray(parsed.deliverables),
          ...readStringArray(parsed.targetAllowedFiles),
          ...readStringArray(claimRecord.files)
        ].map((file) => {
          const normalized = normalizeWorkPath(file);
          return path.isAbsolute(normalized) ? path.relative(cwd, normalized).replace(/\\/g, '/') : normalized;
        }).filter(Boolean));
        return [{
          taskId: workItemId,
          title: normalizeOptionalString(parsed.title) ?? workItemId,
          actorId,
          createdAt,
          importedAt,
          ageSeconds,
          ttlSeconds: NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS,
          leaseFresh: true,
          files
        }];
      } catch {
        return [];
      }
    });
}

function isTaskFreshReservationCandidate(parsed: Record<string, unknown>): boolean {
  const status = normalizeTaskRouteStatus(normalizeOptionalString(parsed.status) ?? 'planned');
  return status === 'planned' || status === 'ready' || status === 'open' || status === 'reserved';
}

function readPlanningCardOwner(cwd: string, sourcePlanPath: string | null): string | null {
  if (!sourcePlanPath) return null;
  const candidate = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
  if (!existsSync(candidate)) return null;
  try {
    const rawText = readFileSync(candidate, 'utf8');
    const frontmatter = parseMarkdownFrontmatter(rawText);
    const owner = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
      ? normalizeOptionalString((frontmatter as Record<string, unknown>).owner ?? (frontmatter as Record<string, unknown>).actor ?? (frontmatter as Record<string, unknown>).captain)
      : null;
    return owner ?? readFrontmatterScalar(rawText, 'owner') ?? readFrontmatterScalar(rawText, 'actor') ?? readFrontmatterScalar(rawText, 'captain');
  } catch {
    return null;
  }
}

function readFrontmatterScalar(rawText: string, key: string): string | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(rawText);
  if (!match) return null;
  const line = match[1].split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}:`));
  if (!line) return null;
  return normalizeOptionalString(line.slice(line.indexOf(':') + 1).replace(/^['"]|['"]$/g, ''));
}

function parseIsoMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function readActiveClaimRecords(cwd: string, now: number): ActiveWorkSummary['activeClaims'] {
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskStorePath)) return [];
  const sessionsByLeaseId = new Map<string, ReturnType<typeof listActorWorkSessions>[number]>();
  for (const session of listActorWorkSessions(cwd)) {
    if (session.claimLeaseId) sessionsByLeaseId.set(session.claimLeaseId, session);
  }
  return readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ActiveWorkSummary['activeClaims'] => {
      const filePath = path.join(taskStorePath, entry);
      try {
        const parsed = parseJsonText(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
        if (!workItemId) return [];
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
          ? parsed.claim as Record<string, unknown>
          : {};
        if (claimRecord.state !== 'active') return [];
        const actorId = normalizeOptionalString(claimRecord.actorId);
        if (!actorId) return [];
        const heartbeatAt = normalizeOptionalString(claimRecord.heartbeatAt);
        const ttlSeconds = normalizeOptionalNumber(claimRecord.ttlSeconds);
        const leaseId = normalizeOptionalString(claimRecord.leaseId);
        const session = leaseId ? sessionsByLeaseId.get(leaseId) ?? null : null;
        return [{
          taskId: workItemId,
          title: normalizeOptionalString(parsed.title) ?? workItemId,
          actorId,
          leaseId,
          sessionId: session?.sessionId ?? normalizeOptionalString(parsed.startedBySessionId) ?? null,
          editor: session?.editor ?? null,
          gitName: session?.gitName ?? null,
          intent: normalizeOptionalString(claimRecord.intent) ?? 'write',
          claimedAt: normalizeOptionalString(claimRecord.claimedAt),
          heartbeatAt,
          heartbeatAgeSeconds: heartbeatAt ? Math.max(0, Math.floor((now - Date.parse(heartbeatAt)) / 1000)) : null,
          ttlSeconds,
          leaseFresh: heartbeatAt && ttlSeconds !== null ? now - Date.parse(heartbeatAt) <= ttlSeconds * 1000 : null,
          files: uniqueSorted(readStringArray(claimRecord.files).map(normalizeWorkPath))
        }];
      } catch {
        return [];
      }
    });
}

function readActiveLockRecords(cwd: string, now: number): ActiveWorkSummary['activeLocks'] {
  const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
  if (!existsSync(lockRoot)) return [];
  return readdirSync(lockRoot)
    .filter((entry) => entry.endsWith('.lock.json'))
    .flatMap((entry): ActiveWorkSummary['activeLocks'] => {
      try {
        const parsed = parseJsonText(readFileSync(path.join(lockRoot, entry), 'utf8')) as Record<string, unknown>;
        if (normalizeOptionalString(parsed.status) === 'released') return [];
        const workItemId = normalizeOptionalString(parsed.workItemId);
        const actorId = normalizeOptionalString(parsed.actorId ?? parsed.lockedBy);
        if (!workItemId || !actorId) return [];
        const heartbeatAt = normalizeOptionalString(parsed.heartbeatAt ?? parsed.lockedAt);
        const ttlSeconds = normalizeOptionalNumber(parsed.ttlSeconds);
        return [{
          workItemId,
          actorId,
          heartbeatAt,
          heartbeatAgeSeconds: heartbeatAt ? Math.max(0, Math.floor((now - Date.parse(heartbeatAt)) / 1000)) : null,
          ttlSeconds,
          leaseFresh: heartbeatAt && ttlSeconds !== null ? now - Date.parse(heartbeatAt) <= ttlSeconds * 1000 : null,
          files: uniqueSorted(readStringArray(parsed.files).map(normalizeWorkPath))
        }];
      } catch {
        return [];
      }
    });
}

function normalizeOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeWorkPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function readStagedFiles(cwd: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', '--cached'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) return [];
  return uniqueSorted(String(result.stdout ?? '')
    .split(/\r?\n/)
    .map(normalizeWorkPath)
    .filter(Boolean));
}

function mentionsNotCurrentTask(prompt: string) {
  const normalized = normalizeSearchText(prompt);
  return /\bnot\s+(?:the\s+)?current\s+task\b|\bnot\s+(?:this\s+)?active\s+task\b/.test(normalized)
    || /不是(?:目前|當前|現在)?(?:這張|此)?(?:任務|active task|current task)/.test(prompt)
    || /不要(?:接|掛|綁|套|附著|attach)(?:到|在)?(?:目前|當前|現在)?(?:這張|此)?(?:任務|active task|current task)/i.test(prompt);
}

export function buildChannelPlaybook(input: {
  readonly channel: GovernanceChannel;
  readonly taskId?: string | null;
  readonly originalPrompt?: string | null;
  readonly queueHeadTaskId?: string | null;
  readonly actorPlaceholder?: string;
  readonly batchId?: string | null;
  readonly batchState?: BatchPlaybookState;
  readonly fastClaimCommand?: string | null;
  readonly fastClaimLabel?: string | null;
}) {
  const actor = input.actorPlaceholder ?? '<id>';
  const prompt = input.originalPrompt?.trim() || '<current user prompt>';
  const taskId = input.taskId ?? '<task-id>';
  const defaultClaimCommand = input.fastClaimCommand?.trim()
    || `node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --auto-intent --json`;
  const fastClaimLabel = input.fastClaimLabel?.trim() || 'quickfix lock';
  const closeOps = buildTaskflowCloseOperatorCommands(taskId, actor);
  if (input.channel === 'fast') {
    return {
      schemaId: 'atm.channelPlaybook.v1',
      channel: 'fast',
      title: 'Fast quickfix playbook',
      mustFollow: true,
      summary: 'Use this only for small, low-risk edits. It is not a task-card closure path.',
      steps: [
        `Run: ${defaultClaimCommand}`,
        'Edit only the allowed files returned by ATM.',
        'Run the smallest relevant validator for the touched file.',
        'Commit only the real non-.atm diff and same-commit governed provenance staged by the ATM git wrapper.'
      ],
      doNot: [
        'Do not edit .atm/history/**.',
        'Do not close task cards.',
        `Do not expand the scope after the ${fastClaimLabel} is created.`
      ],
      commandSequence: [
        defaultClaimCommand,
        '<edit allowed files>',
        '<run focused validator>',
        'git add <changed files>',
        `node atm.mjs git commit --actor ${actor} --message "<message>" --json`
      ],
      commitTiming: 'Commit after the focused validator passes. Prefer `node atm.mjs git commit` for governed framework work; bare `git commit` is for read-only inspection or non-governed maintenance only.',
      governedGitEntrypoint: {
        preferredCommand: `node atm.mjs git commit --actor ${actor} --message "<message>" --json`,
        directGitPolicy: 'Direct git remains available for read-only commands and non-governed maintenance. When staging .atm/history/** task or evidence files, use the ATM wrapper so trailers and claim binding stay consistent.'
      }
    };
  }
  if (input.channel === 'batch') {
    const head = input.queueHeadTaskId ?? input.taskId ?? '<queue-head-task-id>';
    const batchState = input.batchState ?? 'queue-head-active';
    const batchLabel = input.batchId ? `batch ${input.batchId}` : 'this batch';
    const isRepairState = batchState === 'repair-required';
    const batchClaimCommand = defaultClaimCommand;
    const batchRepairCommand = `node atm.mjs batch repair --actor ${actor}${input.batchId ? ` --batch ${input.batchId}` : ''} --json`;
    const stateSummary = batchState === 'queue-preview'
      ? 'This is a batch preview. Claim the queue head, then work one task at a time.'
      : isRepairState
        ? `${batchLabel} is out of sync and needs repair before any task work continues.`
        : 'This is an active batch. Keep work on the current queue head and checkpoint before commit.';
    const commandSequence = isRepairState
      ? [
        batchRepairCommand,
        batchClaimCommand,
        '<implement queue-head deliverables>',
        'node atm.mjs evidence add --task <queue-head-task-id> --actor <id> --kind test --freshness fresh --summary "<what passed>" --artifacts <real-files> --validators <validator-name> --command "<command>" --exit-code 0 --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json',
        'git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json',
        `node atm.mjs batch checkpoint --actor ${actor} --json`,
        'git add .atm/history/tasks/<queue-head-task-id>.json .atm/history/task-events/<queue-head-task-id>/',
        `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`
      ]
      : [
        batchClaimCommand,
        '<implement queue-head deliverables>',
        'node atm.mjs evidence add --task <queue-head-task-id> --actor <id> --kind test --freshness fresh --summary "<what passed>" --artifacts <real-files> --validators <validator-name> --command "<command>" --exit-code 0 --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json',
        'git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json',
        `node atm.mjs batch checkpoint --actor ${actor} --json`,
        'git add .atm/history/tasks/<queue-head-task-id>.json .atm/history/task-events/<queue-head-task-id>/',
        `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`
      ];
    return {
      schemaId: 'atm.channelPlaybook.v1',
      channel: 'batch',
      title: 'Batch queue-head playbook',
      mustFollow: true,
      summary: stateSummary,
      state: batchState,
      steps: isRepairState
        ? [
          `Run: ${batchRepairCommand}`,
          `Then rerun: ${batchClaimCommand}`,
          `Work only on the current queue head: ${head}.`,
          'Read that task contract and implement the real non-.atm deliverables.',
          'Run the required validator or a focused reproducible verification command.',
          'Add command-backed evidence for the current queue head.',
          'Stage the deliverables and evidence before checkpoint, but do not commit yet.',
          `Run: node atm.mjs batch checkpoint --actor ${actor} --json`,
          'After checkpoint succeeds, stage the updated .atm/history task/event files and create one commit that contains both deliverables and checkpoint state.',
          'Continue with the next queue head returned by batch checkpoint.'
        ]
        : [
          `Run: ${batchClaimCommand}`,
          `Work only on the current queue head: ${head}.`,
          'Read that task contract and implement the real non-.atm deliverables.',
          'Run the required validator or a focused reproducible verification command.',
          'Add command-backed evidence for the current queue head.',
          'Stage the deliverables and evidence before checkpoint, but do not commit yet.',
          `Run: node atm.mjs batch checkpoint --actor ${actor} --json`,
          'After checkpoint succeeds, stage the updated .atm/history task/event files and create one commit that contains both deliverables and checkpoint state.',
          'Continue with the next queue head returned by batch checkpoint.'
        ],
      doNot: [
        'Do not run tasks claim/close manually.',
        'Do not run next --prompt with a later single task id to leave batch.',
        'Do not commit before batch checkpoint succeeds.',
        'Do not close later tasks before the queue head is delivered.',
        'Do not use .atm/history/** changes as the deliverable.'
      ],
      commandSequence,
      commitTiming: isRepairState
        ? 'Repair the batch runtime first, then stage deliverables before checkpoint; commit once after batch checkpoint succeeds.'
        : 'Stage deliverables before checkpoint; commit once after batch checkpoint succeeds.',
      checkpointCommand: `node atm.mjs batch checkpoint --actor ${actor} --json`,
      repairCommand: batchRepairCommand,
      governedGitEntrypoint: {
        preferredCommand: `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`,
        directGitPolicy: 'Batch delivery commits must use the ATM wrapper after checkpoint; bare git commit is not banned for read-only inspection.'
      }
    };
  }
  return {
    schemaId: 'atm.channelPlaybook.v1',
    channel: 'normal',
    title: 'Single-task playbook',
    mustFollow: true,
    summary: 'Use this for one explicit task card. Preview close with taskflow pre-close and taskflow close dry-run before --write.',
    steps: [
      `Run: ${defaultClaimCommand}`,
      'Work only on the claimed task and its allowed files.',
      'Implement the real non-.atm deliverables.',
      'Run required validators or a focused reproducible verification command.',
      'Add command-backed evidence.',
      `Run: ${closeOps.preClose}`,
      `Run: ${closeOps.dryRun} and read evidence.writeReadinessHint.blockers[].requiredCommand`,
      `When ready: ${closeOps.write}`
    ],
    doNot: [
      'Do not manually claim before next --claim.',
      'Do not call tasks close directly for normal closeback; taskflow close owns the operator lane.',
      'Do not run taskflow close --write before dry-run/pre-close when blockers are unknown.',
      'Do not commit task closure separately from the deliverable it proves.'
    ],
    commandSequence: [
      defaultClaimCommand,
      '<implement task deliverables>',
      'node atm.mjs evidence run --task <task-id> --actor <id> --command "<validator>" --json',
      closeOps.preClose,
      closeOps.dryRun,
      closeOps.write,
      'git add <deliverables> .atm/history/tasks/<task-id>.json .atm/history/evidence/<task-id>.json .atm/history/task-events/<task-id>/',
      `node atm.mjs git commit --actor ${actor} --task <task-id> --message "<scope>: complete <task-id>" --json`
    ],
    closePreview: {
      schemaId: 'atm.taskflowClosePreviewPlaybook.v1',
      preCloseCommand: closeOps.preClose,
      dryRunCommand: closeOps.dryRun,
      writeCommand: closeOps.write,
      hintField: 'evidence.writeReadinessHint.blockers[].requiredCommand'
    },
    commitTiming: 'Commit only after taskflow close --write succeeds and the governed bundle is committed.',
    governedGitEntrypoint: {
      preferredCommand: `node atm.mjs git commit --actor ${actor} --task <task-id> --message "<scope>: complete <task-id>" --json`,
      directGitPolicy: 'Use taskflow close --write for normal closure. Bare git commit is not banned globally, but governed task/evidence bundles must use the ATM wrapper.',
      fallbackFields: ['copyableCommitCommand', 'hostGitCompatibilityGuidance']
    }
  };
}

export function embedTeamRecommendation<T extends { readonly playbook?: unknown }>(
  nextAction: T,
  input: Parameters<typeof buildTeamRecommendation>[0]
): T & { teamRecommendation?: TeamRecommendation | null } {
  const teamRecommendation = buildTeamRecommendation(input);
  if (!teamRecommendation) {
    return nextAction;
  }
  const playbook = nextAction.playbook && typeof nextAction.playbook === 'object' && !Array.isArray(nextAction.playbook)
    ? { ...(nextAction.playbook as Record<string, unknown>), teamRecommendation }
    : nextAction.playbook;
  return {
    ...nextAction,
    teamRecommendation,
    playbook
  };
}

export function buildNextMessages(
  nextAction: NextActionLike,
  userNotice: AtmUserNotice | null,
  integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>,
  runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>,
  routeMessage: ReturnType<typeof message>
) {
  ensureDecisionTrail(nextAction);
  const messages = [];
  if (userNotice) {
    messages.push(message('info', 'ATM_USER_NOTICE', userNotice.spokenLine, {
      displayPolicy: userNotice.displayPolicy,
      mustShowBeforeAction: userNotice.mustShowBeforeAction,
      agentInstruction: userNotice.agentInstruction,
      afterNextActionInstruction: userNotice.afterNextActionInstruction,
      route: nextAction.status
    }));
  }
  const integrationInstallHint = describeIntegrationInstallHint(integrationBootstrap);
  if (integrationInstallHint) {
    messages.push(message(
      'warning',
      'ATM_NEXT_INTEGRATION_INSTALL_RECOMMENDED',
      integrationInstallHint.text,
      integrationInstallHint.data
    ));
  }
  if (runtimeAdapterReadiness.needsRuntimeAdapterHint) {
    messages.push(message(
      'warning',
      'ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED',
      runtimeAdapterReadiness.suggestedAction ?? 'Python entrypoints were detected. Select a Python runtime adapter/plugin before expecting ATM atom birth or apply routes to mutate Python surfaces.',
      {
        detectedLanguages: runtimeAdapterReadiness.detectedLanguages,
        bundledLanguageAdapters: runtimeAdapterReadiness.bundledLanguageAdapters,
        bundledProjectAdapters: runtimeAdapterReadiness.bundledProjectAdapters,
        pythonLanguageAdapterAvailable: runtimeAdapterReadiness.pythonLanguageAdapterAvailable,
        candidateRankingAllowed: runtimeAdapterReadiness.candidateRankingAllowed,
        atomBirthApplyDeferred: runtimeAdapterReadiness.atomBirthApplyDeferred,
        missingCapability: runtimeAdapterReadiness.missingCapability
      }
    ));
  }
  if (nextAction.playbook) {
    messages.push(message(
      'warning',
      'ATM_CHANNEL_PLAYBOOK_REQUIRED',
      `Follow the ${nextAction.playbook.channel} playbook exactly before editing, closing, or committing.`,
      nextAction.playbook
    ));
    if (nextAction.playbook.channel === 'normal') {
      messages.push(message(
        'info',
        'ATM_TASK_CLOSE_REMINDER',
        'Normal task cards are not finished at validators or evidence: after deliverables exist, always run tasks close before committing.',
        {
          schemaId: 'atm.taskCloseReminder.v1',
          taskId: readTaskId(nextAction.selectedTask) ?? nextAction.queueHeadTaskId ?? null,
          playbookChannel: 'normal'
        }
      ));
    }
  } else if (nextAction.playbookState === 'absent') {
    messages.push(message(
      'info',
      'ATM_NEXT_PLAYBOOK_ABSENT',
      'This route has no channel playbook. Treat the CLI JSON as structured ATM guidance and follow evidence.nextAction.command as the single next action before mutating files.',
      nextAction.structuredOutputHint ?? {
        schemaId: 'atm.nextStructuredOutputHint.v1',
        hasPlaybook: false,
        treatCliJsonAs: 'structured-tool-guidance',
        followNextActionField: 'evidence.nextAction.command'
      }
    ));
  }
  if ((nextAction.ignoredArtifactForceAddHints?.length ?? 0) > 0) {
    messages.push(message(
      'warning',
      'ATM_NEXT_IGNORED_ARTIFACT_FORCE_ADD_HINT',
      'ATM found ignored artifact paths in the current worktree. If one of them is the intended deliverable for the selected route, force-add it explicitly instead of assuming normal git add will see it.',
      {
        schemaId: 'atm.ignoredArtifactForceAddHints.v1',
        hints: nextAction.ignoredArtifactForceAddHints
      }
    ));
  }
  const promptWorktreeHint = nextAction.promptWorktreeHint;
  if (shouldEmitPromptWorktreeHint(promptWorktreeHint)) {
    messages.push(message(
      'info',
      'ATM_NEXT_WORKTREE_SCOPE_HINT',
      'ATM classified current dirty files before task selection so you can distinguish prompt-matched hints from unrelated or generated residue.',
      promptWorktreeHint
    ));
  }
  const deliveryPrinciple = nextAction.deliveryPrinciple
    ?? (nextAction.selectedTask || nextAction.selectedTasks ? buildTaskDeliveryPrinciple({ channel: nextAction.selectedTasks ? 'batch' : 'normal' }) : null);
  if (deliveryPrinciple) {
    messages.push(message(
      'warning',
      'ATM_TASK_DELIVERY_PRINCIPLE',
      'Task cards are not targets to close; they are delivery contracts. Implement the requested non-.atm deliverables before closing.',
      deliveryPrinciple
    ));
  }
  if (nextAction.teamRecommendation?.enabled) {
    messages.push(message(
      'info',
      'ATM_TEAM_RECOMMENDATION',
      nextAction.teamRecommendation.reason,
      {
        schemaId: nextAction.teamRecommendation.schemaId,
        plan: nextAction.teamRecommendation.plan,
        start: nextAction.teamRecommendation.start,
        status: nextAction.teamRecommendation.status,
        recipeId: nextAction.teamRecommendation.recipeId,
        taskId: nextAction.teamRecommendation.taskId,
        ...(nextAction.teamRecommendation.knowledgeSummary ? {
          knowledgeSummary: nextAction.teamRecommendation.knowledgeSummary
        } : {})
      }
    ));
  }
  if (nextAction.governanceReadiness) {
    const readinessRecord = nextAction.governanceReadiness as Record<string, unknown>;
    const activeWorkSummary = readinessRecord.activeWorkSummary && typeof readinessRecord.activeWorkSummary === 'object' && !Array.isArray(readinessRecord.activeWorkSummary)
      ? readinessRecord.activeWorkSummary as Record<string, unknown>
      : null;
    const brokerRecommendation = activeWorkSummary?.brokerRecommendation && typeof activeWorkSummary.brokerRecommendation === 'object' && !Array.isArray(activeWorkSummary.brokerRecommendation)
      ? activeWorkSummary.brokerRecommendation as Record<string, unknown>
      : null;
    const teamLevelRecommendation = activeWorkSummary?.teamLevelRecommendation && typeof activeWorkSummary.teamLevelRecommendation === 'object' && !Array.isArray(activeWorkSummary.teamLevelRecommendation)
      ? activeWorkSummary.teamLevelRecommendation as Record<string, unknown>
      : null;
    if (brokerRecommendation?.enabled === true) {
      messages.push(message(
        'warning',
        'ATM_ACTIVE_WORK_BROKER_RECOMMENDED',
        `ATM detected active concurrent work; consider Team Agent Broker ${teamLevelRecommendation?.level ?? 'L3'} before editing.`,
        {
          schemaId: activeWorkSummary?.schemaId ?? 'atm.activeWorkSummary.v1',
          brokerRecommendation,
          teamLevelRecommendation,
          activeActors: activeWorkSummary?.activeActors ?? [],
          activeClaims: activeWorkSummary?.activeClaims ?? [],
          stagedFiles: activeWorkSummary?.stagedFiles ?? []
        }
      ));
    }
    messages.push(message(
      'info',
      'ATM_NEXT_GOVERNANCE_READINESS_HINT',
      'ATM surfaced the governance prerequisites early so the agent can prepare claim, evidence, and protected-push checks before reaching commit or push.',
      nextAction.governanceReadiness
    ));
  }
  messages.push(routeMessage);
  return messages;
}

export function buildGovernanceReadinessHint(cwd: string, input: {
  readonly channel: GovernanceChannel | null;
  readonly prompt: string;
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly ownFiles?: readonly string[];
  readonly frameworkClaimRequired?: boolean;
}) {
  return buildGovernanceReadinessHintContract({
    cwd,
    ...input,
    uniqueSorted,
    readTaskWorkFiles,
    buildActiveWorkSummary,
    createFrameworkModeStatus,
    isFrameworkMaintenancePrompt,
    isProtectedFrameworkBranchTarget
  });
}

function readTaskWorkFiles(cwd: string, taskId: string): string[] {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return [];
  try {
    const parsed = parseJsonText(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
    const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
      ? parsed.claim as Record<string, unknown>
      : {};
    const directionLock = parsed.taskDirectionLock && typeof parsed.taskDirectionLock === 'object' && !Array.isArray(parsed.taskDirectionLock)
      ? parsed.taskDirectionLock as Record<string, unknown>
      : {};
    return uniqueSorted([
      ...readStringArray(parsed.scope),
      ...readStringArray(parsed.scopePaths),
      ...readStringArray(parsed.files),
      ...readStringArray(parsed.deliverables),
      ...readStringArray(claimRecord.files),
      ...readStringArray(directionLock.allowedFiles)
    ].map(normalizeWorkPath).filter(Boolean));
  } catch {
    return [];
  }
}

export function shouldInspectCrossRepoFrameworkStatus(cwd: string, targetRepo: string | null) {
  if (!targetRepo) return false;
  const normalizedTarget = targetRepo.replace(/\\/g, '/').trim();
  if (!normalizedTarget) return false;
  const currentRoot = path.resolve(cwd);
  const currentName = path.basename(currentRoot).toLowerCase();
  if (normalizedTarget.toLowerCase() === currentName) return false;
  if (path.isAbsolute(normalizedTarget) && path.resolve(normalizedTarget) === currentRoot) return false;
  return true;
}

function isProtectedFrameworkBranchTarget(branch: string) {
  return branch === 'main'
    || branch === 'master'
    || branch === 'trunk'
    || /^release\/.+/.test(branch);
}
