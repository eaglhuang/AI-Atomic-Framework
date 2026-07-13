import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readActiveGuidanceSession, toGuidanceNextAction } from '../../../core/dist/guidance/index.js';
import { loadHumanReviewQueueDocument } from '../../../plugin-human-review/dist/index.js';
import { buildFirstUseUserNotice } from './first-use-notice.js';
import { compareScoredTasks, compareGuidedLegacyQueuePriority, compareIsoDesc, looksLikeTaskArtifact, isLikelyPromptPathHint, pathFieldMatches, looksLikeNamedPlanPrompt, allowsPlanningMirror, statusQueueWeight, countTokenOverlap } from './next/match-and-sort.js';
import { runDoctor } from './doctor.js';
import { deriveBrokerVerdict, deriveCidVerdict, evaluateClaimAdmission } from './next/claim-admission.js';
import { evaluateBrokerQueueAdmission } from './next/broker-queue-admission.js';
import { buildClaimAdmissionDecisionLog } from './next/claim-conflict-log.js';
import { runBroker } from './broker.js';
import { allowedGuidanceBootstrapCommands, blockedMutationCommands, decideRuntimeNextAction, selectPostClaimChannel, selectQuickfixChannel } from './next/channel-strategy.js';
import { buildTaskScopedClaimCommand } from './next/task-scoped-claim-command.js';
import { withRunnerMode } from './next/runner-mode.js';
import { ensureDecisionTrail, readTaskId } from './next/next-action-assembly.js';
import { buildPromptScopedQueueClaimCommand } from './next/prompt-scope-resolution.js';
import { shouldEmitPromptWorktreeHint } from './next/worktree-hints.js';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.js';
import { describeIntegrationInstallHint, inspectIntegrationBootstrap } from './integration.js';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.js';
import { describeActorResolution, resolveActorId } from './actor-registry.js';
import { resolveActorWorkSession, upsertActorWorkSession } from './actor-session.js';
import { assertSourceFirstRunnerReadOnlyAction, buildFrameworkTempClaimCommand, createFrameworkModeStatus } from './framework-development.js';
import { classifyTaskDelivery } from './task-intent.js';
import { inspectBrokerClaimLifecycle, recordBrokerClaimIntent } from '../../../core/dist/broker/lifecycle.js';
import { abandonTaskQueue, buildAllowedFilesForTask, createOrRefreshTaskQueue, findActiveTaskQueue, isTaskDirectionPathCandidate, partitionTaskScope, readActiveTaskDirectionLocks, writeTaskDirectionLock } from './task-direction.js';
import { extractPathLikeStringsFromPrompt, inspectBatchRunConsistency, isQuickfixPrompt, isPathAllowedByScope, listActiveBatchRuns, readActiveBatchRun, repairBatchRunFromQueue, writeBatchRun, writeQuickfixLock } from './work-channels.js';
import { buildBrokerConflictUxProjection, buildTeamRecommendation } from './team.js';
import { buildTeamKnowledgeSummary } from './team-knowledge.js';
import { decideActiveBatchClaimTask } from './next-active-batch.js';
import { CliError, makeResult, message, parseJsonText, parseOptions, resolveNextDefaultOutputPath, setOutputJsonPath } from './shared.js';
import { runTasks, findTaskClaimDependencyBlockers, prepareTaskForClaim } from './tasks/public-surface.js';
import { taskPathFor } from './tasks/task-file-io-helpers.js';
import { parseMarkdownFrontmatter, normalizeTaskRouteStatus, normalizeSearchText, normalizeTaskIntent, normalizeOptionalTaskPath, readStringArray, splitListValue } from './next/intent-normalizers.js';
import { areTaskDependenciesSatisfied, canTaskBePreparedForClaim, hasRequiredPromptScopeMatch, isClosedTaskStatus, isExplicitSingleTaskRoute, isFrameworkMaintenancePrompt, isQueueRequestedPrompt, isTaskAlreadyActivelyClaimed, isTaskCardSurfaceOnlyMatch, isTaskExplicitlyMentioned, isTaskRoutable, shouldDiscoverMarkdownTaskCards } from './next/route-predicates.js';
import { dedupeStrings, quoteCliValue, sha256, toTaskCandidateView, uniqueInOrder, uniqueSorted } from './next/view-projections.js';
import { readConfiguredPlanningRoots, shouldReportPlanningRootMissing } from './planning-repo-root.js';
import { resolveCandidatePlanningRoots } from './next/planning-root-preference.js';
const NEXT_LARGE_ARRAY_TRUNCATION_LIMIT = 20;
const NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS = 30 * 60;
const NEXT_TRUNCATABLE_FRAMEWORK_STATUS_FIELDS = ['changedFiles', 'criticalChangedFiles', 'docsOnlyChangedFiles'];
const NEXT_DUPLICATED_TOP_LEVEL_KEYS = [
    'nextAction',
    'taskIntent',
    'userNotice',
    'runnerMode',
    'frameworkReport',
    'frameworkClaim',
    'evidenceSummary',
    'guardReport',
    'taskflowReadiness',
    'commitBundle',
    'allowedCommands',
    'blockedCommands',
    'skillGrowth'
];
function isPlainRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function compactFrameworkStatusFileLists(frameworkStatus) {
    const compacted = { ...frameworkStatus };
    for (const field of NEXT_TRUNCATABLE_FRAMEWORK_STATUS_FIELDS) {
        const value = frameworkStatus[field];
        if (Array.isArray(value) && value.length > NEXT_LARGE_ARRAY_TRUNCATION_LIMIT) {
            compacted[field] = value.slice(0, NEXT_LARGE_ARRAY_TRUNCATION_LIMIT);
            compacted[`${field}Truncated`] = true;
            compacted[`${field}TotalCount`] = value.length;
        }
    }
    return compacted;
}
function compactPlaybookMessageData(data) {
    // steps/doNot/commandSequence/governedGitEntrypoint are already the
    // authoritative content at evidence.nextAction.playbook; echoing them again
    // inside this message is what made ordinary routes balloon in size.
    const { steps: _steps, doNot: _doNot, commandSequence: _commandSequence, governedGitEntrypoint: _governedGitEntrypoint, ...rest } = data;
    return {
        ...rest,
        fullPlaybookPath: 'evidence.nextAction.playbook'
    };
}
/**
 * Trims the default `next` CLI envelope so ordinary prompt-scoped routes stay
 * readable in agent/tool transcripts. This only removes duplicated or
 * oversized diagnostic content that remains fully reachable elsewhere
 * (evidence.nextAction.playbook stays untouched; framework-mode status --json
 * keeps the full file lists). Pass --verbose to bypass this and get the
 * original untrimmed envelope. See ATM-BUG-2026-07-07-041.
 */
function compactNextRouteResult(result) {
    const evidence = result.evidence;
    const compactedEvidence = evidence && isPlainRecord(evidence.frameworkStatus)
        ? { ...evidence, frameworkStatus: compactFrameworkStatusFileLists(evidence.frameworkStatus), suppressToolBridgeProjection: true }
        : evidence
            ? { ...evidence, suppressToolBridgeProjection: true }
            : evidence;
    const messages = Array.isArray(result.messages)
        ? result.messages.map((entry) => {
            const record = isPlainRecord(entry) ? entry : null;
            if (record && record.code === 'ATM_CHANNEL_PLAYBOOK_REQUIRED' && isPlainRecord(record.data)) {
                return { ...record, data: compactPlaybookMessageData(record.data) };
            }
            return entry;
        })
        : result.messages;
    const compacted = {
        ...result,
        ...(compactedEvidence ? { evidence: compactedEvidence } : {}),
        ...(messages ? { messages } : {})
    };
    for (const key of NEXT_DUPLICATED_TOP_LEVEL_KEYS) {
        delete compacted[key];
    }
    return compacted;
}
export async function runNext(argv) {
    const verbose = Array.isArray(argv) && argv.includes('--verbose');
    const routeArgv = verbose ? argv.filter((arg) => arg !== '--verbose') : argv;
    const result = await runNextRoute(routeArgv);
    return verbose ? result : compactNextRouteResult(result);
}
async function runNextRoute(argv) {
    const profile = createNextProfiler();
    // TASK-CID-0024: --claim-intent is a next-only claim flag; extract it before
    // the shared option parser so the rest of the surface stays unchanged.
    const claimIntentExtraction = extractClaimIntentFlag(Array.isArray(argv) ? argv : []);
    argv = claimIntentExtraction.argv;
    const claimIntent = claimIntentExtraction.claimIntent;
    const autoIntent = claimIntentExtraction.autoIntent;
    const outputFlagIndex = argv.indexOf('--output');
    if (outputFlagIndex !== -1) {
        const nextArg = argv[outputFlagIndex + 1];
        if (!nextArg || nextArg.startsWith('--')) {
            const cwd = process.cwd();
            setOutputJsonPath(resolveNextDefaultOutputPath(cwd));
        }
        else {
            setOutputJsonPath(path.resolve(nextArg));
        }
    }
    const { options } = parseOptions(argv, 'next');
    profile.mark('parse-options');
    const integrationBootstrap = inspectIntegrationBootstrap(options.cwd);
    profile.mark('inspect-integration-bootstrap');
    const runtimeAdapterReadiness = inspectRuntimeAdapterReadiness(options.cwd);
    profile.mark('inspect-runtime-adapter-readiness');
    const explicitTaskIds = uniqueInOrder([
        ...(typeof options.task === 'string' && options.task.trim().length > 0 ? [options.task] : []),
        ...(Array.isArray(options.tasks) ? options.tasks : [])
    ]);
    const taskIntent = resolveTaskIntent(options.cwd, {
        prompt: options.prompt,
        intentPath: options.intent,
        explicitTaskIds
    });
    profile.mark('resolve-task-intent');
    const importedTaskQueue = inspectImportedTaskQueue(options.cwd, taskIntent, claimIntent ?? 'write');
    profile.mark('inspect-imported-task-queue');
    const scopedTargetRepo = importedTaskQueue.promptScope?.targetRepo ?? null;
    const earlyFrameworkStatus = shouldInspectCrossRepoFrameworkStatus(options.cwd, scopedTargetRepo)
        ? createFrameworkModeStatus({
            cwd: options.cwd,
            targetRepo: scopedTargetRepo
        })
        : null;
    profile.mark(`create-framework-mode-status skipped=${earlyFrameworkStatus === null}`);
    if (earlyFrameworkStatus?.mode === 'cross-repo-target-required') {
        profile.flush('cross-repo-target-required');
        return withRunnerMode(buildCrossRepoFrameworkNextResult({
            cwd: options.cwd,
            frameworkStatus: earlyFrameworkStatus,
            integrationBootstrap,
            runtimeAdapterReadiness,
            importedTaskQueue
        }), options.cwd);
    }
    if (!taskIntent && hasPromptScopedWorkItems(importedTaskQueue)) {
        profile.mark('has-prompt-scoped-work-items');
        profile.flush('prompt-required');
        return withRunnerMode(buildPromptRequiredNextResult({
            cwd: options.cwd,
            claimRequested: Boolean(options.claim),
            importedTaskQueue,
            integrationBootstrap,
            runtimeAdapterReadiness
        }), options.cwd);
    }
    if (options.claim) {
        profile.flush('claim-route');
        return withRunnerMode(await claimNextImportedTask({
            cwd: options.cwd,
            actor: options.agent,
            claimIntent,
            autoIntent,
            forceClaim: Boolean(options.force),
            claimFiles: options.files,
            taskIntent,
            importedTaskQueue,
            integrationBootstrap,
            runtimeAdapterReadiness
        }), options.cwd);
    }
    const activeTaskDivergenceResult = buildActiveTaskDivergenceResult({
        cwd: options.cwd,
        taskIntent,
        importedTaskQueue,
        integrationBootstrap,
        runtimeAdapterReadiness
    });
    profile.mark('build-active-task-divergence-result');
    if (activeTaskDivergenceResult) {
        profile.flush('active-task-divergence-result');
        return withRunnerMode(activeTaskDivergenceResult, options.cwd);
    }
    const promptScopeResult = buildPromptScopedNextResult({
        cwd: options.cwd,
        actor: options.agent,
        taskIntent,
        importedTaskQueue,
        integrationBootstrap,
        runtimeAdapterReadiness
    });
    profile.mark('build-prompt-scoped-next-result');
    if (promptScopeResult) {
        profile.flush('prompt-scope-result');
        return withRunnerMode(promptScopeResult, options.cwd);
    }
    const promptGuidanceResult = buildPromptGuidanceNextResult({
        cwd: options.cwd,
        actor: options.agent,
        taskIntent,
        integrationBootstrap,
        runtimeAdapterReadiness
    });
    profile.mark('build-prompt-guidance-next-result');
    if (promptGuidanceResult) {
        profile.flush('prompt-guidance-result');
        return withRunnerMode(promptGuidanceResult, options.cwd);
    }
    const activeGuidanceSession = readActiveGuidanceSession(options.cwd);
    profile.mark('read-active-guidance-session');
    if (activeGuidanceSession) {
        const baseAction = toGuidanceNextAction(activeGuidanceSession.packet, activeGuidanceSession.routeDecision.blockedBy);
        const legacyPlan = activeGuidanceSession.legacyRoutePlan ?? null;
        const nextAction = legacyPlan ? enrichWithLegacyPlan(options.cwd, baseAction, legacyPlan, activeGuidanceSession.sessionId) : baseAction;
        const userNotice = buildFirstUseUserNotice(nextAction);
        profile.flush('active-guidance-session');
        return withRunnerMode(makeResult({
            ok: nextAction.status !== 'blocked',
            command: 'next',
            cwd: options.cwd,
            messages: buildNextMessages(nextAction, userNotice, integrationBootstrap, runtimeAdapterReadiness, nextAction.status === 'blocked'
                ? message('info', 'ATM_GUIDANCE_NEXT_BLOCKED', 'ATM guidance identified the next single action.', nextAction)
                : message('info', 'ATM_GUIDANCE_NEXT_ACTION', 'ATM guidance identified the next single action.', nextAction)),
            evidence: {
                nextAction,
                agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
                ...(userNotice ? { userNotice } : {}),
                integrationBootstrap,
                runtimeAdapterReadiness,
                taskIntent,
                importedTaskQueue,
                guidanceSession: {
                    sessionId: activeGuidanceSession.sessionId,
                    goal: activeGuidanceSession.goal,
                    recommendedRoute: activeGuidanceSession.routeDecision.recommendedRoute,
                    confidence: activeGuidanceSession.routeDecision.confidence
                }
            }
        }), options.cwd);
    }
    const doctor = await runDoctor(['--cwd', options.cwd]);
    profile.mark('run-doctor');
    const runtime = detectGovernanceRuntime(options.cwd, bootstrapTaskId);
    profile.mark('detect-governance-runtime');
    const doctorChecks = doctor.evidence.checks;
    const failed = doctorChecks.find((check) => check.ok !== true);
    const nextAction = decideRuntimeNextAction(runtime, failed?.name ?? null, importedTaskQueue);
    const userNotice = buildFirstUseUserNotice(nextAction);
    profile.flush('default-next');
    return withRunnerMode(makeResult({
        ok: nextAction.status === 'ready',
        command: 'next',
        cwd: options.cwd,
        messages: buildNextMessages(nextAction, userNotice, integrationBootstrap, runtimeAdapterReadiness, nextAction.status === 'ready'
            ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction)
            : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction)),
        evidence: {
            nextAction,
            agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
            ...(userNotice ? { userNotice } : {}),
            integrationBootstrap,
            runtimeAdapterReadiness,
            taskIntent,
            importedTaskQueue,
            doctorSummary: doctorChecks.map((check) => ({ name: check.name, ok: check.ok })),
            layoutVersion: runtime.layoutVersion,
            currentTaskId: runtime.currentTaskId,
            lockOwner: runtime.activeLock?.owner ?? null,
            lastEvidenceAt: runtime.lastEvidenceAt,
            lastHandoffAt: runtime.lastHandoffAt
        }
    }), options.cwd);
}
function createNextProfiler(header = 'ATM_NEXT_PROFILE') {
    const enabled = process.env.ATM_NEXT_PROFILE === '1';
    const startedAt = Date.now();
    let previousAt = startedAt;
    const marks = [];
    return {
        mark(label) {
            if (!enabled)
                return;
            const now = Date.now();
            marks.push(`${label}: +${now - previousAt}ms (${now - startedAt}ms)`);
            previousAt = now;
        },
        flush(label) {
            if (!enabled)
                return;
            const now = Date.now();
            marks.push(`${label}: +${now - previousAt}ms (${now - startedAt}ms)`);
            process.stderr.write(`[${header}]\n${marks.join('\n')}\n`);
        }
    };
}
function extractClaimIntentFlag(argv) {
    const remaining = [];
    let claimIntent = null;
    let autoIntent = true;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--auto-intent') {
            autoIntent = true;
            continue;
        }
        if (arg === '--claim-intent') {
            const raw = String(argv[index + 1] ?? '').trim().toLowerCase();
            const normalized = raw === 'no-more-mutation' ? 'closeout-only' : raw;
            if (normalized !== 'write' && normalized !== 'closeout-only') {
                throw new CliError('ATM_CLI_USAGE', 'next --claim requires --claim-intent to be one of: write, closeout-only, no-more-mutation.', {
                    exitCode: 2,
                    details: { claimIntent: raw, allowedValues: ['write', 'closeout-only', 'no-more-mutation'] }
                });
            }
            claimIntent = normalized;
            autoIntent = false;
            index += 1;
            continue;
        }
        if (arg === '--closeout-only' || arg === '--no-more-mutation') {
            claimIntent = 'closeout-only';
            autoIntent = false;
            continue;
        }
        remaining.push(arg);
    }
    return { argv: remaining, claimIntent, autoIntent };
}
export function diagnoseClaimReadinessForTasks(cwd, tasks, claimIntent) {
    const diagnostics = [];
    for (const task of tasks) {
        const status = normalizeTaskRouteStatus(task.status);
        const claimable = canTaskBePreparedForClaim(status) || (status === 'review' && claimIntent === 'closeout-only');
        if (task.format === 'markdown') {
            diagnostics.push({
                taskId: task.workItemId,
                status,
                format: task.format,
                claimable: false,
                blockerCode: 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED',
                blockerSummary: `Task ${task.workItemId} is still a Markdown task card and must be imported before claim.`,
                requiredCommand: task.sourcePlanPath
                    ? `node atm.mjs tasks import --from ${quoteCliValue(task.sourcePlanPath)} --dry-run --cwd . --json`
                    : 'node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json',
                dependencyBlockers: []
            });
            continue;
        }
        if (status === 'review' && claimIntent !== 'closeout-only') {
            diagnostics.push({
                taskId: task.workItemId,
                status,
                format: task.format,
                claimable: false,
                blockerCode: 'ATM_NEXT_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED',
                blockerSummary: `Task ${task.workItemId} is in review; reclaim it only through closeout-only when no more source mutation is needed.`,
                requiredCommand: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(task.workItemId)} --claim-intent closeout-only --json`,
                dependencyBlockers: []
            });
            continue;
        }
        const taskPath = taskPathFor(cwd, task.workItemId);
        const dependencyBlockers = existsSync(taskPath)
            ? (() => {
                try {
                    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
                    return findTaskClaimDependencyBlockers(cwd, task.workItemId, taskDocument);
                }
                catch {
                    return [];
                }
            })()
            : [];
        if (dependencyBlockers.length > 0) {
            const firstBlocker = dependencyBlockers[0];
            diagnostics.push({
                taskId: task.workItemId,
                status,
                format: task.format,
                claimable: false,
                blockerCode: 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED',
                blockerSummary: firstBlocker.status === 'source-done-governance-incomplete'
                    ? `Task ${task.workItemId} is blocked because prerequisite ${firstBlocker.taskId} is source-done but not governably closed.`
                    : `Task ${task.workItemId} is blocked until prerequisite task(s) close.`,
                requiredCommand: firstBlocker.requiredCommand
                    ?? (firstBlocker.status === 'incomplete-closeout' || firstBlocker.status === 'source-done-governance-incomplete'
                        ? `node atm.mjs tasks status --task ${firstBlocker.taskId} --residue --json`
                        : `node atm.mjs tasks status --task ${firstBlocker.taskId} --json`),
                dependencyBlockers
            });
            continue;
        }
        if (!claimable) {
            diagnostics.push({
                taskId: task.workItemId,
                status,
                format: task.format,
                claimable: false,
                blockerCode: 'ATM_NEXT_CLAIM_NOT_READY',
                blockerSummary: `Task ${task.workItemId} is currently ${status} and cannot be claimed yet.`,
                requiredCommand: `node atm.mjs tasks status --task ${task.workItemId} --json`,
                dependencyBlockers: []
            });
            continue;
        }
        diagnostics.push({
            taskId: task.workItemId,
            status,
            format: task.format,
            claimable: true,
            blockerCode: 'ATM_NEXT_CLAIM_READY',
            blockerSummary: `Task ${task.workItemId} can be prepared for claim.`,
            requiredCommand: `node atm.mjs next --claim --actor <id> --task ${task.workItemId} --auto-intent --json`,
            dependencyBlockers: []
        });
    }
    const primaryBlocker = diagnostics.find((entry) => !entry.claimable) ?? null;
    return {
        schemaId: 'atm.claimReadinessReport.v1',
        diagnostics,
        primaryBlocker
    };
}
function buildCrossRepoFrameworkNextResult(input) {
    const targetRepo = input.frameworkStatus.targetRepo ?? '<target-repo>';
    const nextAction = {
        status: 'blocked',
        command: `cd ${quoteCliValue(targetRepo)} ; node atm.mjs framework-mode status --json`,
        reason: 'the current task metadata points to ATM framework work; closure authority and hard gates must run in the target framework repository',
        frameworkMode: input.frameworkStatus.mode,
        targetRepo,
        closureAuthority: input.frameworkStatus.closureAuthority,
        allowedCommands: [
            `cd ${quoteCliValue(targetRepo)} ; node atm.mjs framework-mode status --json`,
            `cd ${quoteCliValue(targetRepo)} ; node atm.mjs next --claim --actor <id> --json`
        ],
        blockedCommands: [
            'editing framework critical files while cwd is the planning repository',
            'closing framework target tasks from the planning repository'
        ]
    };
    const userNotice = buildFirstUseUserNotice(nextAction);
    return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, userNotice, input.integrationBootstrap, input.runtimeAdapterReadiness, message('error', 'ATM_NEXT_FRAMEWORK_TARGET_REPO_REQUIRED', 'ATM framework work was detected from task metadata; switch to the target framework repo before mutating or closing work.', {
            targetRepo,
            closureAuthority: input.frameworkStatus.closureAuthority
        })),
        evidence: {
            nextAction,
            frameworkStatus: input.frameworkStatus,
            importedTaskQueue: input.importedTaskQueue,
            integrationBootstrap: input.integrationBootstrap,
            runtimeAdapterReadiness: input.runtimeAdapterReadiness
        }
    });
}
async function claimNextImportedTask(input) {
    assertSourceFirstRunnerReadOnlyAction({ cwd: input.cwd, action: 'next --claim' });
    const claimStartedAt = Date.now();
    const claimLatencyPhases = [];
    const claimIntent = input.claimIntent ?? 'write';
    const autoIntent = input.autoIntent !== false && input.claimIntent == null;
    const promptScopeRuntime = input.importedTaskQueue.promptScope?.status === 'queue'
        ? reconcilePromptScopeRuntimeForClaim(input.cwd, input.taskIntent, input.importedTaskQueue.promptScope.selectedTasks)
        : null;
    const importedTaskQueue = promptScopeRuntime
        ? {
            ...input.importedTaskQueue,
            claimableTask: promptScopeRuntime.queueHeadTask ?? input.importedTaskQueue.claimableTask,
            selectedTask: promptScopeRuntime.queueHeadTask ?? input.importedTaskQueue.selectedTask
        }
        : input.importedTaskQueue;
    const promptText = input.taskIntent?.userPrompt?.trim() ?? '';
    const quickfixScope = promptText ? resolveQuickfixScope(promptText) : [];
    if (!importedTaskQueue.claimableTask
        && !importedTaskQueue.promptScope
        && isQuickfixPrompt(promptText)
        && quickfixScope.length > 0) {
        const resolvedActor = resolveActorId(input.actor ?? undefined, input.cwd);
        if (!resolvedActor) {
            throw new CliError('ATM_ACTOR_ID_MISSING', 'next --claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
        }
        const quickfixLock = writeQuickfixLock({
            cwd: input.cwd,
            actorId: resolvedActor.actorId,
            prompt: promptText,
            reason: promptText,
            allowedFiles: quickfixScope
        });
        const quickfixChannel = selectQuickfixChannel();
        const nextAction = {
            status: 'ready',
            command: 'Apply the quickfix within the allowed files and commit normally.',
            reason: `claimed ATM quickfix lock for ${resolvedActor.actorId}`,
            recommendedChannel: quickfixChannel.recommendedChannel,
            riskLevel: quickfixChannel.riskLevel,
            playbook: buildChannelPlaybook({
                channel: 'fast',
                originalPrompt: promptText,
                actorPlaceholder: resolvedActor.actorId
            }),
            quickfixLock
        };
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_QUICKFIX_CLAIMED', 'Acquired a quickfix lock from next --claim.', {
                actorId: resolvedActor.actorId,
                allowedFiles: quickfixLock.allowedFiles
            })),
            evidence: {
                nextAction,
                recommendedChannel: 'fast',
                quickfixLock,
                taskIntent: input.taskIntent,
                importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    const claimDependencyStatusById = new Map(importedTaskQueue.tasks.map((task) => [task.workItemId, task.status]));
    const selectedTask = importedTaskQueue.claimableTask || importedTaskQueue.selectedTask;
    let selectedTaskDependencyBlockers = [];
    if (selectedTask) {
        const taskPath = taskPathFor(input.cwd, selectedTask.workItemId);
        if (existsSync(taskPath)) {
            try {
                const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
                selectedTaskDependencyBlockers = findTaskClaimDependencyBlockers(input.cwd, selectedTask.workItemId, taskDocument);
            }
            catch { }
        }
    }
    const reusesOwnActiveClaim = Boolean(selectedTask
        && isTaskAlreadyActivelyClaimed(selectedTask)
        && typeof input.actor === 'string'
        && input.actor.trim().length > 0
        && selectedTask.activeClaimActorId === input.actor.trim());
    if (selectedTaskDependencyBlockers.length > 0 && !reusesOwnActiveClaim) {
        const firstBlocker = selectedTaskDependencyBlockers[0];
        const requiredCmd = firstBlocker.requiredCommand
            ?? (firstBlocker.status === 'incomplete-closeout' || firstBlocker.status === 'source-done-governance-incomplete'
                ? `node atm.mjs tasks status --task ${firstBlocker.taskId} --residue --json`
                : `node atm.mjs tasks status --task ${firstBlocker.taskId} --json`);
        const blockerText = firstBlocker.status === 'source-done-governance-incomplete'
            ? `Claim blocked: prerequisite ${firstBlocker.taskId} is source-done but not governably closed.`
            : `Claim blocked until prerequisite task(s) close for ${selectedTask?.workItemId ?? 'the selected task'}.`;
        return makeResult({
            ok: false,
            command: 'next',
            cwd: input.cwd,
            messages: [message('error', 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED', blockerText, {
                    taskId: selectedTask?.workItemId ?? null,
                    blockingTaskIds: selectedTaskDependencyBlockers.map((b) => b.taskId),
                    requiredCommand: requiredCmd,
                    dependencyStatuses: selectedTaskDependencyBlockers
                })],
            evidence: {
                taskIntent: input.taskIntent,
                importedTaskQueue
            }
        });
    }
    if (!importedTaskQueue.claimableTask) {
        const claimReadiness = diagnoseClaimReadinessForTasks(input.cwd, importedTaskQueue.promptScope?.selectedTasks ?? importedTaskQueue.tasks, claimIntent);
        const primaryBlocker = claimReadiness.primaryBlocker;
        const selectedReviewTask = importedTaskQueue.selectedTask
            && normalizeTaskRouteStatus(importedTaskQueue.selectedTask.status) === 'review'
            ? importedTaskQueue.selectedTask
            : null;
        if (selectedReviewTask && claimIntent !== 'closeout-only') {
            const requiredCommand = `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(selectedReviewTask.workItemId)} --claim-intent closeout-only --json`;
            return makeResult({
                ok: false,
                command: 'next',
                cwd: input.cwd,
                messages: [message('error', 'ATM_NEXT_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED', `Task ${selectedReviewTask.workItemId} is in review; reclaim it only through the closeout-only lane when no more source mutation is needed.`, {
                        taskId: selectedReviewTask.workItemId,
                        status: normalizeTaskRouteStatus(selectedReviewTask.status),
                        requiredCommand,
                        remediation: 'Use closeout-only with command-backed historical delivery evidence, or leave the task in review until a real deliverable exists.'
                    })],
                evidence: {
                    taskIntent: input.taskIntent,
                    importedTaskQueue: input.importedTaskQueue
                }
            });
        }
        const claimCode = importedTaskQueue.promptScope?.selectedTasks.some((task) => task.format === 'markdown')
            ? 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'
            : 'ATM_NEXT_CLAIM_NO_TASK';
        const singleVisibleTask = importedTaskQueue.tasks.length === 1 ? importedTaskQueue.tasks[0] : null;
        const promptScopeMiss = !importedTaskQueue.promptScope && !primaryBlocker && singleVisibleTask;
        const claimText = primaryBlocker?.blockerSummary
            ?? (promptScopeMiss
                ? `Prompt did not resolve to a scoped imported task. ATM found ${singleVisibleTask.workItemId}, but it will not auto-claim unrelated open work from an unscoped prompt.`
                : null)
            ?? (claimCode === 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'
                ? 'The prompt-scoped task is a Markdown task card; import or mirror it into the ATM task ledger before claim.'
                : 'No claimable imported task is ready at the moment.');
        return makeResult({
            ok: false,
            command: 'next',
            cwd: input.cwd,
            messages: [message('error', claimCode, claimText, {
                    requiredCommand: primaryBlocker?.requiredCommand
                        ?? (promptScopeMiss
                            ? `node atm.mjs next --claim --actor <id> --task ${singleVisibleTask.workItemId} --auto-intent --json`
                            : null)
                        ?? (importedTaskQueue.promptScope?.selectedTasks[0]?.sourcePlanPath
                            ? `node atm.mjs tasks import --from ${quoteCliValue(importedTaskQueue.promptScope.selectedTasks[0].sourcePlanPath ?? '')} --dry-run --cwd . --json`
                            : 'node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json'),
                    primaryBlocker,
                    claimReadiness
                })],
            evidence: {
                taskIntent: input.taskIntent,
                importedTaskQueue,
                claimReadiness
            }
        });
    }
    const actorResolution = describeActorResolution(input.actor ?? undefined, input.cwd);
    const resolvedActor = actorResolution.resolved;
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'next --claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const activeQueueForIntent = findActiveTaskQueueForIntent(input.cwd, input.taskIntent, {
        taskId: importedTaskQueue.claimableTask?.workItemId ?? null
    });
    const activeBatchForIntent = promptScopeRuntime?.batchRun
        ?? (activeQueueForIntent?.batchId
            ? readActiveBatchRun(input.cwd, { batchId: activeQueueForIntent.batchId })
            : findActiveBatchRunForIntent(input.cwd, input.taskIntent, {
                taskId: importedTaskQueue.claimableTask?.workItemId ?? null
            }));
    assertPromptBatchDoesNotConflict({
        cwd: input.cwd,
        promptScope: importedTaskQueue.promptScope,
        allTasks: importedTaskQueue.tasks,
        sourcePrompt: input.taskIntent?.userPrompt ?? null,
        currentBatchId: activeBatchForIntent?.batchId ?? null
    });
    let claimableTask = importedTaskQueue.claimableTask;
    const activeBatchAtClaimStart = importedTaskQueue.promptScope?.status === 'queue'
        ? activeBatchForIntent
        : readActiveBatchRun(input.cwd, { taskId: claimableTask?.workItemId ?? null });
    if (activeBatchAtClaimStart?.status === 'active') {
        const activeBatchQueue = activeQueueForIntent
            ?? findActiveTaskQueue(input.cwd, activeBatchAtClaimStart.sourcePrompt, { batchId: activeBatchAtClaimStart.batchId });
        const consistency = inspectBatchRunConsistency(activeBatchAtClaimStart, activeBatchQueue);
        if (!consistency.ok) {
            throw new CliError('ATM_BATCH_STATE_REPAIR_REQUIRED', 'next --claim cannot continue because batch-run and task-queue runtime disagree.', {
                exitCode: 1,
                details: {
                    batchId: activeBatchAtClaimStart.batchId,
                    reason: consistency.reason,
                    batchHeadTaskId: consistency.batchHeadTaskId,
                    queueHeadTaskId: consistency.queueHeadTaskId,
                    requiredCommand: `node atm.mjs batch repair --actor ${resolvedActor.actorId} --batch ${activeBatchAtClaimStart.batchId} --json`
                }
            });
        }
    }
    if (activeBatchAtClaimStart?.status === 'active' && claimableTask) {
        const batchPromptQueue = inspectImportedTaskQueue(input.cwd, createDeterministicTaskIntent(activeBatchAtClaimStart.sourcePrompt), claimIntent);
        const activeBatchClaimDecision = decideActiveBatchClaimTask({
            activeBatch: activeBatchAtClaimStart,
            activeQueue: promptScopeRuntime?.queue
                ?? activeQueueForIntent
                ?? findActiveTaskQueue(input.cwd, activeBatchAtClaimStart.sourcePrompt, { batchId: activeBatchAtClaimStart.batchId }),
            claimableTask,
            visibleTasks: importedTaskQueue.tasks,
            fallbackTasks: batchPromptQueue.tasks
        });
        if (activeBatchClaimDecision?.kind === 'queue-head-missing') {
            throw new CliError('ATM_BATCH_QUEUE_HEAD_REQUIRED', `Batch ${activeBatchClaimDecision.batchId} is active, but ATM could not resolve queue head ${activeBatchClaimDecision.currentTaskId}.`, {
                exitCode: 1,
                details: {
                    batchId: activeBatchClaimDecision.batchId,
                    currentTaskId: activeBatchClaimDecision.currentTaskId,
                    attemptedTaskId: activeBatchClaimDecision.attemptedTaskId,
                    requiredCommand: `node atm.mjs next --claim --actor ${resolvedActor.actorId} --prompt ${quoteCliValue(activeBatchClaimDecision.requiredPrompt)} --json`
                }
            });
        }
        if (activeBatchClaimDecision?.kind === 'use-queue-head') {
            claimableTask = activeBatchClaimDecision.task;
        }
    }
    const freshForeignReservation = inspectFreshTaskReservationForTask(input.cwd, claimableTask, resolvedActor.actorId, Date.now());
    if (freshForeignReservation && !input.forceClaim) {
        const activeWorkSummary = buildActiveWorkSummary(input.cwd, resolvedActor.actorId, buildAllowedFilesForTask(claimableTask));
        const overrideCommand = `node atm.mjs next --claim --actor ${resolvedActor.actorId} --task ${claimableTask.workItemId} --auto-intent --force --json`;
        throw new CliError('ATM_NEXT_FRESH_FOREIGN_TASK_RESERVED', `Task ${claimableTask.workItemId} was freshly created or imported by ${freshForeignReservation.actorId}; do not auto-claim it as ${resolvedActor.actorId}.`, {
            exitCode: 1,
            details: {
                taskId: claimableTask.workItemId,
                reservedByActorId: freshForeignReservation.actorId,
                createdAt: freshForeignReservation.createdAt,
                importedAt: freshForeignReservation.importedAt,
                ageSeconds: freshForeignReservation.ageSeconds,
                ttlSeconds: freshForeignReservation.ttlSeconds,
                leaseFresh: freshForeignReservation.leaseFresh,
                files: freshForeignReservation.files,
                teamLevelRecommendation: activeWorkSummary.teamLevelRecommendation,
                brokerRecommendation: activeWorkSummary.brokerRecommendation,
                requiredCommand: `node atm.mjs next --claim --actor ${freshForeignReservation.actorId} --task ${claimableTask.workItemId} --auto-intent --json`,
                overrideCommand,
                recoveryHint: 'Ask the creating captain to hand off, wait for the fresh-task reservation TTL to expire, or use Team Broker override before forcing takeover.'
            }
        });
    }
    if (normalizeTaskRouteStatus(claimableTask.status) === 'reserved' && !claimableTask.activeClaimActorId) {
        await runTasks([
            'release',
            '--cwd',
            input.cwd,
            '--task',
            claimableTask.workItemId,
            '--actor',
            resolvedActor.actorId,
            '--reserved-ok',
            '--reason',
            'next --claim stale reserved cleanup',
            '--json'
        ]);
        claimableTask = {
            ...claimableTask,
            status: 'open'
        };
    }
    const existingClaimActorId = claimableTask.activeClaimActorId;
    if (existingClaimActorId && existingClaimActorId !== resolvedActor.actorId) {
        throw new CliError('ATM_LOCK_CONFLICT', `Task ${claimableTask.workItemId} is already claimed by ${existingClaimActorId}.`, {
            exitCode: 1,
            details: {
                taskId: claimableTask.workItemId,
                actorId: existingClaimActorId,
                requestedActorId: resolvedActor.actorId,
                actorResolution,
                recoveryHint: existingClaimActorId === actorResolution.repoDefaultActorId
                    ? `Continue with the existing claim owner ${existingClaimActorId}, or rerun with --actor ${existingClaimActorId}.`
                    : `Continue with the existing claim owner ${existingClaimActorId}, or release/take over the task before claiming as ${resolvedActor.actorId}.`
            }
        });
    }
    let parallelAdvisory = undefined;
    let brokerQueueAdmission = undefined;
    let claimAllowedFiles = (input.claimFiles && input.claimFiles.length > 0)
        ? uniqueSorted(input.claimFiles.map(normalizeWorkPath).filter(Boolean))
        : buildAllowedFilesForTask(claimableTask);
    // Parallel preflight check
    const parallelStartedAt = Date.now();
    try {
        const parallelResult = await runTasks([
            'parallel',
            '--task',
            claimableTask.workItemId,
            '--queue',
            '--cwd',
            input.cwd,
            '--json'
        ]);
        if (parallelResult && parallelResult.ok && parallelResult.evidence && Array.isArray(parallelResult.evidence.candidates)) {
            for (const candidate of parallelResult.evidence.candidates) {
                const finding = candidate.finding;
                if (finding) {
                    const overlappingAtomIds = Array.isArray(finding.overlappingAtomIds) ? finding.overlappingAtomIds : [];
                    const overlappingFiles = Array.isArray(finding.overlappingFiles)
                        ? finding.overlappingFiles.map((entry) => String(entry).trim()).filter(Boolean)
                        : [];
                    // Queue admission is driven by concrete writable surfaces, not only
                    // CID overlap. A CID-disjoint same-file finding still needs the
                    // shared file removed from the waiter's direction lock.
                    if (finding.verdict === 'blocked-cid-conflict' || overlappingAtomIds.length > 0 || overlappingFiles.length > 0) {
                        // TASK-CID-0024: same-file / same-atom overlap only blocks the
                        // claim when the overlapping task is actively write-claimed by
                        // another actor. Queued-but-idle overlaps and closeout-only
                        // counterparts are admitted with an advisory so same-file
                        // CID-disjoint parallel work stops being serialized by default.
                        //
                        // TASK-RFT-0011: route the final admission decision through the
                        // `next.claim.admission` policy object so the block-vs-admit call
                        // is unified with `broker register`'s conflict-matrix verdict. The
                        // legacy CID diagnostic is preserved as a wrapper — divergence
                        // (which should not happen) is surfaced as
                        // `ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE` for future
                        // regression detection.
                        const conflictActorId = typeof candidate.activeClaimActorId === 'string' && candidate.activeClaimActorId.trim().length > 0
                            ? candidate.activeClaimActorId
                            : null;
                        const conflictIntent = typeof candidate.activeClaimIntent === 'string' ? candidate.activeClaimIntent : null;
                        const activeWriteConflict = Boolean(conflictActorId)
                            && conflictActorId !== resolvedActor.actorId
                            && conflictIntent !== 'closeout-only';
                        const brokerAdmission = finding.brokerAdmission && typeof finding.brokerAdmission === 'object'
                            ? finding.brokerAdmission
                            : null;
                        const confirmedBrokerConflict = brokerAdmission?.confirmedConflict === true;
                        const insufficientMutationIntent = finding.verdict === 'insufficient-mutation-intent'
                            || brokerAdmission?.mutationIntentStatus === 'missing';
                        const { shouldBlockPerCid, cidVerdict } = deriveCidVerdict({
                            claimIntent,
                            activeWriteConflict,
                            confirmedBrokerConflict,
                            insufficientMutationIntent,
                            overlappingAtomIdCount: overlappingAtomIds.length
                        });
                        const queueAdmission = evaluateBrokerQueueAdmission({
                            cwd: input.cwd,
                            taskId: claimableTask.workItemId,
                            allowedFiles: claimAllowedFiles,
                            overlappingFiles
                        });
                        if (queueAdmission.status === 'invalid') {
                            throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
                                exitCode: 1,
                                details: { taskId: claimableTask.workItemId, brokerQueueAdmission: queueAdmission }
                            });
                        }
                        if (queueAdmission.status === 'queued-blocked') {
                            throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
                                exitCode: 1,
                                details: { taskId: claimableTask.workItemId, brokerQueueAdmission: queueAdmission }
                            });
                        }
                        if (queueAdmission.status === 'queued-private-work') {
                            brokerQueueAdmission = queueAdmission;
                            claimAllowedFiles = queueAdmission.allowedFiles;
                        }
                        const sharedConflictSurfaces = overlappingFiles.length > 0
                            ? overlappingFiles
                            : (overlappingAtomIds.length > 0 ? overlappingAtomIds : ['<shared-path>']);
                        const decisionClass = insufficientMutationIntent ? 'blocked' : 'serial-release';
                        const decisionReason = insufficientMutationIntent
                            ? 'broker-conflict-blocked because active task overlap lacks a confirmed Broker mutation intent or resolution artifact.'
                            : 'broker-conflict-blocked because the Broker confirmed an active task ownership conflict.';
                        const requiredCommand = `node atm.mjs team broker resolve --task ${claimableTask.workItemId} --conflict ${candidate.taskId} --path ${sharedConflictSurfaces[0] ?? '<shared-path>'} --decision-reason "broker-conflict-blocked until the release order grants the next task." --json`;
                        const conflictUx = buildBrokerConflictUxProjection({
                            primaryTaskId: claimableTask.workItemId,
                            conflictingTaskIds: [candidate.taskId],
                            sharedPaths: overlappingFiles,
                            overlappingAtomIds,
                            decisionClass,
                            decisionReason,
                            violationStatus: 'broker-conflict-blocked',
                            statusCode: 'broker-conflict-blocked',
                            blockedTaskIds: [candidate.taskId],
                            requiredCommand
                        });
                        // Broker verdict derivation: the parallel-preflight is itself the
                        // broker-authoritative arbitration for this claim path. `blocked`
                        // maps to broker `freeze`; anything else the CID gate would admit
                        // maps to broker `allow`. When broker's separate authoritative
                        // registry adds a distinct verdict feed here in a follow-up, the
                        // divergence detector will start firing.
                        const brokerVerdict = deriveBrokerVerdict({
                            queuedPrivateWork: queueAdmission.status === 'queued-private-work',
                            shouldBlockPerCid
                        });
                        const admission = evaluateClaimAdmission({
                            brokerVerdict,
                            cidVerdict,
                            candidateTaskId: claimableTask.workItemId,
                            conflictingTaskId: candidate.taskId,
                            overlappingAtomIds
                        });
                        const admissionReason = admission.admitted
                            ? (queueAdmission.status === 'queued-private-work'
                                ? 'broker-shared-surface-queue-private-work'
                                : insufficientMutationIntent
                                    ? 'broker-conflict-not-confirmed'
                                    : claimIntent === 'closeout-only'
                                        ? 'closeout-only-claim-intent'
                                        : 'cid-overlap-without-active-write-claim')
                            : null;
                        const claimAdmissionDecisionLog = buildClaimAdmissionDecisionLog({
                            taskId: claimableTask.workItemId,
                            conflictTaskId: candidate.taskId,
                            claimIntent,
                            activeWriteConflict,
                            confirmedBrokerConflict,
                            insufficientMutationIntent,
                            cidVerdict,
                            brokerVerdict,
                            queueAdmission,
                            overlappingFiles,
                            decision: admission,
                            admissionReason
                        });
                        if (!admission.admitted) {
                            throw new CliError(admission.blockCode ?? 'ATM_NEXT_CLAIM_BLOCKED', admission.blockReason
                                ?? `Claim blocked due to parallel CID logic conflict with actively claimed task ${candidate.taskId} on atom(s): ${overlappingAtomIds.join(', ')}.`, {
                                exitCode: 1,
                                details: {
                                    taskId: claimableTask.workItemId,
                                    conflictWithTaskId: candidate.taskId,
                                    conflictClaimActorId: conflictActorId,
                                    blockedTaskIds: conflictUx.blockedTaskIds,
                                    sharedPaths: conflictUx.sharedPaths,
                                    overlappingAtomIds,
                                    verdict: 'blocked-cid-conflict',
                                    brokerVerdict,
                                    cidVerdict,
                                    decisionClass,
                                    decisionReason,
                                    violationStatus: 'broker-conflict-blocked',
                                    statusCode: 'broker-conflict-blocked',
                                    requiredResolutionArtifact: 'atm.brokerConflictResolution.v1',
                                    requiredCommand,
                                    conflictUx,
                                    claimAdmissionDecisionLog,
                                    admissionDivergence: admission.divergence,
                                    closeoutOnlyHint: `If ${claimableTask.workItemId} already delivered its scoped files and only needs governed closeout, rerun next --claim with --claim-intent closeout-only.`
                                }
                            });
                        }
                        if (!parallelAdvisory) {
                            parallelAdvisory = {
                                ...finding,
                                verdict: insufficientMutationIntent
                                    ? 'insufficient-mutation-intent'
                                    : 'parallel-safe-with-cid-overlap-advisory',
                                conflictWithTaskId: candidate.taskId,
                                conflictClaimActorId: conflictActorId,
                                admitted: true,
                                admissionReason,
                                brokerVerdict,
                                cidVerdict,
                                claimAdmissionDecisionLog,
                                ...(admission.divergence ? { admissionDivergence: admission.divergence } : {})
                            };
                        }
                        continue;
                    }
                    if (overlappingAtomIds.length > 0 && !parallelAdvisory) {
                        parallelAdvisory = {
                            ...finding,
                            verdict: finding.verdict ?? 'insufficient-mutation-intent',
                            conflictWithTaskId: candidate.taskId,
                            admitted: true,
                            admissionReason: 'broker-conflict-not-confirmed'
                        };
                        continue;
                    }
                    if (finding.verdict !== 'parallel-safe' && !parallelAdvisory) {
                        parallelAdvisory = finding;
                    }
                }
            }
        }
    }
    catch (err) {
        if (err instanceof CliError && err.code === 'ATM_NEXT_CLAIM_BLOCKED') {
            throw err;
        }
        // Other parallel errors are handled as best-effort
    }
    claimLatencyPhases.push({ phase: 'parallel-preflight', durationMs: Date.now() - parallelStartedAt });
    const claimDeliveryClassification = classifyTaskDelivery({
        cwd: input.cwd,
        task: {
            workItemId: claimableTask.workItemId,
            status: claimableTask.status,
            targetRepo: claimableTask.targetRepo,
            closureAuthority: claimableTask.closureAuthority,
            planningRepo: claimableTask.planningRepo,
            sourcePlanPath: claimableTask.sourcePlanPath,
            taskPath: claimableTask.taskPath
        }
    });
    if (claimDeliveryClassification.intent === 'mirror-sync-only') {
        const sourcePath = claimableTask.sourcePlanPath ?? '<source-task-card-path>';
        const requiredCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --write --force --json`;
        throw new CliError('ATM_NEXT_CLAIM_MIRROR_SYNC_REQUIRED', `Task ${claimableTask.workItemId} is a planning-only mirror in this repo; sync the ledger from the source task card instead of claiming a delivery.`, {
            exitCode: 1,
            details: {
                taskId: claimableTask.workItemId,
                targetRepo: claimDeliveryClassification.targetRepo,
                closureAuthority: claimDeliveryClassification.closureAuthority,
                planningRepo: claimDeliveryClassification.planningRepo,
                sourceStatus: claimDeliveryClassification.sourceStatus,
                ledgerStatus: claimDeliveryClassification.ledgerStatus,
                statusDivergence: claimDeliveryClassification.statusDivergence,
                requiredCommand,
                deliveryClassification: claimDeliveryClassification
            }
        });
    }
    const scopeDiagnostic = checkPendingTaskArtifactScopeExpansion({
        cwd: input.cwd,
        task: claimableTask
    });
    const brokerClaimCheck = inspectBrokerClaimLifecycle({
        cwd: input.cwd,
        taskId: claimableTask.workItemId,
        actorId: resolvedActor.actorId
    });
    if (!brokerClaimCheck.ok) {
        throw new CliError('ATM_BROKER_LIFECYCLE_BLOCKED', brokerClaimCheck.reason ?? `Task ${claimableTask.workItemId} cannot claim because broker runtime state is blocked.`, {
            exitCode: 1,
            details: {
                taskId: claimableTask.workItemId,
                actorId: resolvedActor.actorId,
                registryPath: brokerClaimCheck.registryPath,
                blockingIntent: brokerClaimCheck.blockingIntent
            }
        });
    }
    const alreadyClaimedByActor = existingClaimActorId === resolvedActor.actorId;
    const activeClaimIntent = claimableTask.activeClaimIntent ?? 'write';
    const shouldReuseActiveClaim = alreadyClaimedByActor
        && (autoIntent || activeClaimIntent === claimIntent);
    let preClaimBrokerTransaction = undefined;
    if (!shouldReuseActiveClaim) {
        const transaction = await registerPreClaimBrokerTransaction({
            cwd: input.cwd,
            taskId: claimableTask.workItemId,
            actorId: resolvedActor.actorId,
            targetFiles: claimAllowedFiles
        });
        preClaimBrokerTransaction = transaction;
        const queueAdmission = transaction.queueAdmission;
        if (queueAdmission.status === 'queued-blocked') {
            await runBroker(['release', '--cwd', input.cwd, '--task', claimableTask.workItemId]);
            throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
                exitCode: 1,
                details: { taskId: claimableTask.workItemId, brokerQueueAdmission: queueAdmission }
            });
        }
        if (queueAdmission.status === 'queued-private-work') {
            brokerQueueAdmission = queueAdmission;
            claimAllowedFiles = queueAdmission.allowedFiles;
        }
    }
    const claimPreparationStartedAt = Date.now();
    const claimPreparation = shouldReuseActiveClaim
        ? {
            taskId: claimableTask.workItemId,
            originalStatus: normalizeTaskRouteStatus(claimableTask.status),
            steps: [],
            reusedActiveClaim: true
        }
        : await prepareImportedTaskForClaim({
            cwd: input.cwd,
            task: claimableTask,
            actorId: resolvedActor.actorId
        });
    claimLatencyPhases.push({ phase: 'claim-preparation', durationMs: Date.now() - claimPreparationStartedAt });
    const claimCommandStartedAt = Date.now();
    const claimResult = shouldReuseActiveClaim
        ? await runTasks([
            'renew',
            '--cwd',
            input.cwd,
            '--task',
            claimableTask.workItemId,
            '--actor',
            resolvedActor.actorId,
            '--json'
        ])
        : await runTasks([
            'claim',
            '--cwd',
            input.cwd,
            '--task',
            claimableTask.workItemId,
            '--actor',
            resolvedActor.actorId,
            ...(autoIntent ? ['--auto-intent'] : ['--claim-intent', claimIntent]),
            '--files',
            Array.from(new Set([
                claimableTask.taskPath,
                ...claimAllowedFiles
            ])).join(','),
            '--json'
        ]);
    claimLatencyPhases.push({ phase: shouldReuseActiveClaim ? 'renew-claim' : 'tasks-claim', durationMs: Date.now() - claimCommandStartedAt });
    if (shouldReuseActiveClaim && claimResult.ok && claimResult.evidence) {
        const evidence = claimResult.evidence;
        evidence.reusedActiveClaim = true;
        evidence.claimIntent = activeClaimIntent;
    }
    const activeQueue = importedTaskQueue.promptScope?.status === 'queue'
        ? promptScopeRuntime?.queue ?? findActiveTaskQueueForIntent(input.cwd, input.taskIntent, { taskId: claimableTask.workItemId }) ?? createOrRefreshTaskQueue({
            cwd: input.cwd,
            sourcePrompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId,
            tasks: importedTaskQueue.promptScope.selectedTasks,
            taskIds: importedTaskQueue.promptScope.selectedTasks.map((task) => task.workItemId),
            actorId: resolvedActor.actorId
        })
        : findActiveTaskQueue(input.cwd, input.taskIntent?.userPrompt ?? claimableTask.workItemId);
    const inheritedBatchRun = readActiveBatchRun(input.cwd, { taskId: claimableTask.workItemId });
    const batchRun = importedTaskQueue.promptScope?.status === 'queue'
        ? activeBatchAtClaimStart?.status === 'active' && activeBatchAtClaimStart.taskIds.includes(claimableTask.workItemId)
            ? activeBatchAtClaimStart
            : writeBatchRun({
                cwd: input.cwd,
                sourcePrompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId,
                tasks: importedTaskQueue.promptScope.selectedTasks,
                queue: activeQueue,
                actorId: resolvedActor.actorId
            })
        : inheritedBatchRun?.status === 'active' && inheritedBatchRun.taskIds.includes(claimableTask.workItemId)
            ? inheritedBatchRun
            : null;
    const queueForDirection = batchRun && activeQueue
        ? createOrRefreshTaskQueue({
            cwd: input.cwd,
            sourcePrompt: activeQueue.sourcePrompt,
            tasks: activeQueue.tasks,
            taskIds: activeQueue.taskIds,
            actorId: resolvedActor.actorId,
            batchId: batchRun.batchId,
            scopeKey: batchRun.scopeKey
        })
        : activeQueue;
    if (batchRun && queueForDirection) {
        await cleanupPreviousBatchQueueLocks({
            cwd: input.cwd,
            actorId: resolvedActor.actorId,
            queue: queueForDirection
        });
    }
    const directionLockStartedAt = Date.now();
    const directionLock = writeTaskDirectionLock({
        cwd: input.cwd,
        taskId: claimableTask.workItemId,
        actorId: resolvedActor.actorId,
        queue: queueForDirection,
        batchId: batchRun?.batchId ?? null,
        scopeKey: batchRun?.scopeKey ?? null,
        allowedFiles: claimAllowedFiles,
        planningReadOnlyPaths: claimableTask.planningReadOnlyPaths,
        planningMirrorPaths: claimableTask.planningMirrorPaths,
        allowPlanningMirror: claimableTask.allowPlanningMirror,
        prompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId
    });
    claimLatencyPhases.push({ phase: 'direction-lock-write', durationMs: Date.now() - directionLockStartedAt });
    const claimEvidence = claimResult && typeof claimResult === 'object' && 'evidence' in claimResult && claimResult.evidence && typeof claimResult.evidence === 'object'
        ? claimResult.evidence
        : null;
    const resolvedClaimIntent = typeof claimEvidence?.claimIntent === 'string'
        ? claimEvidence.claimIntent
        : claimIntent;
    const claimRecord = claimEvidence && typeof claimEvidence.claim === 'object' && claimEvidence.claim
        ? claimEvidence.claim
        : null;
    const claimedSessionId = typeof claimEvidence?.sessionId === 'string' ? claimEvidence.sessionId : null;
    const actorSession = upsertActorWorkSession({
        cwd: input.cwd,
        sessionId: claimedSessionId,
        actorId: resolvedActor.actorId,
        taskId: claimableTask.workItemId,
        claimLeaseId: typeof claimRecord?.leaseId === 'string'
            ? claimRecord.leaseId
            : resolveActorWorkSession(input.cwd, {
                actorId: resolvedActor.actorId,
                taskId: claimableTask.workItemId,
                includeNonActive: true
            })?.claimLeaseId ?? null,
        status: 'active',
        taskPath: claimableTask.taskPath,
        sourcePrompt: batchRun?.sourcePrompt ?? input.taskIntent?.userPrompt ?? claimableTask.workItemId,
        batchId: batchRun?.batchId ?? null,
        guidanceSessionId: null
    }).session;
    const recommendedChannel = selectPostClaimChannel(batchRun?.status === 'active').recommendedChannel;
    if (shouldReuseActiveClaim) {
        recordBrokerClaimIntent({
            cwd: input.cwd,
            taskId: claimableTask.workItemId,
            actorId: resolvedActor.actorId,
            lane: recommendedChannel === 'batch' ? 'serial' : 'direct-brokered',
            targetFiles: directionLock.allowedFiles,
            ttlSeconds: 1800
        });
    }
    const nextActionBase = {
        status: 'ready',
        command: `node atm.mjs start --cwd . --goal ${quoteCliValue(claimableTask.title)} --json`,
        reason: `claimed imported work item ${claimableTask.workItemId} for ${resolvedActor.actorId}`,
        recommendedChannel,
        claimIntent: resolvedClaimIntent,
        riskLevel: recommendedChannel === 'batch' ? 'high' : 'medium',
        playbook: buildChannelPlaybook({
            channel: recommendedChannel,
            taskId: claimableTask.workItemId,
            queueHeadTaskId: batchRun?.currentTaskId ?? claimableTask.workItemId,
            originalPrompt: batchRun?.sourcePrompt ?? input.taskIntent?.userPrompt ?? claimableTask.workItemId,
            actorPlaceholder: resolvedActor.actorId
        }),
        deliveryPrinciple: buildTaskDeliveryPrinciple({
            channel: recommendedChannel === 'batch' ? 'batch' : 'normal',
            taskId: claimableTask.workItemId
        }),
        selectedTask: claimableTask,
        batchId: batchRun?.batchId ?? null,
        scopeKey: batchRun?.scopeKey ?? null,
        planningContext: {
            readOnlyPaths: claimableTask.planningReadOnlyPaths,
            sourcePlanPath: claimableTask.sourcePlanPath,
            nearbyPlanPaths: claimableTask.nearbyPlanPaths
        },
        targetWork: {
            allowedFiles: claimableTask.targetAllowedFiles,
            targetRepo: claimableTask.targetRepo,
            allowPlanningMirror: claimableTask.allowPlanningMirror
        },
        taskContext: {
            planningContext: {
                readOnlyPaths: claimableTask.planningReadOnlyPaths,
                sourcePlanPath: claimableTask.sourcePlanPath,
                nearbyPlanPaths: claimableTask.nearbyPlanPaths
            },
            targetWork: {
                allowedFiles: claimableTask.targetAllowedFiles,
                targetRepo: claimableTask.targetRepo,
                allowPlanningMirror: claimableTask.allowPlanningMirror
            },
            scopePaths: claimableTask.scopePaths,
            sourcePlanPath: claimableTask.sourcePlanPath
        },
        taskDirectionLock: directionLock,
        ...(brokerQueueAdmission ? { brokerQueueAdmission } : {}),
        taskQueue: activeQueue,
        batchRun,
        sessionId: actorSession.sessionId,
        actorSession,
        scopeDiagnostic,
        ignoredUntrackedFiles: scopeDiagnostic.ignoredUntrackedFiles,
        allowedCommands: allowedGuidanceBootstrapCommands(),
        blockedCommands: blockedMutationCommands()
    };
    const nextAction = embedTeamRecommendation(nextActionBase, {
        taskId: claimableTask.workItemId,
        actorId: resolvedActor.actorId,
        channel: recommendedChannel,
        reason: recommendedChannel === 'batch'
            ? 'Batch queue-head work can use a current-task team, but ATM still owns checkpoint and advance.'
            : 'This task can use an optional team run for role/permission coordination.',
        knowledgeSummary: buildTeamKnowledgeSummary({
            cwd: input.cwd,
            taskId: claimableTask.workItemId,
            top: 3
        }),
        parallelAdvisory
    });
    const userNotice = buildFirstUseUserNotice(nextAction);
    return makeResult({
        ok: true,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, userNotice, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_CLAIMED', 'Claimed the next imported work item.', {
            taskId: claimableTask.workItemId,
            actorId: resolvedActor.actorId,
            actorSource: resolvedActor.source,
            actorResolution,
            recommendedChannel: nextAction.recommendedChannel,
            claimIntent: resolvedClaimIntent,
            batchCheckpointCommand: nextAction.recommendedChannel === 'batch'
                ? 'node atm.mjs batch checkpoint --actor <id> --json'
                : null,
            blockedPattern: nextAction.recommendedChannel === 'batch'
                ? 'manual tasks claim/close loop'
                : null,
            ignoredUntrackedFiles: scopeDiagnostic.ignoredUntrackedFiles,
            ignoredUntrackedNote: scopeDiagnostic.ignoredUntrackedFiles.length > 0
                ? 'These files are NOT blocking the claim. If any of them is actually a deliverable for this task, run `node atm.mjs tasks scope --add <paths>` to widen the scope and then `git add` them.'
                : null
        })),
        evidence: {
            nextAction,
            actorResolution,
            claimIntent: resolvedClaimIntent,
            claimPreparation,
            claimResult: claimResult.evidence,
            ...(preClaimBrokerTransaction ? { preClaimBrokerTransaction } : {}),
            taskDirectionLock: directionLock,
            taskQueue: activeQueue,
            batchRun,
            teamRecommendation: nextAction.teamRecommendation ?? null,
            sessionId: actorSession.sessionId,
            actorSession,
            recommendedChannel: nextAction.recommendedChannel,
            taskIntent: input.taskIntent,
            importedTaskQueue: input.importedTaskQueue,
            integrationBootstrap: input.integrationBootstrap,
            runtimeAdapterReadiness: input.runtimeAdapterReadiness,
            claimLatency: {
                schemaId: 'atm.claimLatencyTelemetry.v1',
                totalMs: Date.now() - claimStartedAt,
                phases: claimLatencyPhases
            }
        }
    });
}
async function cleanupPreviousBatchQueueLocks(input) {
    const previousTaskIds = input.queue.taskIds.slice(0, Math.max(0, input.queue.currentIndex));
    for (const taskId of previousTaskIds) {
        try {
            await runTasks([
                'lock',
                'cleanup',
                '--cwd',
                input.cwd,
                '--task',
                taskId,
                '--actor',
                input.actorId,
                '--reason',
                'batch queue stale lock auto cleanup',
                '--json'
            ]);
        }
        catch {
            // The cleanup command already refuses active/non-stale locks; this is best-effort only.
        }
    }
}
function buildPromptScopedNextResult(input) {
    const profile = createNextProfiler('ATM_NEXT_PROMPT_SCOPE_PROFILE');
    const promptScope = input.importedTaskQueue.promptScope;
    if (!promptScope)
        return null;
    profile.mark('read-prompt-scope');
    const selectedTasks = promptScope.selectedTasks;
    if (promptScope.status === 'empty') {
        const nextAction = {
            status: 'task-no-work',
            command: 'node atm.mjs next --cwd . --json',
            reason: 'the prompt points at a task scope, but no open imported work remains for that scope',
            taskIntent: input.taskIntent,
            candidates: [],
            allowedCommands: allowedGuidanceBootstrapCommands(),
            blockedCommands: blockedMutationCommands()
        };
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_NO_WORK', 'The prompt points at a known task scope, but no open imported work remains for it.', {
                taskIntent: input.taskIntent,
                diagnostics: promptScope.diagnostics
            })),
            evidence: {
                nextAction,
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    if (promptScope.status === 'not-found') {
        const planningRootMissing = input.importedTaskQueue.planningRootMissing ?? null;
        const nonPlaybookHints = buildNonPlaybookRouteHints(input.cwd, input.taskIntent?.userPrompt ?? '');
        if (!planningRootMissing && isReadOnlyPromptScopeMiss(input.taskIntent)) {
            const nextAction = {
                status: 'task-scope-audit-advisory',
                command: 'node atm.mjs next --json',
                reason: 'the prompt mentions a historical or non-ledger task label for read-only audit; ATM did not find a matching open task and will not block safe inspection',
                taskIntent: input.taskIntent,
                candidates: [],
                diagnostics: promptScope.diagnostics,
                decisionTrail: [
                    {
                        check: 'route-status',
                        result: 'info',
                        reason: 'ATM found a task-like prompt scope miss, but the requested action is read-only audit/analyze.'
                    },
                    {
                        check: 'prompt-scope-resolution',
                        result: 'info',
                        reason: 'read-only audit/analyze prompt may inspect evidence without claiming a missing task scope'
                    }
                ],
                allowedCommands: allowedGuidanceBootstrapCommands(),
                blockedCommands: blockedMutationCommands(),
                ...nonPlaybookHints
            };
            return makeResult({
                ok: true,
                command: 'next',
                cwd: input.cwd,
                messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_SCOPE_AUDIT_ADVISORY', 'The prompt names a task-like scope that ATM could not find, but the requested action is read-only audit/analyze.', {
                    taskIntent: input.taskIntent,
                    diagnostics: promptScope.diagnostics
                })),
                evidence: {
                    nextAction,
                    taskIntent: input.taskIntent,
                    importedTaskQueue: input.importedTaskQueue,
                    integrationBootstrap: input.integrationBootstrap,
                    runtimeAdapterReadiness: input.runtimeAdapterReadiness
                }
            });
        }
        const nextAction = {
            status: planningRootMissing ? 'planning-root-missing' : 'task-scope-not-found',
            command: planningRootMissing?.requiredCommand ?? 'node atm.mjs next --prompt "<current user prompt>" --json',
            reason: planningRootMissing?.detail ?? 'the prompt mentions task scope, but no matching ATM task card or ledger task was found',
            taskIntent: input.taskIntent,
            candidates: [],
            planningRootMissing,
            allowedCommands: allowedGuidanceBootstrapCommands(),
            blockedCommands: blockedMutationCommands(),
            ...nonPlaybookHints
        };
        return makeResult({
            ok: false,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, planningRootMissing
                ? message('error', 'ATM_PLANNING_ROOT_MISSING', planningRootMissing.detail, planningRootMissing)
                : message('error', 'ATM_NEXT_TASK_SCOPE_NOT_FOUND', 'The prompt looks task-scoped, but ATM could not find a matching task.', {
                    taskIntent: input.taskIntent
                })),
            evidence: {
                nextAction,
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    if (promptScope.status === 'ambiguous') {
        const nextAction = {
            status: 'task-selection-required',
            command: 'node atm.mjs next --prompt "<more specific prompt with task id or plan path>" --json',
            reason: 'the prompt matches multiple task scopes; ATM will not choose a global task by accident',
            candidates: selectedTasks,
            allowedCommands: allowedGuidanceBootstrapCommands(),
            blockedCommands: blockedMutationCommands()
        };
        return makeResult({
            ok: false,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('error', 'ATM_NEXT_TASK_SELECTION_REQUIRED', 'The prompt matches multiple task cards; choose a task id or plan scope before continuing.', {
                candidateCount: selectedTasks.length,
                candidates: selectedTasks.slice(0, 12).map(toTaskCandidateView)
            })),
            evidence: {
                nextAction,
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    if (promptScope.status === 'queue') {
        const queueHeadTask = input.importedTaskQueue.selectedTask ?? selectedTasks[0] ?? null;
        const requestedQueuePrompt = input.taskIntent?.userPrompt ?? queueHeadTask?.workItemId ?? 'prompt-scoped task queue';
        const activeQueue = findActiveTaskQueueForIntent(input.cwd, input.taskIntent, {
            sourcePromptFallback: requestedQueuePrompt,
            taskId: queueHeadTask?.workItemId ?? null
        });
        const activeBatch = activeQueue?.batchId
            ? readActiveBatchRun(input.cwd, { batchId: activeQueue.batchId })
            : findActiveBatchRunForIntent(input.cwd, input.taskIntent, {
                sourcePromptFallback: requestedQueuePrompt,
                taskId: queueHeadTask?.workItemId ?? null
            });
        const queuePrompt = activeBatch?.sourcePrompt ?? activeQueue?.sourcePrompt ?? requestedQueuePrompt;
        const activeBatchQueue = activeBatch && !activeQueue
            ? findActiveTaskQueue(input.cwd, activeBatch.sourcePrompt, { batchId: activeBatch.batchId })
            : activeQueue;
        const consistency = inspectBatchRunConsistency(activeBatch, activeBatch ? activeBatchQueue : null);
        if (!consistency.ok) {
            const nextAction = {
                status: 'batch-state-repair-required',
                command: activeBatch ? `node atm.mjs batch repair --actor <id> --batch ${activeBatch.batchId} --json` : 'node atm.mjs batch repair --actor <id> --json',
                reason: 'active batch runtime is inconsistent; repair it before claiming, editing, closing, or committing',
                recommendedChannel: 'batch',
                riskLevel: 'high',
                requiredCommand: activeBatch ? `node atm.mjs batch repair --actor <id> --batch ${activeBatch.batchId} --json` : 'node atm.mjs batch repair --actor <id> --json',
                playbook: buildChannelPlaybook({
                    channel: 'batch',
                    taskId: queueHeadTask?.workItemId ?? null,
                    queueHeadTaskId: queueHeadTask?.workItemId ?? null,
                    originalPrompt: queuePrompt,
                    batchId: activeBatch?.batchId ?? null,
                    batchState: 'repair-required'
                }),
                blockedCommands: blockedMutationCommands()
            };
            return makeResult({
                ok: false,
                command: 'next',
                cwd: input.cwd,
                messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('error', 'ATM_BATCH_STATE_REPAIR_REQUIRED', 'ATM detected an inconsistent active batch. Repair the runtime before continuing.', {
                    batchId: activeBatch?.batchId ?? null,
                    reason: consistency.reason,
                    batchHeadTaskId: consistency.batchHeadTaskId,
                    queueHeadTaskId: consistency.queueHeadTaskId,
                    requiredCommand: nextAction.requiredCommand
                })),
                evidence: {
                    nextAction,
                    recommendedChannel: 'batch',
                    batchRun: activeBatch,
                    taskQueue: activeBatchQueue,
                    consistency,
                    taskIntent: input.taskIntent,
                    importedTaskQueue: input.importedTaskQueue
                }
            });
        }
        const queueHeadTaskId = activeBatchQueue?.taskIds[activeBatchQueue.currentIndex] ?? queueHeadTask?.workItemId ?? null;
        const queuePreview = {
            schemaId: 'atm.taskQueuePreview.v1',
            sourcePrompt: queuePrompt,
            batchId: activeBatch?.batchId ?? null,
            scopeKey: activeBatch?.scopeKey ?? null,
            targetRepo: selectedTasks.find((task) => task.targetRepo)?.targetRepo ?? null,
            taskIds: selectedTasks.map((task) => task.workItemId),
            currentIndex: activeBatchQueue?.currentIndex ?? 0,
            queueHeadTaskId
        };
        const queueHeadImport = queueHeadTask ? buildPlanningCardImportRequirement(queueHeadTask) : null;
        const queueClaimCommand = buildPromptScopedQueueClaimCommand({
            queueHeadTaskPresent: Boolean(queueHeadTask),
            queuePrompt,
            planningCardImportCommand: queueHeadImport?.requiredCommand ?? null
        });
        const nextAction = embedTeamRecommendation({
            status: 'task-queue-ready',
            command: queueClaimCommand,
            reason: 'the prompt resolves to a scoped task queue; claim one task at a time',
            recommendedChannel: 'batch',
            riskLevel: 'high',
            requiredCommand: queueClaimCommand,
            planningCardImport: queueHeadImport,
            batchInstruction: 'This is a batch run. Do not switch to per-task normal flow. After next --claim, deliver only the current queue head and run node atm.mjs batch checkpoint --actor <id> --json. Do not manually loop over tasks claim/close.',
            playbook: buildChannelPlaybook({
                channel: 'batch',
                taskId: queueHeadTaskId ?? undefined,
                queueHeadTaskId,
                originalPrompt: queuePrompt,
                batchId: activeBatch?.batchId ?? null,
                batchState: activeBatch ? 'queue-head-active' : 'queue-preview'
            }),
            deliveryPrinciple: buildTaskDeliveryPrinciple({
                channel: 'batch',
                taskId: queueHeadTaskId ?? undefined
            }),
            selectedTasks,
            taskQueue: activeBatchQueue ?? queuePreview,
            queueId: activeBatchQueue?.queueId ?? null,
            batchId: activeBatch?.batchId ?? null,
            scopeKey: activeBatch?.scopeKey ?? null,
            queueHeadTaskId,
            queueSize: selectedTasks.length,
            governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
                channel: 'batch',
                prompt: queuePrompt,
                actorId: input.actor,
                taskId: queueHeadTaskId
            }),
            allowedCommands: allowedGuidanceBootstrapCommands(),
            blockedCommands: blockedMutationCommands()
        }, {
            taskId: queueHeadTaskId,
            channel: 'batch',
            ...(queueHeadTaskId ? {
                knowledgeSummary: buildTeamKnowledgeSummary({
                    cwd: input.cwd,
                    taskId: queueHeadTaskId,
                    top: 3
                })
            } : {})
        });
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_QUEUE_READY', 'ATM resolved the prompt to a scoped task queue.', {
                queueSize: selectedTasks.length,
                queueId: activeBatchQueue?.queueId ?? null,
                queueHeadTaskId,
                firstTask: queueHeadTask ? toTaskCandidateView(queueHeadTask) : null,
                requiredCommand: nextAction.command,
                batchCheckpointCommand: 'node atm.mjs batch checkpoint --actor <id> --json',
                blockedPattern: 'manual tasks claim/close loop',
                planningCardImport: queueHeadImport
            })),
            evidence: {
                nextAction,
                recommendedChannel: 'batch',
                taskQueue: activeBatchQueue ?? queuePreview,
                agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    const selectedTask = selectedTasks[0] ?? null;
    if (!selectedTask)
        return null;
    profile.mark('select-task');
    const deliveryClassification = classifyTaskDelivery({
        cwd: input.cwd,
        task: {
            workItemId: selectedTask.workItemId,
            status: selectedTask.status,
            targetRepo: selectedTask.targetRepo,
            closureAuthority: selectedTask.closureAuthority,
            planningRepo: selectedTask.planningRepo,
            sourcePlanPath: selectedTask.sourcePlanPath,
            taskPath: selectedTask.taskPath
        }
    });
    profile.mark('classify-task-delivery');
    const sourceStatus = deliveryClassification.sourceStatus;
    const ledgerStatus = deliveryClassification.ledgerStatus;
    if (deliveryClassification.intent === 'mirror-sync-only'
        && input.taskIntent?.requestedAction !== 'redo'
        && input.taskIntent?.requestedAction !== 'reopen') {
        const mirrorSyncTask = withMirrorSyncOnlyTarget(selectedTask);
        const mirrorSyncQueue = withMirrorSyncOnlyTargetQueue(input.importedTaskQueue, selectedTask.workItemId);
        const nextAction = buildMirrorSyncNextAction({
            task: mirrorSyncTask,
            classification: deliveryClassification
        });
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_MIRROR_SYNC_REQUIRED', 'ATM detected a planning-only task; deliverables live in another repo. Sync the ledger mirror instead of running a delivery playbook here.', {
                task: toTaskCandidateView(mirrorSyncTask),
                classification: deliveryClassification,
                requiredCommand: nextAction.requiredCommand
            })),
            evidence: {
                nextAction,
                recommendedChannel: nextAction.recommendedChannel,
                deliveryClassification,
                taskIntent: input.taskIntent,
                importedTaskQueue: mirrorSyncQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    const isHistoricalDoneStale = sourceStatus?.toLowerCase() === 'done'
        && (ledgerStatus?.toLowerCase() !== 'done' || !selectedTask.closedAt || !selectedTask.closurePacket);
    if (isHistoricalDoneStale) {
        const nextAction = {
            status: 'task-reconcile-suggested',
            command: `node atm.mjs tasks reconcile --task ${selectedTask.workItemId} --actor <id> --delivery-commit <historicalCommitSha> --json`,
            reason: `task ${selectedTask.workItemId} is marked as done in the planning card but the target ledger is not closed yet; reconcile it using the historical sync channel`,
            recommendedChannel: 'reconcile',
            riskLevel: 'low',
            selectedTask,
            requiredCommand: `node atm.mjs tasks reconcile --task ${selectedTask.workItemId} --actor <id> --delivery-commit <historicalCommitSha> --json`,
            playbook: {
                schemaId: 'atm.playbook.v1',
                channel: 'reconcile',
                steps: [
                    `Find the historical Git commit SHA that delivered this task's changes (e.g., e26f3a73)`,
                    `Run node atm.mjs tasks reconcile --task ${selectedTask.workItemId} --actor <actorId> --delivery-commit <historicalCommitSha> --json`,
                    `This will automatically generate the closure packet, update the ledger status to done, write task-events, and synchronize the governance record without claiming the task or mutating source files.`
                ]
            },
            allowedCommands: [
                `node atm.mjs tasks reconcile --task ${selectedTask.workItemId} --actor <id> --delivery-commit <historicalCommitSha> --json`,
                ...allowedGuidanceBootstrapCommands()
            ],
            blockedCommands: [
                'mutating source files during historical reconcile',
                'manual ledger JSON edit'
            ]
        };
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_RECONCILE_SUGGESTED', `Task ${selectedTask.workItemId} is done in planning but ledger is open. Reconcile with historical sync.`, {
                task: toTaskCandidateView(selectedTask),
                requiredCommand: nextAction.requiredCommand
            })),
            evidence: {
                nextAction,
                recommendedChannel: 'reconcile',
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    if (isClosedTaskStatus(selectedTask.status) && input.taskIntent?.requestedAction !== 'redo' && input.taskIntent?.requestedAction !== 'reopen') {
        const nextAction = {
            status: 'task-already-closed',
            command: 'node atm.mjs next --prompt "<current user prompt>" --json',
            reason: `task ${selectedTask.workItemId} is already ${normalizeTaskRouteStatus(selectedTask.status)}; do not edit planning task cards to simulate closure`,
            recommendedChannel: 'normal',
            riskLevel: 'low',
            selectedTask,
            closure: {
                taskId: selectedTask.workItemId,
                status: normalizeTaskRouteStatus(selectedTask.status),
                closedAt: selectedTask.closedAt,
                closedByActor: selectedTask.closedByActor,
                closurePacketPath: selectedTask.closurePacket,
                lastTransitionId: selectedTask.lastTransitionId,
                lastTransitionAt: selectedTask.lastTransitionAt
            },
            planningStatusSync: {
                authority: 'atm-ledger',
                instruction: 'Planning task-card status is only a mirror. Official closure must come from the ATM task ledger close transition and closure packet.'
            },
            allowedCommands: allowedGuidanceBootstrapCommands(),
            blockedCommands: [
                ...blockedMutationCommands(),
                'manual planning task-card status: done as completion evidence'
            ]
        };
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_ALREADY_CLOSED', 'ATM found the task, and it is already closed in the task ledger.', {
                task: toTaskCandidateView(selectedTask),
                closure: nextAction.closure,
                planningStatusSync: nextAction.planningStatusSync
            })),
            evidence: {
                nextAction,
                recommendedChannel: 'normal',
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    const activeBatch = readActiveBatchRun(input.cwd, { taskId: selectedTask.workItemId });
    profile.mark('read-active-batch-run');
    if (activeBatch?.status === 'active' && activeBatch.taskIds.includes(selectedTask.workItemId)) {
        const activeQueue = findActiveTaskQueue(input.cwd, activeBatch.sourcePrompt, { batchId: activeBatch.batchId }) ?? findActiveTaskQueue(input.cwd, null, { batchId: activeBatch.batchId });
        const consistency = inspectBatchRunConsistency(activeBatch, activeQueue);
        if (!consistency.ok) {
            const nextAction = {
                status: 'batch-state-repair-required',
                command: `node atm.mjs batch repair --actor <id> --batch ${activeBatch.batchId} --json`,
                reason: 'active batch runtime is inconsistent; repair it before claiming, editing, closing, or committing',
                recommendedChannel: 'batch',
                riskLevel: 'high',
                requiredCommand: `node atm.mjs batch repair --actor <id> --batch ${activeBatch.batchId} --json`,
                blockedCommands: blockedMutationCommands()
            };
            return makeResult({
                ok: false,
                command: 'next',
                cwd: input.cwd,
                messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('error', 'ATM_BATCH_STATE_REPAIR_REQUIRED', 'ATM detected an inconsistent active batch. Repair the runtime before continuing.', {
                    batchId: activeBatch.batchId,
                    reason: consistency.reason,
                    batchHeadTaskId: consistency.batchHeadTaskId,
                    queueHeadTaskId: consistency.queueHeadTaskId,
                    requiredCommand: nextAction.requiredCommand
                })),
                evidence: {
                    nextAction,
                    recommendedChannel: 'batch',
                    batchRun: activeBatch,
                    taskQueue: activeQueue,
                    consistency,
                    taskIntent: input.taskIntent,
                    importedTaskQueue: input.importedTaskQueue
                }
            });
        }
        const queueHeadTaskId = activeBatch.currentTaskId
            ?? activeQueue?.taskIds[activeQueue.currentIndex]
            ?? selectedTask.workItemId;
        const taskQueue = activeQueue ? {
            queueId: activeQueue.queueId,
            sourcePrompt: activeQueue.sourcePrompt,
            taskIds: activeQueue.taskIds,
            currentIndex: activeQueue.currentIndex,
            queueHeadTaskId
        } : {
            schemaId: 'atm.taskQueuePreview.v1',
            sourcePrompt: activeBatch.sourcePrompt,
            targetRepo: selectedTask.targetRepo ?? null,
            taskIds: activeBatch.taskIds,
            currentIndex: activeBatch.currentIndex,
            queueHeadTaskId
        };
        const nextAction = embedTeamRecommendation({
            status: 'task-batch-context-active',
            command: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(activeBatch.sourcePrompt)} --auto-intent --json`,
            reason: `task ${selectedTask.workItemId} belongs to active batch ${activeBatch.batchId}; continue through the current batch queue head`,
            recommendedChannel: 'batch',
            riskLevel: 'high',
            batchInstruction: `This is a batch run. Do not switch to per-task normal flow. Deliver only queue head ${queueHeadTaskId}, then run node atm.mjs batch checkpoint --actor <id> --json to close, advance, and claim the next task.`,
            playbook: buildChannelPlaybook({
                channel: 'batch',
                taskId: queueHeadTaskId ?? selectedTask.workItemId,
                queueHeadTaskId,
                originalPrompt: activeBatch.sourcePrompt,
                batchId: activeBatch.batchId,
                batchState: 'queue-head-active'
            }),
            deliveryPrinciple: buildTaskDeliveryPrinciple({
                channel: 'batch',
                taskId: queueHeadTaskId ?? selectedTask.workItemId
            }),
            selectedTask,
            targetRepo: selectedTask.targetRepo,
            requiredCommand: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(activeBatch.sourcePrompt)} --auto-intent --json`,
            taskQueue,
            queueId: activeQueue?.queueId ?? activeBatch.batchId,
            batchId: activeBatch.batchId,
            scopeKey: activeBatch.scopeKey,
            queueHeadTaskId,
            queueSize: activeBatch.taskIds.length,
            activeBatchRunId: activeBatch.batchId,
            governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
                channel: 'batch',
                prompt: activeBatch.sourcePrompt,
                actorId: input.actor,
                taskId: queueHeadTaskId ?? selectedTask.workItemId
            }),
            allowedCommands: allowedGuidanceBootstrapCommands(),
            blockedCommands: blockedMutationCommands()
        }, {
            taskId: queueHeadTaskId ?? selectedTask.workItemId,
            channel: 'batch',
            knowledgeSummary: buildTeamKnowledgeSummary({
                cwd: input.cwd,
                taskId: queueHeadTaskId ?? selectedTask.workItemId,
                top: 3
            })
        });
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_QUEUE_READY', 'ATM kept this task inside the active batch context.', {
                queueSize: activeBatch.taskIds.length,
                queueId: activeQueue?.queueId ?? activeBatch.batchId,
                queueHeadTaskId,
                selectedTaskId: selectedTask.workItemId,
                requiredCommand: nextAction.requiredCommand,
                batchCheckpointCommand: 'node atm.mjs batch checkpoint --actor <id> --json',
                blockedPattern: 'manual per-task normal-flow switching during active batch'
            })),
            evidence: {
                nextAction,
                recommendedChannel: 'batch',
                batchRun: activeBatch,
                taskQueue,
                agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    const explicitTaskSelector = input.taskIntent?.explicitTaskIds.length === 1
        && findTaskByTaskIdReference([selectedTask], input.taskIntent.explicitTaskIds[0])?.workItemId === selectedTask.workItemId
        ? input.taskIntent.explicitTaskIds[0]
        : null;
    const claimCommandContract = buildTaskScopedClaimCommand({
        selectedTaskId: selectedTask.workItemId,
        explicitTaskSelector,
        userPrompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId
    });
    const normalClaimCommand = claimCommandContract?.normalClaimCommand
        ?? `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(input.taskIntent?.userPrompt ?? selectedTask.workItemId)} --auto-intent --json`;
    const taskScopedClaimCommand = claimCommandContract?.taskScopedClaimCommand
        ?? `node atm.mjs next --claim --actor <id> --task ${selectedTask.workItemId} --auto-intent --json`;
    profile.mark('build-claim-commands');
    const governanceReadiness = buildGovernanceReadinessHint(input.cwd, {
        channel: 'normal',
        prompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId,
        actorId: input.actor,
        taskId: selectedTask.workItemId
    });
    profile.mark('build-governance-readiness');
    const knowledgeSummary = buildTeamKnowledgeSummary({
        cwd: input.cwd,
        taskId: selectedTask.workItemId,
        top: 3
    });
    profile.mark('build-team-knowledge-summary');
    const planningCardImport = buildPlanningCardImportRequirement(selectedTask);
    const nextAction = embedTeamRecommendation({
        status: 'task-route-ready',
        command: planningCardImport?.requiredCommand ?? normalClaimCommand,
        reason: `the prompt resolves to task ${selectedTask.workItemId}`,
        recommendedChannel: 'normal',
        riskLevel: 'medium',
        taskScopedClaimCommand,
        claimCommandShape: claimCommandContract?.claimCommandShape ?? (explicitTaskSelector ? 'task-scoped' : 'prompt-scoped'),
        playbook: buildChannelPlaybook({
            channel: 'normal',
            taskId: selectedTask.workItemId,
            originalPrompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId
        }),
        governanceReadiness,
        deliveryPrinciple: buildTaskDeliveryPrinciple({
            channel: 'normal',
            taskId: selectedTask.workItemId
        }),
        selectedTask,
        targetRepo: selectedTask.targetRepo,
        requiredCommand: planningCardImport?.requiredCommand ?? normalClaimCommand,
        planningCardImport,
        allowedCommands: allowedGuidanceBootstrapCommands(),
        blockedCommands: blockedMutationCommands()
    }, {
        taskId: selectedTask.workItemId,
        channel: 'normal',
        knowledgeSummary
    });
    profile.mark('embed-team-recommendation');
    profile.flush('build-normal-task-route-ready');
    return makeResult({
        ok: true,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_ROUTE_READY', 'ATM resolved the prompt to one task route.', {
            task: toTaskCandidateView(selectedTask),
            requiredCommand: nextAction.requiredCommand,
            planningCardImport
        })),
        evidence: {
            nextAction,
            recommendedChannel: 'normal',
            agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
            taskIntent: input.taskIntent,
            importedTaskQueue: input.importedTaskQueue,
            integrationBootstrap: input.integrationBootstrap,
            runtimeAdapterReadiness: input.runtimeAdapterReadiness
        }
    });
}
function isReadOnlyPromptScopeMiss(taskIntent) {
    if (!taskIntent)
        return false;
    const action = taskIntent.requestedAction;
    return action === 'audit' || action === 'analyze';
}
function buildPlanningCardImportRequirement(task) {
    if (!task)
        return null;
    const taskPath = typeof task.taskPath === 'string' ? task.taskPath : null;
    if (taskPath?.startsWith('.atm/history/tasks/'))
        return null;
    const importPath = taskPath || task.sourcePlanPath;
    if (!importPath)
        return null;
    return {
        schemaId: 'atm.planningCardImportRequirement.v1',
        status: 'planning-card-not-in-target-ledger',
        taskId: task.workItemId,
        sourcePlanPath: task.sourcePlanPath,
        taskCardPath: task.taskPath,
        requiredCommand: `node atm.mjs tasks import --from ${quoteCliValue(importPath)} --write --json`,
        dryRunCommand: `node atm.mjs tasks import --from ${quoteCliValue(importPath)} --dry-run --json`,
        reason: 'The prompt resolved to a Markdown planning card, but ATM has no imported target-ledger task for it yet.'
    };
}
function buildPromptGuidanceNextResult(input) {
    const prompt = input.taskIntent?.userPrompt?.trim();
    if (!prompt || input.taskIntent?.taskScopeMentioned === true)
        return null;
    const quickfixScope = resolveQuickfixScope(prompt);
    if (isQuickfixPrompt(prompt) && quickfixScope.length > 0) {
        const nextAction = {
            status: 'quickfix-ready',
            command: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(prompt)} --json`,
            reason: 'the prompt looks like a small targeted fix with path-like scope, so ATM can use the fast quickfix channel',
            recommendedChannel: 'fast',
            riskLevel: 'low',
            playbook: buildChannelPlaybook({
                channel: 'fast',
                originalPrompt: prompt
            }),
            governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
                channel: 'fast',
                prompt,
                actorId: input.actor,
                ownFiles: quickfixScope
            }),
            allowedFiles: quickfixScope,
            allowedCommands: allowedGuidanceBootstrapCommands(),
            blockedCommands: blockedMutationCommands()
        };
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_QUICKFIX_ROUTE_READY', 'ATM routed this prompt to the fast quickfix channel.', {
                requiredCommand: nextAction.command,
                allowedFiles: quickfixScope
            })),
            evidence: {
                nextAction,
                recommendedChannel: 'fast',
                taskIntent: input.taskIntent,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    const frameworkStatus = createFrameworkModeStatus({ cwd: input.cwd });
    if (frameworkStatus.repoIdentity.isFrameworkRepo && isFrameworkMaintenancePrompt(prompt)) {
        const claimCommand = buildFrameworkTempClaimCommand([], prompt);
        const nextAction = {
            status: 'framework-temp-claim-required',
            command: claimCommand,
            reason: 'the prompt appears to be ATM framework maintenance without a human task card, so use a temporary runtime claim before editing critical framework files',
            recommendedChannel: 'fast',
            riskLevel: 'high',
            playbook: buildChannelPlaybook({
                channel: 'fast',
                originalPrompt: prompt,
                fastClaimCommand: claimCommand,
                fastClaimLabel: 'framework temp claim'
            }),
            governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
                channel: 'fast',
                prompt,
                actorId: input.actor,
                frameworkClaimRequired: true
            }),
            allowedCommands: [
                claimCommand,
                'node atm.mjs framework-mode status --json',
                'node atm.mjs guard framework-development --json'
            ],
            blockedCommands: [
                'editing framework critical files before framework-mode claim',
                'creating AI-authored permanent task cards in .atm/history/tasks'
            ]
        };
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_FRAMEWORK_TEMP_CLAIM_REQUIRED', 'ATM detected framework maintenance without a scoped task; acquire a temporary framework runtime claim before editing.', {
                requiredCommand: claimCommand
            })),
            evidence: {
                nextAction,
                recommendedChannel: 'fast',
                agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
                taskIntent: input.taskIntent,
                frameworkStatus,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    const nextAction = {
        status: 'prompt-guidance-required',
        command: `node atm.mjs guide --goal ${quoteCliValue(prompt)} --cwd . --json`,
        reason: 'the user supplied a prompt that is not task-scoped, so ATM routes guidance from that prompt instead of reusing stale global guidance',
        recommendedChannel: null,
        riskLevel: 'medium',
        governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
            channel: null,
            prompt,
            actorId: input.actor
        }),
        allowedCommands: allowedGuidanceBootstrapCommands(),
        blockedCommands: blockedMutationCommands(),
        ...buildNonPlaybookRouteHints(input.cwd, prompt)
    };
    const userNotice = buildFirstUseUserNotice(nextAction);
    return makeResult({
        ok: true,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, userNotice, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED', 'ATM routed next-action guidance from the current prompt instead of stale global state.', {
            command: nextAction.command
        })),
        evidence: {
            nextAction,
            agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
            ...(userNotice ? { userNotice } : {}),
            taskIntent: input.taskIntent,
            integrationBootstrap: input.integrationBootstrap,
            runtimeAdapterReadiness: input.runtimeAdapterReadiness
        }
    });
}
function buildPromptRequiredNextResult(input) {
    const candidatePreview = input.importedTaskQueue.tasks.slice(0, 12).map(toTaskCandidateView);
    const nextAction = {
        status: 'prompt-required',
        command: 'node atm.mjs next --prompt "<current user prompt>" --json',
        reason: 'task cards exist, but no current user prompt was provided; ATM will not choose a global task or batch by accident',
        recommendedChannel: null,
        riskLevel: 'medium',
        candidateCount: input.importedTaskQueue.tasks.length,
        candidates: candidatePreview,
        batchInstruction: 'If the user asked for all task cards, a whole plan, or multiple tasks, rerun with the original prompt so ATM can return recommendedChannel=batch and require batch checkpoint.',
        allowedCommands: [
            'node atm.mjs next --prompt "<current user prompt>" --json',
            'node atm.mjs next --claim --actor <id> --prompt "<current user prompt>" --auto-intent --json'
        ],
        blockedCommands: [
            'manual tasks claim/close loops without prompt-scoped next',
            'batch task closure without node atm.mjs batch checkpoint --actor <id> --json'
        ]
    };
    return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('error', input.claimRequested ? 'ATM_NEXT_CLAIM_PROMPT_REQUIRED' : 'ATM_NEXT_PROMPT_REQUIRED_FOR_TASK_ROUTING', 'ATM found task cards, but no user prompt was provided. Rerun next with the current user prompt so ATM can choose fast, normal, or batch correctly.', {
            requiredCommand: nextAction.command,
            candidateCount: nextAction.candidateCount,
            batchInstruction: nextAction.batchInstruction
        })),
        evidence: {
            nextAction,
            importedTaskQueue: input.importedTaskQueue,
            integrationBootstrap: input.integrationBootstrap,
            runtimeAdapterReadiness: input.runtimeAdapterReadiness
        }
    });
}
function inspectImportedTaskQueue(cwd, taskIntent, claimIntent = 'write') {
    const profile = createNextProfiler('ATM_NEXT_QUEUE_PROFILE');
    const planningRootResolution = resolveCandidatePlanningRoots(cwd, {
        configuredRoots: readConfiguredPlanningRoots(cwd)
    });
    profile.mark('resolve-planning-roots');
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    const jsonTasks = existsSync(taskStorePath) ? readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        const filePath = path.join(taskStorePath, entry);
        try {
            const rawText = readFileSync(filePath, 'utf8');
            const metadata = extractJsonTaskMetadata(rawText);
            if (metadata.schemaVersion !== 'atm.workItem.v0.2' && !metadata.hasSource) {
                return [];
            }
            const workItemId = metadata.workItemId;
            if (!workItemId)
                return [];
            const status = metadata.status ?? 'planned';
            const shouldHydrateScope = isTaskRoutable(status, taskIntent)
                || isTaskIdMentioned(workItemId, taskIntent)
                || (isHandoffPrompt(taskIntent?.userPrompt ?? '') && normalizeTaskRouteStatus(status) === 'running');
            if (!shouldHydrateScope) {
                return [buildMinimalImportedJsonTaskSummary({
                        cwd,
                        filePath,
                        workItemId,
                        title: metadata.title ?? workItemId,
                        status,
                        sourcePlanPath: metadata.sourcePlanPath
                    })];
            }
            const parsed = parseJsonText(rawText);
            const dependencies = Array.isArray(parsed.dependencies)
                ? parsed.dependencies.filter((entry) => typeof entry === 'string')
                : [];
            const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
                ? parsed.claim
                : {};
            const source = parsed.source && typeof parsed.source === 'object' ? parsed.source : {};
            const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
            const outOfScope = readStringArray(parsed.outOfScope ?? parsed.out_of_scope ?? parsed.forbidden_files ?? parsed.forbiddenFiles);
            return [finalizeImportedTaskSummary({
                    workItemId,
                    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : workItemId,
                    status,
                    closedAt: normalizeOptionalString(parsed.closedAt ?? parsed.closed_at),
                    closedByActor: normalizeOptionalString(parsed.closedByActor ?? parsed.closed_by_actor),
                    closurePacket: normalizeOptionalString(parsed.closurePacket ?? parsed.closure_packet),
                    lastTransitionId: normalizeOptionalString(parsed.lastTransitionId ?? parsed.last_transition_id),
                    lastTransitionAt: normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at),
                    milestone: typeof parsed.milestone === 'string' ? parsed.milestone : null,
                    dependencies,
                    taskPath: path.relative(cwd, filePath).replace(/\\/g, '/'),
                    format: 'json',
                    sourcePlanPath,
                    nearbyPlanPaths: [],
                    scopePaths: shouldHydrateScope ? (() => {
                        const explicit = uniqueSorted([
                            ...readStringArray(parsed.scope),
                            ...readStringArray(parsed.scopePaths),
                            ...readStringArray(parsed.files)
                        ].map((p) => {
                            const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                            return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
                        }));
                        const claimFiles = readStringArray(claimRecord.files);
                        // ATM-BUG-2026-07-07-043/044: `tasks scope add` merges amended paths into
                        // taskDirectionLock.allowedFiles (and claim.files), but never rewrites this
                        // task's own static scope/scopePaths/files declaration. Re-hydrating scope
                        // here from `explicit` alone (and filtering claim.files against it) silently
                        // dropped scope-amendment paths on the next `next --claim`. Treat the
                        // governed taskDirectionLock.allowedFiles as an equally trusted source so
                        // scope amendments survive re-claim.
                        const directionLock = parsed.taskDirectionLock;
                        const lockAllowedFiles = directionLock && typeof directionLock === 'object' && !Array.isArray(directionLock)
                            ? readStringArray(directionLock.allowedFiles)
                            : [];
                        const rawScope = explicit.length > 0
                            ? uniqueSorted([
                                ...explicit,
                                ...claimFiles.filter((file) => isPathAllowedByScope(file, explicit)),
                                ...lockAllowedFiles
                            ])
                            : uniqueSorted([
                                ...extractDeclaredTaskPathsFromDocument(parsed),
                                ...extractLinkedSourceTaskArtifactPaths(cwd, sourcePlanPath)
                            ].map((p) => {
                                const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                                return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
                            }));
                        return outOfScope.length > 0
                            ? rawScope.filter((entry) => !isPathAllowedByScope(entry, outOfScope))
                            : rawScope;
                    })() : [],
                    outOfScope,
                    targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
                    planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
                    allowPlanningMirror: allowsPlanningMirror(parsed),
                    closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
                    activeClaimActorId: claimRecord.state === 'active' && typeof claimRecord.actorId === 'string'
                        ? claimRecord.actorId
                        : null,
                    activeClaimIntent: claimRecord.state === 'active' && typeof claimRecord.intent === 'string'
                        ? claimRecord.intent
                        : (claimRecord.state === 'active' ? 'write' : null)
                }, cwd)];
        }
        catch {
            return [];
        }
    }) : [];
    profile.mark(`read-json-tasks count=${jsonTasks.length}`);
    const skipMarkdownTaskDiscovery = shouldSkipMarkdownTaskDiscovery(cwd, jsonTasks, taskIntent);
    profile.mark(`should-skip-markdown-task-discovery value=${skipMarkdownTaskDiscovery}`);
    const skipExternalTaskCardScan = skipMarkdownTaskDiscovery || shouldSkipExternalTaskCardScan(cwd, jsonTasks, taskIntent);
    profile.mark(`should-skip-external-task-card-scan value=${skipExternalTaskCardScan}`);
    const markdownTaskFiles = shouldDiscoverMarkdownTaskCards(taskIntent) && !skipMarkdownTaskDiscovery
        ? uniqueSorted([
            ...listTaskCardFiles(cwd),
            ...(skipExternalTaskCardScan ? [] : listPromptScopedExternalTaskCardFiles(cwd, taskIntent, planningRootResolution.roots))
        ])
        : [];
    profile.mark('list-markdown-task-files');
    const markdownTasks = markdownTaskFiles
        .map((filePath) => {
        const rawText = readFileSync(filePath, 'utf8');
        const parsed = parseMarkdownFrontmatter(rawText);
        const workItemId = normalizeOptionalString(parsed.task_id ?? parsed.taskId ?? parsed.workItemId ?? parsed.id)
            ?? path.basename(filePath).replace(/\.task\.md$/, '');
        if (!workItemId)
            return null;
        const dependencies = splitListValue(parsed.dependencies ?? parsed.depends_on ?? parsed.dependsOn ?? parsed.blocked_by ?? parsed.blockedBy);
        const relativeTaskPath = path.relative(cwd, filePath).replace(/\\/g, '/');
        const outOfScope = splitListValue(parsed.outOfScope ?? parsed.out_of_scope ?? parsed.forbidden_files ?? parsed.forbiddenFiles);
        return finalizeImportedTaskSummary({
            workItemId,
            title: normalizeOptionalString(parsed.title ?? parsed.name) ?? workItemId,
            status: normalizeOptionalString(parsed.status) ?? 'planned',
            closedAt: normalizeOptionalString(parsed.closed_at ?? parsed.closedAt),
            closedByActor: normalizeOptionalString(parsed.closed_by_actor ?? parsed.closedByActor),
            closurePacket: normalizeOptionalString(parsed.closure_packet ?? parsed.closurePacket),
            lastTransitionId: normalizeOptionalString(parsed.last_transition_id ?? parsed.lastTransitionId),
            lastTransitionAt: normalizeOptionalString(parsed.last_transition_at ?? parsed.lastTransitionAt),
            milestone: normalizeOptionalString(parsed.milestone),
            dependencies,
            taskPath: relativeTaskPath,
            format: 'markdown',
            sourcePlanPath: normalizeOptionalString(parsed.plan_path ?? parsed.planPath ?? parsed.source_plan ?? parsed.sourcePlan ?? parsed.related_plan ?? parsed.relatedPlan),
            nearbyPlanPaths: findNearbyPlanPaths(cwd, filePath),
            scopePaths: (() => {
                const explicit = uniqueSorted([
                    ...splitListValue(parsed.scope ?? parsed.scope_paths ?? parsed.scopePaths),
                    ...splitListValue(parsed.files ?? parsed.file_paths ?? parsed.filePaths),
                    ...splitListValue(parsed.allowed_files ?? parsed.allowedFiles),
                    ...splitListValue(parsed.deliverables),
                    ...splitListValue(parsed.paths)
                ].map((p) => {
                    const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                    return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
                }));
                const rawScope = explicit.length > 0
                    ? explicit
                    : uniqueSorted([
                        ...extractTaskArtifactPathsFromMarkdown(cwd, rawText)
                    ].map((p) => {
                        const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                        return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
                    }));
                return outOfScope.length > 0
                    ? rawScope.filter((entry) => !isPathAllowedByScope(entry, outOfScope))
                    : rawScope;
            })(),
            outOfScope,
            targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
            planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
            allowPlanningMirror: allowsPlanningMirror(parsed),
            closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
            activeClaimActorId: null,
            activeClaimIntent: null
        }, cwd);
    })
        .filter((entry) => entry !== null);
    profile.mark('read-markdown-tasks');
    const allTasks = dedupeTasks([...jsonTasks, ...markdownTasks]);
    profile.mark('dedupe-tasks');
    const tasks = allTasks
        .filter((task) => isTaskRoutable(task.status, taskIntent)
        || isTaskExplicitlyMentioned(task, taskIntent)
        || (isHandoffPrompt(taskIntent?.userPrompt ?? '') && isActiveClaimedTask(task)))
        .sort((left, right) => {
        const statusWeight = statusQueueWeight(left.status) - statusQueueWeight(right.status);
        return statusWeight !== 0 ? statusWeight : left.workItemId.localeCompare(right.workItemId);
    });
    const statusById = new Map(allTasks.map((task) => [task.workItemId, task.status]));
    const activeQueue = findActiveTaskQueueForIntent(cwd, taskIntent);
    profile.mark('find-active-task-queue');
    const activeQueueTasks = activeQueue
        ? activeQueue.taskIds
            .slice(activeQueue.currentIndex)
            .map((taskId) => allTasks.find((task) => task.workItemId === taskId))
            .filter((task) => Boolean(task))
        : [];
    const promptScope = activeQueue && activeQueueTasks.length > 0
        ? {
            status: 'queue',
            selectedTasks: activeQueueTasks,
            targetRepo: activeQueue.targetRepo,
            diagnostics: [`active-queue:${activeQueue.queueId}`, `queue-index:${activeQueue.currentIndex}`]
        }
        : resolvePromptScopedTaskRoute(cwd, tasks, taskIntent, planningRootResolution);
    profile.mark('resolve-prompt-scoped-task-route');
    const planningRootMissing = promptScope?.status === 'not-found' && taskIntent
        ? shouldReportPlanningRootMissing({
            cwd,
            taskScopeMentioned: taskIntent.taskScopeMentioned,
            mentionedPlanPaths: taskIntent.mentionedPlanPaths,
            userPrompt: taskIntent.userPrompt,
            matchedTaskCount: tasks.filter((task) => (task.matchScore ?? 0) > 0).length
        })
        : null;
    const selectedTaskPool = promptScope?.selectedTasks ?? [];
    const explicitSingleTaskRoute = isExplicitSingleTaskRoute(promptScope, taskIntent);
    const selectedTask = selectImportedTaskForPromptScope(selectedTaskPool, promptScope?.status === 'queue', explicitSingleTaskRoute, statusById, cwd);
    profile.mark('select-imported-task-for-prompt-scope');
    const claimableTask = selectedTask
        && selectedTask.format === 'json'
        && (isSelectedTaskClaimableForIntent(selectedTask, claimIntent) || isTaskAlreadyActivelyClaimed(selectedTask))
        && (areTaskDependenciesSatisfied(selectedTask, statusById, cwd) || isTaskAlreadyActivelyClaimed(selectedTask))
        ? selectedTask
        : null;
    profile.mark('resolve-claimable-task');
    profile.flush('inspect-imported-task-queue');
    return {
        taskStorePath: existsSync(taskStorePath) ? path.relative(cwd, taskStorePath).replace(/\\/g, '/') : '.atm/history/tasks',
        openTaskCount: tasks.length,
        selectedTask,
        claimableTask,
        tasks,
        promptScope,
        planningRootWarnings: planningRootResolution.warnings,
        planningRootMissing
    };
}
export function shouldSkipExternalTaskCardScan(cwd, jsonTasks, taskIntent) {
    if (!taskIntent?.taskScopeMentioned)
        return false;
    if (taskIntent.mentionedPlanPaths.length > 0)
        return false;
    const promptScopedJsonRoute = resolvePromptScopedTaskRoute(cwd, jsonTasks, taskIntent);
    if (promptScopedJsonRoute && promptScopedJsonRoute.selectedTasks.length > 0) {
        return true;
    }
    if (taskIntent.mentionedTaskIds.length === 0 && taskIntent.taskRootHints.length === 0)
        return false;
    return jsonTasks.some((task) => isTaskExplicitlyMentioned(task, taskIntent));
}
export function shouldSkipMarkdownTaskDiscovery(cwd, jsonTasks, taskIntent) {
    if (!taskIntent?.taskScopeMentioned)
        return false;
    if (taskIntent.mentionedPlanPaths.length > 0)
        return false;
    if (taskIntent.mentionedTaskIds.length > 0
        && jsonTasks.some((task) => isTaskIdMentioned(task.workItemId, taskIntent))) {
        return true;
    }
    const promptScopedJsonRoute = resolvePromptScopedTaskRoute(cwd, jsonTasks, taskIntent);
    return Boolean(promptScopedJsonRoute && promptScopedJsonRoute.selectedTasks.length > 0);
}
function selectImportedTaskForPromptScope(selectedTaskPool, isActiveQueue, explicitSingleTaskRoute, statusById, cwd) {
    if (isActiveQueue || explicitSingleTaskRoute) {
        return selectedTaskPool[0] ?? null;
    }
    return selectedTaskPool.find((task) => areTaskDependenciesSatisfied(task, statusById, cwd)) ?? null;
}
function isSelectedTaskClaimableForIntent(task, claimIntent) {
    const status = normalizeTaskRouteStatus(task.status);
    if (canTaskBePreparedForClaim(status))
        return true;
    return status === 'review' && claimIntent === 'closeout-only';
}
function hasPromptScopedWorkItems(importedTaskQueue) {
    return importedTaskQueue.tasks.some((task) => task.workItemId !== bootstrapTaskId);
}
async function prepareImportedTaskForClaim(input) {
    const normalizedStatus = normalizeTaskRouteStatus(input.task.status);
    const prepared = prepareTaskForClaim({
        cwd: input.cwd,
        taskId: input.task.workItemId,
        actorId: input.actorId,
        status: input.task.status,
        title: input.task.title,
        transitionCommand: `node atm.mjs next --claim --task ${input.task.workItemId} --actor ${input.actorId} --auto-intent --json`
    });
    return {
        taskId: input.task.workItemId,
        originalStatus: normalizedStatus,
        steps: prepared.steps.map((step) => ({
            action: step.action,
            evidence: {
                action: step.action,
                taskId: input.task.workItemId,
                actorId: input.actorId,
                status: step.status,
                transitionPath: step.transitionPath,
                importEvidencePath: step.importEvidencePath ?? null
            }
        }))
    };
}
async function registerPreClaimBrokerTransaction(input) {
    const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: input.cwd, encoding: 'utf8' });
    const baseCommit = head.status === 0 ? head.stdout.trim() : '';
    if (!baseCommit) {
        throw new CliError('ATM_BROKER_TRANSACTION_BASE_MISSING', 'next --claim requires a resolvable HEAD before registering its Broker transaction.', { exitCode: 1 });
    }
    const intent = {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'next pre-claim Broker transaction' },
        taskId: input.taskId,
        actorId: input.actorId,
        baseCommit,
        targetFiles: input.targetFiles,
        atomRefs: [],
        sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
        requestedLane: 'auto'
    };
    const intentPath = path.join(input.cwd, '.atm', 'runtime', 'broker-intents', `${input.taskId}.json`);
    mkdirSync(path.dirname(intentPath), { recursive: true });
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
    const result = await runBroker([
        'register', '--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId, '--intent-file', intentPath
    ]);
    const evidence = result && typeof result === 'object' && 'evidence' in result
        ? result.evidence
        : null;
    const queueAdmission = evidence?.queueAdmission;
    if (!queueAdmission || typeof queueAdmission !== 'object' || !('status' in queueAdmission)) {
        throw new CliError('ATM_BROKER_TRANSACTION_INVALID', 'Broker pre-claim registration returned no canonical queue admission.', { exitCode: 1 });
    }
    return {
        intentPath: path.relative(input.cwd, intentPath).replace(/\\/g, '/'),
        baseCommit,
        queueAdmission,
        brokerDecision: evidence.decision ?? null
    };
}
export function resolvePromptScopedTaskContext(cwd, input) {
    const taskIntent = resolveTaskIntent(cwd, {
        prompt: normalizeOptionalString(input.prompt) ?? undefined,
        intentPath: normalizeOptionalString(input.intentPath) ?? undefined
    });
    const importedTaskQueue = inspectImportedTaskQueue(cwd, taskIntent);
    return {
        taskIntent: taskIntent ? {
            userPrompt: taskIntent.userPrompt,
            explicitTaskIds: taskIntent.explicitTaskIds,
            taskScopeMentioned: taskIntent.taskScopeMentioned,
            requestedAction: taskIntent.requestedAction,
            source: taskIntent.source
        } : null,
        promptScope: importedTaskQueue.promptScope ? {
            status: importedTaskQueue.promptScope.status,
            selectedTasks: importedTaskQueue.promptScope.selectedTasks,
            targetRepo: importedTaskQueue.promptScope.targetRepo,
            diagnostics: importedTaskQueue.promptScope.diagnostics
        } : null
    };
}
function resolveTaskIntent(cwd, input) {
    const cliExplicitTaskIds = uniqueInOrder(input.explicitTaskIds ?? []);
    const fileIntent = input.intentPath ? readTaskIntentFile(cwd, input.intentPath) : null;
    if (fileIntent) {
        const explicitTaskIds = uniqueInOrder([...cliExplicitTaskIds, ...fileIntent.explicitTaskIds]);
        return {
            ...fileIntent,
            userPrompt: input.prompt ?? fileIntent.userPrompt,
            explicitTaskIds,
            taskScopeMentioned: fileIntent.taskScopeMentioned || explicitTaskIds.length > 0
        };
    }
    if (input.prompt && input.prompt.trim().length > 0) {
        return createDeterministicTaskIntent(input.prompt, cliExplicitTaskIds);
    }
    if (cliExplicitTaskIds.length > 0)
        return createDeterministicTaskIntent(cliExplicitTaskIds.join(','), cliExplicitTaskIds);
    return null;
}
function readTaskIntentFile(cwd, intentPath) {
    const absolutePath = path.isAbsolute(intentPath) ? intentPath : path.join(cwd, intentPath);
    const parsed = parseJsonText(readFileSync(absolutePath, 'utf8'));
    if (parsed.schemaId !== 'atm.taskIntent.v1') {
        throw new CliError('ATM_TASK_INTENT_SCHEMA_INVALID', 'next --intent requires schemaId atm.taskIntent.v1.', {
            exitCode: 2,
            details: { intentPath }
        });
    }
    return normalizeTaskIntent(parsed, 'atm-skill');
}
function findActiveTaskQueueForIntent(cwd, intent, options = {}) {
    if (intent?.userPrompt) {
        const exact = findActiveTaskQueue(cwd, intent.userPrompt);
        if (exact)
            return exact;
    }
    if (options.sourcePromptFallback) {
        const fallback = findActiveTaskQueue(cwd, options.sourcePromptFallback);
        if (fallback)
            return fallback;
    }
    for (const scopeKey of deriveBatchScopeKeysFromIntent(intent)) {
        const scoped = findActiveTaskQueue(cwd, null, { scopeKey });
        if (scoped)
            return scoped;
    }
    if (options.taskId) {
        const byTask = findActiveTaskQueue(cwd, null, { taskId: options.taskId });
        if (byTask)
            return byTask;
    }
    return null;
}
function reconcilePromptScopeRuntimeForClaim(cwd, taskIntent, selectedTasks) {
    const sourcePrompt = taskIntent?.userPrompt?.trim() ?? '';
    if (!sourcePrompt || selectedTasks.length === 0)
        return null;
    const existingQueue = findActiveTaskQueueForIntent(cwd, taskIntent, {
        taskId: selectedTasks[0]?.workItemId ?? null
    });
    const refreshedQueue = createOrRefreshTaskQueue({
        cwd,
        sourcePrompt,
        tasks: selectedTasks,
        taskIds: selectedTasks.map((task) => task.workItemId),
        actorId: null,
        batchId: existingQueue?.batchId ?? null,
        scopeKey: existingQueue?.scopeKey ?? null
    });
    if (existingQueue && existingQueue.queueId !== refreshedQueue.queueId && existingQueue.status === 'active') {
        abandonTaskQueue({
            cwd,
            queueId: existingQueue.queueId,
            actorId: 'atm-runtime-reconcile',
            reason: `superseded by dependency-refreshed prompt queue ${refreshedQueue.queueId}`
        });
    }
    const queueHeadTaskId = refreshedQueue.taskIds[refreshedQueue.currentIndex] ?? null;
    const queueHeadTask = queueHeadTaskId
        ? selectedTasks.find((task) => task.workItemId === queueHeadTaskId) ?? null
        : null;
    const activeBatch = refreshedQueue.batchId
        ? readActiveBatchRun(cwd, { batchId: refreshedQueue.batchId })
        : findActiveBatchRunForIntent(cwd, taskIntent, { taskId: queueHeadTaskId });
    const batchRun = activeBatch?.status === 'active'
        ? repairBatchRunFromQueue(cwd, activeBatch, refreshedQueue)
        : null;
    return {
        queue: refreshedQueue,
        batchRun,
        queueHeadTask
    };
}
function findActiveBatchRunForIntent(cwd, intent, options = {}) {
    if (intent?.userPrompt) {
        const exact = readActiveBatchRun(cwd, { sourcePrompt: intent.userPrompt });
        if (exact)
            return exact;
    }
    if (options.sourcePromptFallback) {
        const fallback = readActiveBatchRun(cwd, { sourcePrompt: options.sourcePromptFallback });
        if (fallback)
            return fallback;
    }
    for (const scopeKey of deriveBatchScopeKeysFromIntent(intent)) {
        const scoped = readActiveBatchRun(cwd, { scopeKey });
        if (scoped)
            return scoped;
    }
    if (options.taskId) {
        const byTask = readActiveBatchRun(cwd, { taskId: options.taskId });
        if (byTask)
            return byTask;
    }
    return null;
}
function deriveBatchScopeKeysFromIntent(intent) {
    if (!intent)
        return [];
    const roots = [
        ...intent.taskRootHints,
        ...intent.mentionedTaskIds
            .map((taskId) => taskId.match(/^(.+?)-\d{2,}(?:-.+)?$/)?.[1] ?? null)
            .filter((entry) => Boolean(entry))
    ];
    return uniqueSorted(roots.flatMap((root) => normalizeRootHintScopeKeys(root)));
}
function normalizeRootHintScopeKeys(root) {
    const normalized = root.trim().toUpperCase().replace(/_/g, '-');
    if (!normalized)
        return [];
    if (normalized.startsWith('TASK-'))
        return [normalized];
    if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(normalized)) {
        return [`TASK-${normalized}`];
    }
    return [normalized];
}
function createDeterministicTaskIntent(prompt, explicitTaskIds = []) {
    const mentionedTaskIds = uniqueSorted(extractTaskIdReferencesFromPrompt(prompt).flatMap((entry) => expandTaskIdReferenceAliases(entry)));
    const mentionedPlanPaths = uniqueSorted(extractPromptPathHints(prompt).filter((entry) => /\.md$/i.test(entry)));
    const targetRepoHints = uniqueSorted([
        ...(/AI-Atomic-Framework|ATM\s*framework|ATM\s*\u6846\u67b6|ATM\u6846\u67b6|\u539f\u5b50\u6846\u67b6/i.test(prompt) ? ['AI-Atomic-Framework'] : [])
    ]);
    const taskRootHints = uniqueSorted([
        ...(/self[-_ ]?atomization|\u81ea\u6211\u539f\u5b50\u5316|100%/i.test(prompt) ? ['atm-self-atomization'] : []),
        ...extractTaskFamilyRootHintsFromPrompt(prompt),
        ...extractTaskRootHintsFromPrompt(prompt, mentionedTaskIds),
        ...extractPromptPathHints(prompt).filter((entry) => !/\.md$/i.test(entry))
    ]);
    const ordinalScope = /\u524d\s*(?:3|\u4e09)\s*\u5f35|first\s+3/i.test(prompt)
        ? { kind: 'first', count: 3 }
        : /\u524d\s*(?:2|\u5169|\u4e8c)\s*\u5f35|first\s+2/i.test(prompt)
            ? { kind: 'first', count: 2 }
            : null;
    const queueRequested = isQueueRequestedPrompt(prompt) || Boolean(ordinalScope);
    const orderedExplicitTaskIds = uniqueInOrder(explicitTaskIds.map((entry) => entry.toUpperCase()));
    const taskScopeMentioned = orderedExplicitTaskIds.length > 0
        || mentionedTaskIds.length > 0
        || mentionedPlanPaths.length > 0
        || taskRootHints.length > 0
        || queueRequested
        || /\u4efb\u52d9\u5361|task\s*card|task[-_ ]?asa|\u8a08\u756b\u66f8/i.test(prompt);
    return {
        schemaId: 'atm.taskIntent.v1',
        userPrompt: prompt,
        explicitTaskIds: orderedExplicitTaskIds,
        mentionedTaskIds,
        mentionedPlanPaths,
        taskRootHints,
        targetRepoHints,
        requestedAction: detectRequestedTaskAction(prompt),
        confidence: orderedExplicitTaskIds.length > 0 ? 0.98 : taskScopeMentioned ? 0.7 : 0.25,
        source: 'cli-deterministic',
        ordinalScope,
        queueRequested,
        taskScopeMentioned
    };
}
function resolvePromptScopedTaskRoute(cwd, tasks, taskIntent, planningRootResolution) {
    if (!taskIntent || !taskIntent.taskScopeMentioned)
        return null;
    if (taskIntent.explicitTaskIds.length > 0) {
        const selectedTasks = taskIntent.explicitTaskIds
            .map((taskId) => findTaskByTaskIdReference(tasks, taskId))
            .filter((task) => Boolean(task));
        const missingTaskIds = taskIntent.explicitTaskIds.filter((taskId) => !findTaskByTaskIdReference(selectedTasks, taskId));
        if (missingTaskIds.length > 0) {
            return {
                status: 'not-found',
                selectedTasks,
                targetRepo: resolveRouteTargetRepo(selectedTasks),
                diagnostics: ['explicit-task-range-missing-task-ids', `missing:${missingTaskIds.join(',')}`]
            };
        }
        return {
            status: selectedTasks.length > 1 ? 'queue' : 'ready',
            selectedTasks,
            targetRepo: resolveRouteTargetRepo(selectedTasks),
            diagnostics: ['explicit-task-range']
        };
    }
    const handoffRoute = resolveHandoffResumeTaskRoute(cwd, tasks, taskIntent);
    if (handoffRoute)
        return handoffRoute;
    const scored = tasks
        .map((task) => scoreTaskForIntent(cwd, task, taskIntent))
        .filter((task) => (task.matchScore ?? 0) > 0)
        .sort(compareScoredTasks);
    const hasExplicitScopeHints = taskIntent.mentionedTaskIds.length > 0
        || taskIntent.mentionedPlanPaths.length > 0
        || taskIntent.taskRootHints.length > 0
        || taskIntent.targetRepoHints.length > 0;
    const viableMatches = hasExplicitScopeHints
        ? scored.filter((task) => hasRequiredPromptScopeMatch(task, taskIntent))
        : scored;
    if (viableMatches.length === 0) {
        if (taskIntent.queueRequested && !hasExplicitScopeHints && tasks.length > 0) {
            // ATM-BUG-2026-07-07-047: a blanket "all/open/remaining task cards"
            // prompt names no specific task, plan, or root, so nothing scores above
            // zero against keyword-based matching. ATM already discovered open
            // imported work in `tasks`; route the whole queue instead of
            // discarding it as task-scope-not-found.
            const scoped = applyOrdinalScope(tasks, taskIntent);
            return {
                status: 'queue',
                selectedTasks: scoped,
                targetRepo: resolveRouteTargetRepo(scoped),
                diagnostics: ['queue-requested-fallback-to-full-open-queue', `scoped-queue-size:${scoped.length}`]
            };
        }
        if (taskIntent.taskRootHints.some((hint) => hint.startsWith('TASK-'))
            && (taskIntent.mentionedTaskIds.length === 0
                && taskIntent.mentionedPlanPaths.length === 0
                && taskIntent.taskRootHints.length > 0
                && (taskIntent.queueRequested || taskIntent.ordinalScope !== null || taskIntent.requestedAction === 'close'))) {
            return {
                status: 'empty',
                selectedTasks: [],
                targetRepo: null,
                diagnostics: ['prompt-task-scope-had-no-open-imported-work']
            };
        }
        return {
            status: 'not-found',
            selectedTasks: [],
            targetRepo: null,
            diagnostics: ['prompt-task-scope-had-no-matching-task-card']
        };
    }
    if (viableMatches.every(isTaskCardSurfaceOnlyMatch)) {
        if (looksLikeNamedPlanPrompt(taskIntent.userPrompt ?? '')) {
            return {
                status: 'not-found',
                selectedTasks: [],
                targetRepo: null,
                diagnostics: ['low-confidence-task-card-surface-rejected', 'named-plan-prompt-had-no-matching-plan-tasks']
            };
        }
        return {
            status: 'ambiguous',
            selectedTasks: viableMatches.slice(0, 12),
            targetRepo: resolveRouteTargetRepo(viableMatches),
            diagnostics: ['low-confidence-task-card-surface-selection-required']
        };
    }
    const scoped = applyOrdinalScope(viableMatches, taskIntent);
    const selectedTasks = taskIntent.queueRequested || taskIntent.ordinalScope ? scoped : scoped.slice(0, 1);
    if (taskIntent.queueRequested || taskIntent.ordinalScope) {
        return {
            status: 'queue',
            selectedTasks,
            targetRepo: resolveRouteTargetRepo(selectedTasks),
            diagnostics: [`scoped-queue-size:${selectedTasks.length}`]
        };
    }
    const bestScore = viableMatches[0]?.matchScore ?? 0;
    const topMatches = viableMatches.filter((task) => (task.matchScore ?? 0) === bestScore);
    const exactTaskIdRequested = taskIntent.mentionedTaskIds.length > 0;
    if (topMatches.length === 1 && (exactTaskIdRequested || bestScore >= 60)) {
        return {
            status: 'ready',
            selectedTasks: [topMatches[0]],
            targetRepo: topMatches[0].targetRepo,
            diagnostics: topMatches[0].matchReasons ?? []
        };
    }
    return {
        status: 'ambiguous',
        selectedTasks: viableMatches.slice(0, 12),
        targetRepo: resolveRouteTargetRepo(viableMatches),
        diagnostics: ['multiple-task-candidates-matched-prompt']
    };
}
/**
 * Handoff documents are workspace-level artifacts rather than task cards, so
 * their filename cannot score against a ledger task path. When a handoff is
 * explicitly named, use the handoff's task references only as a constrained
 * hint: a referenced active claim is safe, a stale reference is not, and an
 * unqualified handoff may fall back only when exactly one active claim exists.
 */
export function resolveHandoffResumeTaskRoute(cwd, tasks, taskIntent) {
    if (!taskIntent?.userPrompt || !isHandoffPrompt(taskIntent.userPrompt))
        return null;
    const handoffPath = resolvePromptHandoffPath(cwd, taskIntent.userPrompt);
    if (!handoffPath)
        return null;
    const activeTasks = tasks.filter(isActiveClaimedTask);
    if (activeTasks.length === 0)
        return null;
    const handoffText = readFileText(handoffPath);
    const referencedTaskIds = handoffText ? extractTaskIdReferencesFromPrompt(handoffText) : [];
    if (referencedTaskIds.length > 0) {
        const referencedActiveTasks = activeTasks.filter((task) => referencedTaskIds.some((taskId) => expandTaskIdReferenceAliases(taskId).includes(task.workItemId.toUpperCase())));
        if (referencedActiveTasks.length === 1) {
            return {
                status: 'ready',
                selectedTasks: referencedActiveTasks,
                targetRepo: referencedActiveTasks[0]?.targetRepo ?? null,
                diagnostics: ['handoff-file-task-reference', 'handoff-file-active-claim-match']
            };
        }
        if (referencedActiveTasks.length > 1) {
            return {
                status: 'ambiguous',
                selectedTasks: referencedActiveTasks,
                targetRepo: resolveRouteTargetRepo(referencedActiveTasks),
                diagnostics: ['handoff-file-multiple-active-claim-matches']
            };
        }
        return {
            status: 'not-found',
            selectedTasks: [],
            targetRepo: null,
            diagnostics: ['handoff-file-references-no-active-claim']
        };
    }
    if (activeTasks.length === 1) {
        return {
            status: 'ready',
            selectedTasks: activeTasks,
            targetRepo: activeTasks[0]?.targetRepo ?? null,
            diagnostics: ['handoff-file-unique-active-claim-fallback']
        };
    }
    return {
        status: 'ambiguous',
        selectedTasks: activeTasks,
        targetRepo: resolveRouteTargetRepo(activeTasks),
        diagnostics: ['handoff-file-multiple-active-claims']
    };
}
function isActiveClaimedTask(task) {
    return normalizeTaskRouteStatus(task.status) === 'running'
        && typeof task.activeClaimActorId === 'string'
        && task.activeClaimActorId.trim().length > 0;
}
function isHandoffPrompt(prompt) {
    return /(?:handoff|unfinished[-_ ]work)\.md\b/i.test(prompt);
}
function resolvePromptHandoffPath(cwd, prompt) {
    const candidates = new Set();
    for (const match of prompt.matchAll(/[A-Za-z]:[^\s`"'<>]+\.md/gi)) {
        candidates.add(path.normalize(match[0].replace(/[),.;]+$/, '')));
    }
    for (const match of prompt.matchAll(/\b[A-Za-z0-9][A-Za-z0-9._-]*(?:handoff|unfinished[-_ ]work)[A-Za-z0-9._-]*\.md\b/gi)) {
        const basename = match[0];
        candidates.add(path.join(cwd, '.atm', 'history', 'handoff', basename));
    }
    for (const candidate of extractPathLikeStringsFromPrompt(prompt)) {
        if (/(?:handoff|unfinished[-_ ]work)\.md$/i.test(candidate)) {
            candidates.add(path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate));
        }
    }
    return [...candidates].find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}
function readFileText(filePath) {
    try {
        return readFileSync(filePath, 'utf8');
    }
    catch {
        return null;
    }
}
function findTaskByTaskIdReference(tasks, taskIdReference) {
    const aliases = expandTaskIdReferenceAliases(taskIdReference);
    return tasks.find((task) => aliases.includes(task.workItemId.toUpperCase())) ?? null;
}
function assertPromptBatchDoesNotConflict(input) {
    if (input.promptScope?.status !== 'queue')
        return;
    const requestedTaskIds = input.promptScope.selectedTasks.map((task) => task.workItemId);
    const requestedAllowedFiles = uniqueSorted(input.promptScope.selectedTasks.flatMap((task) => task.targetAllowedFiles));
    const sourcePromptHash = input.sourcePrompt?.trim() ? sha256(input.sourcePrompt.trim()) : null;
    const activeBatches = listActiveBatchRuns(input.cwd);
    for (const batchRun of activeBatches) {
        if (input.currentBatchId && batchRun.batchId === input.currentBatchId)
            continue;
        if (sourcePromptHash && batchRun.sourcePromptHash === sourcePromptHash)
            continue;
        const overlappingTaskIds = requestedTaskIds.filter((taskId) => batchRun.taskIds.includes(taskId));
        if (overlappingTaskIds.length > 0) {
            throw new CliError('ATM_BATCH_TASK_OWNERSHIP_CONFLICT', 'A task cannot belong to two active batch runs. Abandon or finish the existing batch before creating another one for the same task.', {
                exitCode: 1,
                details: {
                    batchId: batchRun.batchId,
                    scopeKey: batchRun.scopeKey,
                    overlappingTaskIds,
                    requiredCommand: `node atm.mjs batch status --batch ${batchRun.batchId} --json`
                }
            });
        }
        const batchTasks = batchRun.taskIds
            .map((taskId) => input.allTasks.find((task) => task.workItemId === taskId))
            .filter((task) => Boolean(task));
        const batchAllowedFiles = uniqueSorted(batchTasks.flatMap((task) => task.targetAllowedFiles));
        const overlappingFiles = requestedAllowedFiles.filter((file) => isPathAllowedByScope(file, batchAllowedFiles));
        if (overlappingFiles.length > 0) {
            throw new CliError('ATM_BATCH_FILE_CONFLICT', 'Another active batch already owns one or more target files for this batch range.', {
                exitCode: 1,
                details: {
                    conflictingBatchId: batchRun.batchId,
                    conflictingScopeKey: batchRun.scopeKey,
                    conflictingTaskIds: batchRun.taskIds,
                    overlappingFiles,
                    requiredAction: `Run node atm.mjs batch status --batch ${batchRun.batchId} --json, then checkpoint/commit or abandon that batch before claiming this overlapping range.`
                }
            });
        }
    }
}
function scoreTaskForIntent(cwd, task, intent) {
    const prompt = normalizeSearchText(intent.userPrompt ?? '');
    const reasons = [];
    let score = 0;
    if (intent.mentionedTaskIds.includes(task.workItemId.toUpperCase())) {
        score += 120;
        reasons.push('task-id-exact');
    }
    else if (isTaskIdSuffixMentioned(task.workItemId, intent)) {
        score += 110;
        reasons.push('task-id-suffix-match');
    }
    const pathFields = [
        task.taskPath,
        task.sourcePlanPath,
        ...task.nearbyPlanPaths
    ].filter((entry) => Boolean(entry));
    for (const planHint of intent.mentionedPlanPaths) {
        if (pathFields.some((field) => pathFieldMatches(field, planHint))) {
            score += 90;
            reasons.push('plan-path-match');
            break;
        }
    }
    for (const field of pathFields) {
        const normalizedField = normalizeSearchText(field);
        const stem = normalizeSearchText(path.basename(field).replace(/\.[^.]+$/, ''));
        if ((normalizedField && prompt.includes(normalizedField)) || (stem && prompt.includes(stem))) {
            score += 85;
            reasons.push('nearby-plan-name-match');
            break;
        }
    }
    for (const rootHint of intent.taskRootHints) {
        const normalizedHint = normalizeSearchText(rootHint);
        if (normalizedHint && (normalizeSearchText(task.workItemId).includes(normalizedHint)
            || pathFields.some((field) => normalizeSearchText(field).includes(normalizedHint)))) {
            score += 65;
            reasons.push('task-root-hint-match');
            break;
        }
    }
    if (intent.targetRepoHints.length > 0 && task.targetRepo) {
        const target = normalizeSearchText(task.targetRepo);
        if (intent.targetRepoHints.some((hint) => target.includes(normalizeSearchText(hint)))) {
            score += 35;
            reasons.push('target-repo-match');
        }
    }
    const normalizedTitle = normalizeSearchText(task.title);
    if (normalizedTitle && prompt.includes(normalizedTitle)) {
        score += 60;
        reasons.push('title-exact');
    }
    else {
        const overlap = countTokenOverlap(prompt, task.title);
        if (overlap >= 2) {
            score += Math.min(30, overlap * 8);
            reasons.push('title-token-overlap');
        }
    }
    if (/(?:\u4efb\u52d9\u5361|task\s*card)/i.test(intent.userPrompt ?? '') && /\.task\.md$/i.test(task.taskPath)) {
        score += 10;
        reasons.push('task-card-surface');
    }
    if (task.taskPath && isTaskPathUnderPreferredPlanningRoots(cwd, task.taskPath)) {
        score += 15;
        reasons.push('canonical-planning-root');
    }
    return {
        ...task,
        matchScore: score,
        matchReasons: reasons
    };
}
function applyOrdinalScope(tasks, intent) {
    const planScoped = tasks.filter((task) => (task.matchReasons ?? []).some((reason) => reason.includes('plan') || reason.includes('root') || reason.includes('task-id')));
    const source = planScoped.length > 0 ? planScoped : tasks;
    if (!intent.ordinalScope)
        return source;
    return [...source]
        .sort((left, right) => left.workItemId.localeCompare(right.workItemId))
        .slice(0, intent.ordinalScope.count);
}
function resolveRouteTargetRepo(tasks) {
    const targets = uniqueSorted(tasks.map((task) => task.targetRepo).filter((entry) => Boolean(entry)));
    return targets.length === 1 ? targets[0] : null;
}
function extractTaskRootHintsFromPrompt(prompt, mentionedTaskIds) {
    const directRoots = (prompt.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+\b/g) ?? [])
        .map((entry) => entry.toUpperCase())
        .filter((entry) => !/\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(entry));
    const derivedRoots = mentionedTaskIds
        .map((taskId) => taskId.match(/^(.*)-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/)?.[1] ?? null)
        .filter((entry) => Boolean(entry));
    return uniqueSorted([...directRoots, ...derivedRoots]);
}
function extractTaskIdReferencesFromPrompt(prompt) {
    const references = new Set();
    for (const match of prompt.matchAll(/\b(?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*\b/gi)) {
        const reference = match[0].toUpperCase();
        if (!isBacklogIdentifier(reference)) {
            references.add(reference);
        }
    }
    for (const match of prompt.matchAll(/\b((?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{2,})((?:\s*[\/,]\s*\d{2,})+)/gi)) {
        const prefix = match[1]?.toUpperCase();
        const firstNumber = match[2] ?? '';
        const suffix = match[3] ?? '';
        if (!prefix || !firstNumber)
            continue;
        for (const numberMatch of suffix.matchAll(/\d{2,}/g)) {
            const number = numberMatch[0]?.padStart(firstNumber.length, '0');
            if (number)
                references.add(`${prefix}-${number}`);
        }
    }
    return [...references].sort((left, right) => left.localeCompare(right));
}
function isBacklogIdentifier(reference) {
    return /^(?:ATM|PROJECT)-BUG-\d{4}-\d{2}-\d{2}-\d{3}$/i.test(reference.trim());
}
function expandTaskIdReferenceAliases(taskIdReference) {
    const normalized = taskIdReference
        .trim()
        .toUpperCase()
        .replace(/_/g, '-')
        .replace(/^[`"'(]+|[`"'):;,]+$/g, '');
    if (!normalized)
        return [];
    const aliases = new Set([normalized]);
    if (normalized.startsWith('TASK-')) {
        aliases.add(normalized.slice('TASK-'.length));
    }
    else if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(normalized)) {
        aliases.add(`TASK-${normalized}`);
    }
    return [...aliases];
}
function extractTaskFamilyRootHintsFromPrompt(prompt) {
    const ignoredCodes = new Set(['AI', 'API', 'ATM', 'CLI', 'CPU', 'CSS', 'GIT', 'HTML', 'HTTP', 'JSON', 'MD', 'NPM', 'SDK', 'TASK', 'TS', 'UI']);
    const output = new Set();
    for (const match of prompt.matchAll(/\b([A-Z][A-Z0-9]{1,9})\b/g)) {
        const code = match[1]?.toUpperCase();
        if (!code || ignoredCodes.has(code))
            continue;
        const index = match.index ?? 0;
        const context = prompt.slice(Math.max(0, index - 30), Math.min(prompt.length, index + code.length + 40));
        if (/(?:\u7cfb\u5217|\u4efb\u52d9\u5361|\u4efb\u52d9|\u5f8c\u9762|\u5f8c\u7e8c|\u5269\u9918|\u63a5\u4e0b\u4f86|\u9010\u4e00|task\s*cards?|tasks?|task\s*family|family|remaining|next|later)/i.test(context)) {
            output.add(`TASK-${code}`);
        }
    }
    return [...output].sort((left, right) => left.localeCompare(right));
}
function dedupeTasks(tasks) {
    const seen = new Set();
    const output = [];
    for (const task of tasks) {
        const key = task.workItemId;
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(task);
    }
    return output;
}
function finalizeImportedTaskSummary(task, cwd) {
    const partition = partitionTaskScope(task, cwd ? { cwd } : undefined);
    return {
        ...task,
        planningReadOnlyPaths: partition.planningContext.readOnlyPaths,
        planningMirrorPaths: partition.targetWork.planningMirrorPaths,
        targetAllowedFiles: partition.targetWork.allowedFiles
    };
}
function withMirrorSyncOnlyTarget(task) {
    return {
        ...task,
        targetAllowedFiles: []
    };
}
function withMirrorSyncOnlyTargetQueue(queue, taskId) {
    const rewrite = (task) => task.workItemId === taskId ? withMirrorSyncOnlyTarget(task) : task;
    return {
        ...queue,
        selectedTask: queue.selectedTask ? rewrite(queue.selectedTask) : queue.selectedTask,
        claimableTask: queue.claimableTask && queue.claimableTask.workItemId === taskId ? null : queue.claimableTask,
        tasks: queue.tasks.map(rewrite),
        promptScope: queue.promptScope
            ? {
                ...queue.promptScope,
                selectedTasks: queue.promptScope.selectedTasks.map(rewrite)
            }
            : queue.promptScope
    };
}
function extractDeclaredTaskPathsFromDocument(taskDocument) {
    const files = new Set();
    for (const key of ['scope', 'files', 'changedFiles', 'criticalChangedFiles', 'guardPaths', 'targetFiles', 'deliverables', 'artifacts']) {
        collectDeclaredTaskPathValues(taskDocument[key], files);
    }
    const source = taskDocument.source;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
        const sourceRecord = source;
        collectDeclaredTaskPathValues(sourceRecord.path, files);
        collectDeclaredTaskPathValues(sourceRecord.planPath, files);
    }
    for (const key of ['notes', 'summary', 'description', 'acceptance']) {
        collectDeclaredTaskPathValues(taskDocument[key], files);
    }
    return [...files].sort((left, right) => left.localeCompare(right));
}
function extractLinkedSourceTaskArtifactPaths(cwd, sourcePlanPath) {
    if (!sourcePlanPath)
        return [];
    const absolutePlanPath = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
    if (!existsSync(absolutePlanPath))
        return [];
    try {
        return extractTaskArtifactPathsFromMarkdown(cwd, readFileSync(absolutePlanPath, 'utf8'));
    }
    catch {
        return [];
    }
}
function collectDeclaredTaskPathValues(value, files) {
    if (typeof value === 'string') {
        const normalized = normalizeOptionalTaskPath(value);
        if (normalized && isTaskDirectionPathCandidate(normalized)) {
            files.add(normalized);
        }
        for (const candidate of extractPathLikeStringsFromText(value)) {
            files.add(candidate);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectDeclaredTaskPathValues(entry, files);
        }
    }
}
function extractTaskArtifactPathsFromMarkdown(cwd, text) {
    return uniqueSorted([
        ...extractPathLikeStringsFromText(text),
        ...resolveBareArtifactPathCandidates(cwd, extractBareArtifactFileNames(text)),
        ...extractCommandSurfacePathsFromMarkdown(text)
    ]);
}
function extractPathLikeStringsFromText(text) {
    const candidates = new Set();
    const matches = text.matchAll(/\b(?:\.atm|docs|atomic_workbench|packages|scripts|schemas|specs|templates|integrations|examples|tests|release|\.github|\.claude|\.cursor|\.gemini)(?:\/[A-Za-z0-9._-]+)+\b|\b(?:atm\.mjs|package(?:-lock)?\.json|tsconfig(?:\.[A-Za-z0-9._-]+)?\.json)\b/g);
    for (const match of matches) {
        const normalized = normalizeOptionalTaskPath(match[0]);
        if (normalized) {
            candidates.add(normalized);
        }
    }
    return [...candidates].sort((left, right) => left.localeCompare(right));
}
function extractBareArtifactFileNames(text) {
    const candidates = new Set();
    const matches = text.matchAll(/(?:^|[\s`"'([>-])([A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|jsonl|md|csv|tsv|txt|ya?ml|html|xml))(?:$|[\s`"')\]<,.;:])/gmi);
    for (const match of matches) {
        const fileName = match[1]?.trim();
        if (!fileName || fileName.includes('/') || fileName.includes('\\'))
            continue;
        if (fileName.length > 120)
            continue;
        candidates.add(fileName);
    }
    return [...candidates].sort((left, right) => left.localeCompare(right));
}
function resolveBareArtifactPathCandidates(cwd, fileNames) {
    if (fileNames.length === 0)
        return [];
    const output = new Set();
    const knownArtifactFiles = listKnownArtifactFiles(cwd);
    const artifactFilesByBasename = new Map();
    for (const artifactPath of knownArtifactFiles) {
        const key = path.basename(artifactPath).toLowerCase();
        const existing = artifactFilesByBasename.get(key) ?? [];
        existing.push(artifactPath);
        artifactFilesByBasename.set(key, existing);
    }
    for (const fileName of fileNames) {
        for (const candidateName of artifactFileNameVariants(fileName)) {
            for (const existingPath of artifactFilesByBasename.get(candidateName.toLowerCase()) ?? []) {
                output.add(existingPath);
            }
            const atomizationCoveragePath = resolveAtomizationCoverageArtifactPath(candidateName);
            if (atomizationCoveragePath) {
                output.add(atomizationCoveragePath);
            }
        }
    }
    return [...output].sort((left, right) => left.localeCompare(right));
}
function listKnownArtifactFiles(cwd) {
    const roots = [
        'atomic_workbench',
        'artifacts',
        'docs',
        'fixtures',
        'reports',
        'schemas'
    ];
    return uniqueSorted(roots.flatMap((root) => {
        const absoluteRoot = path.join(cwd, root);
        return listFilesRecursive(absoluteRoot, (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            return ['.json', '.jsonl', '.md', '.csv', '.tsv', '.txt', '.yaml', '.yml'].includes(ext);
        }).map((filePath) => path.relative(cwd, filePath).replace(/\\/g, '/'));
    }));
}
function artifactFileNameVariants(fileName) {
    const variants = new Set();
    const normalized = fileName.trim();
    if (!normalized)
        return [];
    variants.add(normalized);
    if (normalized.startsWith('atm-')) {
        variants.add(normalized.slice('atm-'.length));
    }
    return [...variants].sort((left, right) => left.localeCompare(right));
}
function resolveAtomizationCoverageArtifactPath(fileName) {
    const basename = path.basename(fileName);
    const atomizationCoverageArtifacts = new Set([
        'dogfood-score.json',
        'dogfood-score.md',
        'exclusion-inventory.json',
        'generated-fixture-boundaries.json',
        'path-to-atom-map.json',
        'manifest.json'
    ]);
    if (!atomizationCoverageArtifacts.has(basename))
        return null;
    if (basename === 'manifest.json') {
        return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/manifest.json';
    }
    return `atomic_workbench/atomization-coverage/${basename}`;
}
function extractCommandSurfacePathsFromMarkdown(text) {
    const paths = new Set();
    for (const match of text.matchAll(/\bnode\s+atm\.mjs\s+(guard|validate)\s+([a-z][a-z0-9-]*)\b/gi)) {
        const command = match[1]?.toLowerCase();
        const topic = match[2]?.toLowerCase();
        if (command === 'guard') {
            paths.add('packages/cli/src/commands/guard.ts');
        }
        if (command === 'validate') {
            paths.add('packages/cli/src/commands/validate.ts');
            addValidateTopicPaths(paths, topic);
        }
    }
    for (const match of text.matchAll(/\bnpm\s+run\s+validate:([a-z][a-z0-9-]*)\b/gi)) {
        addValidateTopicPaths(paths, match[1]?.toLowerCase());
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
}
function addValidateTopicPaths(paths, topic) {
    if (!topic)
        return;
    paths.add('package.json');
    paths.add(`scripts/validate-${topic}.ts`);
}
function resolveQuickfixScope(prompt) {
    return uniqueSorted([
        ...extractPathLikeStringsFromText(prompt),
        ...extractPathLikeStringsFromPrompt(prompt)
    ]);
}
/**
 * TASK-AAO-0011: claim/checkpoint must not hard-block on unrelated untracked
 * files (e.g. an unrelated svg in `docs/assets/`, a peer agent's WIP, screenshots,
 * tmp patches). Untracked candidates are demoted to a warning surfaced via
 * `ignoredUntrackedFiles`; the claim still produces a valid direction lock.
 *
 * The hard-block path remains for STAGED or MODIFIED-TRACKED files that look
 * like a deliverable for this task but live outside its allowedFiles — those
 * are the real "scope expansion required" cases that demand
 * `tasks scope --add` instead of editing runtime locks.
 */
function checkPendingTaskArtifactScopeExpansion(input) {
    const allowedFiles = buildAllowedFilesForTask(input.task);
    const { stagedOrTracked, untracked } = listPendingGitFilesByKind(input.cwd);
    const foreignDirectionLocks = readActiveTaskDirectionLocks(input.cwd)
        .filter((lock) => lock.taskId !== input.task.workItemId);
    const outsideScope = (entry) => !entry.startsWith('.atm/') && !isPathAllowedByScope(entry, allowedFiles);
    const isAdvisoryOutsideScopePath = (entry) => isAdvisoryPendingTaskArtifactPath(entry)
        || foreignDirectionLocks.some((lock) => isPathAllowedByScope(entry, lock.allowedFiles));
    const advisoryTrackedFiles = stagedOrTracked
        .filter(outsideScope)
        .filter(isAdvisoryOutsideScopePath);
    const stagedExpansion = stagedOrTracked
        .filter(outsideScope)
        .filter((entry) => !isAdvisoryOutsideScopePath(entry))
        .filter((entry) => looksLikeTaskArtifact(entry, input.task));
    const untrackedExpansion = untracked
        .filter(outsideScope)
        .filter((entry) => !isAdvisoryOutsideScopePath(entry))
        .filter((entry) => looksLikeTaskArtifact(entry, input.task));
    if (stagedExpansion.length > 0) {
        throw new CliError('ATM_TASK_SCOPE_EXPANSION_REQUIRED', `Task ${input.task.workItemId} has staged or modified deliverable-like files outside targetWork.allowedFiles; update the task scope/deliverables instead of editing runtime locks.`, {
            exitCode: 1,
            details: {
                taskId: input.task.workItemId,
                outsideAllowedFiles: stagedExpansion,
                advisoryTrackedFiles,
                ignoredUntrackedFiles: untrackedExpansion,
                allowedFiles,
                requiredAction: 'Add these real deliverables to the task card frontmatter scope/deliverables (then re-import) or run `node atm.mjs tasks scope --add <paths>`; do not edit runtime locks.',
                notAllowed: 'Do not edit .atm/runtime/locks/** or task direction lock JSON to bypass this scope mismatch.'
            }
        });
    }
    return {
        schemaId: 'atm.taskArtifactScopeDiagnostic.v1',
        ignoredUntrackedFiles: untrackedExpansion,
        advisoryTrackedFiles
    };
}
function isAdvisoryPendingTaskArtifactPath(filePath) {
    const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
    if (!normalized)
        return false;
    return normalized === 'atomic_workbench/atomization-coverage/path-to-atom-map.json'
        || normalized.startsWith('release/atm-root-drop/')
        || normalized.startsWith('release/atm-onefile/');
}
function listPendingGitFilesByKind(cwd) {
    const collect = (args) => {
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if (result.status !== 0)
            return [];
        return result.stdout
            .split(/\r?\n/)
            .map((entry) => normalizeOptionalTaskPath(entry))
            .filter((entry) => Boolean(entry));
    };
    const staged = [
        ...collect(['diff', '--name-only', '--cached']),
        ...collect(['diff', '--name-only'])
    ];
    const untracked = collect(['ls-files', '--others', '--exclude-standard']);
    return {
        stagedOrTracked: uniqueSorted(staged),
        untracked: uniqueSorted(untracked)
    };
}
function listPendingGitFiles(cwd) {
    const { stagedOrTracked, untracked } = listPendingGitFilesByKind(cwd);
    return uniqueSorted([...stagedOrTracked, ...untracked]);
}
function listIgnoredArtifactCandidates(cwd) {
    const artifactRoots = ['artifacts', 'reports', 'atomic_workbench/evidence', 'atomic_workbench/reports'];
    const result = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--', ...artifactRoots], {
        cwd,
        encoding: 'utf8'
    });
    if (result.status !== 0)
        return [];
    return uniqueSorted(result.stdout
        .split(/\r?\n/)
        .map((entry) => normalizeOptionalTaskPath(entry))
        .filter((entry) => Boolean(entry)));
}
function isPromptGeneratedArtifactPath(filePath) {
    const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
    if (!normalized)
        return false;
    return normalized.startsWith('artifacts/')
        || normalized.startsWith('reports/')
        || normalized.startsWith('atomic_workbench/evidence/')
        || normalized.startsWith('atomic_workbench/reports/');
}
function buildPromptWorktreeHint(cwd, prompt) {
    const { stagedOrTracked, untracked } = listPendingGitFilesByKind(cwd);
    const ignoredArtifacts = listIgnoredArtifactCandidates(cwd);
    const promptPathHints = extractPathLikeStringsFromText(prompt);
    const promptMatchedFiles = new Set();
    const atmManagedFiles = new Set();
    const generatedArtifactFiles = new Set();
    const releaseMirrorFiles = new Set();
    const unrelatedTrackedFiles = new Set();
    const unrelatedUntrackedFiles = new Set();
    const matchesPromptHint = (filePath) => promptPathHints.some((hint) => filePath === hint
        || filePath.startsWith(`${hint}/`)
        || hint.startsWith(`${filePath}/`));
    const classify = (filePath, tracked) => {
        if (matchesPromptHint(filePath)) {
            promptMatchedFiles.add(filePath);
            return;
        }
        if (filePath.startsWith('.atm/')) {
            atmManagedFiles.add(filePath);
            return;
        }
        if (filePath.startsWith('release/')) {
            releaseMirrorFiles.add(filePath);
            return;
        }
        if (isPromptGeneratedArtifactPath(filePath)) {
            generatedArtifactFiles.add(filePath);
            return;
        }
        (tracked ? unrelatedTrackedFiles : unrelatedUntrackedFiles).add(filePath);
    };
    stagedOrTracked.forEach((filePath) => classify(filePath, true));
    untracked.forEach((filePath) => classify(filePath, false));
    return {
        schemaId: 'atm.promptWorktreeHint.v1',
        promptPathHints,
        promptMatchedFiles: uniqueSorted([...promptMatchedFiles]),
        atmManagedFiles: uniqueSorted([...atmManagedFiles]),
        generatedArtifactFiles: uniqueSorted([...generatedArtifactFiles]),
        releaseMirrorFiles: uniqueSorted([...releaseMirrorFiles]),
        unrelatedTrackedFiles: uniqueSorted([...unrelatedTrackedFiles]),
        unrelatedUntrackedFiles: uniqueSorted([...unrelatedUntrackedFiles]),
        ignoredArtifactCount: ignoredArtifacts.length,
        note: 'No task scope is active yet. Prompt-matched files are only hints; every other dirty bucket stays advisory until ATM selects a governed route or task.'
    };
}
function buildIgnoredArtifactForceAddHints(cwd) {
    return listIgnoredArtifactCandidates(cwd).map((filePath) => ({
        path: filePath,
        requiredCommand: `git add -f -- ${quoteCliValue(filePath)}`,
        reason: 'This path is currently hidden by .gitignore; use force-add only if it is the intended deliverable for the selected route.'
    }));
}
function buildNonPlaybookRouteHints(cwd, prompt) {
    return {
        playbookState: 'absent',
        structuredOutputHint: {
            schemaId: 'atm.nextStructuredOutputHint.v1',
            hasPlaybook: false,
            treatCliJsonAs: 'structured-tool-guidance',
            followNextActionField: 'evidence.nextAction.command'
        },
        ignoredArtifactForceAddHints: buildIgnoredArtifactForceAddHints(cwd),
        promptWorktreeHint: buildPromptWorktreeHint(cwd, prompt)
    };
}
function listTaskCardFiles(cwd) {
    const output = new Set();
    for (const filePath of listRootLevelTaskCardFiles(cwd)) {
        output.add(filePath);
    }
    for (const root of listTaskCardDiscoveryRoots(cwd)) {
        for (const filePath of listFilesRecursive(root, (candidate) => candidate.endsWith('.task.md'))) {
            output.add(filePath);
        }
    }
    return uniqueSorted(Array.from(output));
}
function listRootLevelTaskCardFiles(cwd) {
    return safeReadDir(cwd)
        .filter((entry) => entry.isFile() && entry.name.endsWith('.task.md'))
        .map((entry) => path.join(cwd, entry.name));
}
function listTaskCardDiscoveryRoots(cwd) {
    const relativeRoots = [
        'docs',
        'atomic_workbench',
        'specs',
        'schemas',
        'templates',
        'integrations',
        'examples',
        'tests',
        'packages',
        'scripts',
        '.agents',
        '.github',
        '.claude',
        '.cursor',
        '.gemini'
    ];
    return uniqueSorted(relativeRoots
        .map((entry) => path.join(cwd, entry))
        .filter((entry) => existsSync(entry)));
}
function listPromptScopedExternalTaskCardFiles(cwd, intent, planningRoots = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: readConfiguredPlanningRoots(cwd)
}).roots) {
    if (!intent?.userPrompt || !intent.taskScopeMentioned)
        return [];
    const output = new Set();
    for (const root of planningRoots) {
        const markdownFiles = listFilesRecursive(root, (filePath) => filePath.endsWith('.md') && !filePath.endsWith('.task.md'));
        for (const planPath of markdownFiles) {
            if (!planFileMatchesPrompt(cwd, planPath, intent))
                continue;
            const taskDir = path.join(path.dirname(planPath), 'tasks');
            for (const taskPath of listFilesRecursive(taskDir, (filePath) => filePath.endsWith('.task.md'))) {
                output.add(taskPath);
            }
        }
        if (intent.mentionedTaskIds.length > 0 || intent.taskRootHints.length > 0) {
            for (const taskPath of listFilesRecursive(root, (filePath) => filePath.endsWith('.task.md'))) {
                if (taskCardPathMatchesIntent(taskPath, intent)) {
                    output.add(taskPath);
                }
            }
        }
    }
    return uniqueSorted(Array.from(output));
}
function isTaskPathUnderPreferredPlanningRoots(cwd, taskPath) {
    const absoluteTaskPath = path.resolve(cwd, taskPath);
    const resolution = resolveCandidatePlanningRoots(cwd, {
        configuredRoots: readConfiguredPlanningRoots(cwd)
    });
    return resolution.roots.some((root) => absoluteTaskPath.startsWith(`${root}${path.sep}`));
}
function planFileMatchesPrompt(cwd, planPath, intent) {
    const prompt = normalizeSearchText(intent.userPrompt ?? '');
    const relativePlanPath = path.relative(cwd, planPath).replace(/\\/g, '/');
    if (intent.mentionedPlanPaths.some((hint) => pathFieldMatches(relativePlanPath, hint) || pathFieldMatches(planPath, hint))) {
        return true;
    }
    const stem = normalizeSearchText(path.basename(planPath).replace(/\.[^.]+$/, ''));
    if (stem.length >= 8 && prompt.includes(stem))
        return true;
    const title = readMarkdownTitle(planPath);
    const normalizedTitle = title ? normalizeSearchText(title) : '';
    if (normalizedTitle.length >= 8 && prompt.includes(normalizedTitle))
        return true;
    return false;
}
function readMarkdownTitle(filePath) {
    try {
        const head = readFileSync(filePath, 'utf8').split(/\r?\n/, 40);
        for (const line of head) {
            const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
            if (match?.[1]?.trim())
                return match[1].trim();
        }
    }
    catch {
        return null;
    }
    return null;
}
function taskCardPathMatchesIntent(taskPath, intent) {
    const normalizedTaskPath = normalizeSearchText(taskPath);
    const basename = path.basename(taskPath).replace(/\.task\.md$/i, '').toUpperCase();
    if (intent.mentionedTaskIds.some((taskId) => basename === taskId || normalizedTaskPath.includes(normalizeSearchText(taskId)))) {
        return true;
    }
    return intent.taskRootHints.some((hint) => {
        const normalizedHint = normalizeSearchText(hint);
        return normalizedHint.length > 0 && normalizedTaskPath.includes(normalizedHint);
    });
}
function listFilesRecursive(directoryPath, predicate) {
    if (!existsSync(directoryPath))
        return [];
    const stats = safeStat(directoryPath);
    if (!stats)
        return [];
    if (stats.isFile())
        return predicate(directoryPath) ? [directoryPath] : [];
    const output = [];
    for (const entry of safeReadDir(directoryPath)) {
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory() && shouldSkipRecursiveDiscoveryDirectory(absolutePath))
            continue;
        if (entry.isDirectory()) {
            output.push(...listFilesRecursive(absolutePath, predicate));
        }
        else if (entry.isFile() && predicate(absolutePath)) {
            output.push(absolutePath);
        }
    }
    return output;
}
function findNearbyPlanPaths(cwd, taskPath) {
    const taskDir = path.dirname(taskPath);
    const parent = path.basename(taskDir).toLowerCase() === 'tasks' ? path.dirname(taskDir) : taskDir;
    if (!existsSync(parent))
        return [];
    return safeReadDir(parent)
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.task.md'))
        .map((entry) => path.relative(cwd, path.join(parent, entry.name)).replace(/\\/g, '/'));
}
function safeReadDir(directoryPath) {
    try {
        return readdirSync(directoryPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
function safeStat(filePath) {
    try {
        return statSync(filePath);
    }
    catch {
        return null;
    }
}
function shouldSkipRecursiveDiscoveryDirectory(directoryPath) {
    const normalized = directoryPath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const ignoredSegmentNames = new Set([
        '.git',
        'node_modules',
        'dist',
        'build',
        'release',
        '.atm-temp',
        'scratch',
        'tmp',
        'temp',
        'library',
        'coverage',
        '.next',
        '.turbo'
    ]);
    const basename = segments[segments.length - 1] ?? '';
    if (ignoredSegmentNames.has(basename))
        return true;
    return segments.some((segment, index) => segment === 'local' && (segments[index + 1] === 'tmp' || segments[index + 1] === 'temp'));
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function detectRequestedTaskAction(prompt) {
    if (/\u91cd\u505a|redo/i.test(prompt))
        return 'redo';
    if (/\u91cd\u65b0\u6253\u958b|reopen/i.test(prompt))
        return 'reopen';
    if (/\u95dc\u9589|\u5b8c\u6210|close|done/i.test(prompt))
        return 'close';
    if (/audit|\u7a3d\u6838|\u6aa2\u8a0e/i.test(prompt))
        return 'audit';
    if (/cleanup|\u6e05\u7406/i.test(prompt))
        return 'cleanup';
    if (/\u5206\u6790|analy[sz]e/i.test(prompt))
        return 'analyze';
    if (/implement|\u5be6\u4f5c|\u958b\u767c/i.test(prompt))
        return 'implement';
    return null;
}
function extractPromptPathHints(prompt) {
    const matches = prompt.match(/(?:[A-Za-z]:)?(?:[A-Za-z0-9_%\u4e00-\u9fff() -]+[\\/])+[A-Za-z0-9_%\u4e00-\u9fff(). -]+(?:\.md)?|[A-Za-z0-9_%\u4e00-\u9fff() -]+\.md/gi) ?? [];
    return uniqueSorted(matches
        .map((entry) => entry.trim().replace(/^["'`]+|["'`]+$/g, ''))
        .filter((entry) => entry.length > 2)
        .filter((entry) => /[./\\]|\.md$/i.test(entry))
        .filter(isLikelyPromptPathHint));
}
function enrichWithLegacyPlan(cwd, base, plan, sessionId) {
    const safeSegments = plan.segments.filter((s) => plan.safeFirstAtoms.includes(s.symbolName));
    const preferredSegment = safeSegments.find((s) => s.recommendedBehavior === 'split')
        ?? safeSegments.find((s) => s.recommendedBehavior === 'infect')
        ?? safeSegments.find((s) => s.recommendedBehavior === 'atomize')
        ?? null;
    const blockedSegments = plan.trunkFunctions;
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
function findMatchingGuidedLegacyProposal(cwd, criteria) {
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
function isMatchingGuidedLegacyProposal(entry, criteria) {
    return entry.proposal.guidanceSession === criteria.guidanceSession
        && entry.proposal.legacyTarget === criteria.legacyTarget
        && entry.proposal.behaviorId === criteria.behaviorId;
}
function findGuidedLegacyActualPatchEvidence(cwd, proposalId) {
    const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
    if (!existsSync(reportsRoot)) {
        return null;
    }
    const matches = readdirSync(reportsRoot)
        .filter((entry) => entry.startsWith('actual-patch-evidence.') && entry.endsWith('.json'))
        .flatMap((entry) => {
        const reportPath = path.join(reportsRoot, entry);
        try {
            const parsed = parseJsonText(readFileSync(reportPath, 'utf8'));
            if (parsed['proposalId'] !== proposalId) {
                return [];
            }
            const smokeEvidence = Array.isArray(parsed['smokeEvidence']) ? parsed['smokeEvidence'] : [];
            const rollbackReadyProof = parsed['rollbackReadyProof'] && typeof parsed['rollbackReadyProof'] === 'object'
                ? parsed['rollbackReadyProof']
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
        }
        catch {
            return [];
        }
    })
        .sort((left, right) => compareIsoDesc(left.generatedAt, right.generatedAt));
    return matches[0] ?? null;
}
function reconcileProposalMissingEvidence(missingEvidence, behavior, proposalStatus) {
    const filtered = missingEvidence.filter((entry) => entry !== `${behavior} dry-run proposal`);
    if (proposalStatus === 'approved' || proposalStatus === 'rejected') {
        return filtered.filter((entry) => entry !== 'human review before apply');
    }
    return filtered;
}
function mapStatusToSlashCommandId(status) {
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
function buildAgentPackHint(status, command, reason) {
    return {
        slashCommandId: mapStatusToSlashCommandId(status),
        route: status,
        command: command ?? '',
        reason: reason ?? ''
    };
}
function buildTaskflowCloseOperatorCommands(taskId, actor) {
    const id = taskId || '<task-id>';
    return {
        preClose: `node atm.mjs taskflow pre-close --task ${id} --actor ${actor} --json`,
        dryRun: `node atm.mjs taskflow close --task ${id} --actor ${actor} --json`,
        write: `node atm.mjs taskflow close --task ${id} --actor ${actor} --write --json`
    };
}
function buildTaskDeliveryPrinciple(input) {
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
function buildMirrorSyncNextAction(input) {
    const sourcePath = input.task.sourcePlanPath ?? '<source-task-card-path>';
    const hasActiveClaim = typeof input.task.activeClaimActorId === 'string' && input.task.activeClaimActorId.length > 0;
    const importCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --write --force --json`;
    const dryRunCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --dry-run --json`;
    if (hasActiveClaim) {
        return {
            status: 'task-mirror-sync-blocked',
            command: dryRunCommand,
            reason: `Task ${input.task.workItemId} has an active claim by actor ${input.task.activeClaimActorId}. Mirror-sync write is blocked to prevent claim/lock overwrite.`,
            recommendedChannel: 'mirror-sync',
            riskLevel: 'high',
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
        recommendedChannel: 'mirror-sync',
        riskLevel: 'low',
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
function buildActiveTaskDivergenceResult(input) {
    const divergence = detectActiveTaskDivergence(input.cwd, input.taskIntent, input.importedTaskQueue);
    if (!divergence)
        return null;
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
        ]
    };
    return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('error', 'ATM_NEXT_ACTIVE_TASK_DIVERGENCE_BLOCKED', `Prompt diverges from active task ${activeTaskId}; ATM refused to auto-attach it.`, {
            activeTaskId,
            reasons: divergence.reasons,
            promptPaths: divergence.promptPaths,
            mentionedOtherTaskIds: divergence.mentionedOtherTaskIds,
            remediation: nextAction.decisionOptions
        })),
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
function detectActiveTaskDivergence(cwd, taskIntent, importedTaskQueue) {
    const prompt = taskIntent?.userPrompt?.trim() ?? '';
    if (!prompt)
        return null;
    if (importedTaskQueue.promptScope && importedTaskQueue.promptScope.status !== 'not-found')
        return null;
    const activeTasks = readActiveClaimedTasks(cwd);
    if (activeTasks.length === 0)
        return null;
    const activeTaskIds = activeTasks.map((task) => task.workItemId.toUpperCase());
    const mentionedTaskIds = uniqueSorted([
        ...(taskIntent?.mentionedTaskIds ?? []),
        ...(taskIntent?.explicitTaskIds ?? [])
    ].map((taskId) => taskId.toUpperCase()));
    if (mentionedTaskIds.some((taskId) => activeTaskIds.includes(taskId)))
        return null;
    const reasons = [];
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
function readActiveClaimedTasks(cwd) {
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(taskStorePath))
        return [];
    return readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        const filePath = path.join(taskStorePath, entry);
        try {
            const parsed = parseJsonText(readFileSync(filePath, 'utf8'));
            const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
            if (!workItemId || normalizeTaskRouteStatus(normalizeOptionalString(parsed.status) ?? '') !== 'running')
                return [];
            const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
                ? parsed.claim
                : {};
            if (claimRecord.state !== 'active')
                return [];
            const source = parsed.source && typeof parsed.source === 'object' && !Array.isArray(parsed.source)
                ? parsed.source
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
        }
        catch {
            return [];
        }
    });
}
export function buildActiveWorkSummary(cwd, currentActorId, ownFiles = []) {
    const now = Date.now();
    const currentActor = currentActorId?.trim() || null;
    const normalizedOwnFiles = uniqueSorted(ownFiles.map(normalizeWorkPath).filter(Boolean));
    const activeClaims = readActiveClaimRecords(cwd, now);
    const activeLocks = readActiveLockRecords(cwd, now);
    const freshReservations = readFreshTaskReservations(cwd, now);
    const stagedFiles = readStagedFiles(cwd);
    const actorMap = new Map();
    for (const claim of activeClaims) {
        const bucket = actorMap.get(claim.actorId) ?? { taskIds: new Set(), files: new Set() };
        bucket.taskIds.add(claim.taskId);
        for (const file of claim.files)
            bucket.files.add(file);
        actorMap.set(claim.actorId, bucket);
    }
    for (const lock of activeLocks) {
        const bucket = actorMap.get(lock.actorId) ?? { taskIds: new Set(), files: new Set() };
        bucket.taskIds.add(lock.workItemId);
        for (const file of lock.files)
            bucket.files.add(file);
        actorMap.set(lock.actorId, bucket);
    }
    for (const reservation of freshReservations) {
        const bucket = actorMap.get(reservation.actorId) ?? { taskIds: new Set(), files: new Set() };
        bucket.taskIds.add(reservation.taskId);
        for (const file of reservation.files)
            bucket.files.add(file);
        actorMap.set(reservation.actorId, bucket);
    }
    const activeActors = [...actorMap.entries()]
        .map(([actorId, value]) => ({
        actorId,
        taskIds: [...value.taskIds].sort((left, right) => left.localeCompare(right)),
        fileCount: value.files.size
    }))
        .sort((left, right) => left.actorId.localeCompare(right.actorId));
    const foreignActors = activeActors.filter((actor) => !currentActor || actor.actorId !== currentActor);
    const hasForeignActiveWork = foreignActors.length > 0 || stagedFiles.length > 0;
    const teamLevelRecommendation = buildTeamLevelRecommendation({
        ownFiles: normalizedOwnFiles,
        activeClaims,
        activeLocks,
        freshReservations,
        stagedFiles,
        foreignActorIds: foreignActors.map((actor) => actor.actorId)
    });
    const reasonParts = [
        ...(foreignActors.length > 0 ? [`${foreignActors.length} other active actor(s): ${foreignActors.map((entry) => entry.actorId).join(', ')}`] : []),
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
function buildTeamLevelRecommendation(input) {
    const ownSet = new Set(input.ownFiles);
    const foreignFiles = uniqueSorted([
        ...input.activeClaims.filter((claim) => input.foreignActorIds.includes(claim.actorId)).flatMap((claim) => claim.files),
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
    const freshForeignReservationCount = input.freshReservations.filter((reservation) => input.foreignActorIds.includes(reservation.actorId)).length;
    const sharedIndexActive = input.stagedFiles.length > 0;
    const overlapCount = uniqueSorted([...overlappingFiles, ...stagedOverlap]).length;
    const frameworkFoundationRisk = input.ownFiles.some(isFrameworkFoundationPath);
    if (frameworkFoundationRisk && (foreignActorCount > 0 || sharedIndexActive || overlapCount > 0)) {
        return {
            level: 'L5',
            reason: 'Framework foundation files are in scope while other active work or shared-index state exists; use the full Team Agent Broker lane.',
            ownFiles: input.ownFiles,
            overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
            foreignActors: uniqueSorted(input.foreignActorIds)
        };
    }
    if (frameworkFoundationRisk) {
        return {
            level: 'L4',
            reason: 'Framework foundation files are in scope; use elevated coordination even without visible overlap.',
            ownFiles: input.ownFiles,
            overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
            foreignActors: uniqueSorted(input.foreignActorIds)
        };
    }
    if (foreignActorCount >= 3 || (overlapCount > 0 && sharedIndexActive && foreignActorCount >= 2)) {
        return {
            level: 'L5',
            reason: 'Multiple active actors plus overlapping files or shared staged index require full Broker coordination with review and validation roles.',
            ownFiles: input.ownFiles,
            overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
            foreignActors: uniqueSorted(input.foreignActorIds)
        };
    }
    if (overlapCount > 1 || (overlapCount > 0 && sharedIndexActive)) {
        return {
            level: 'L4',
            reason: 'Active foreign work overlaps this scope across multiple files or the shared index, so add a coordinator plus review/validation coverage.',
            ownFiles: input.ownFiles,
            overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
            foreignActors: uniqueSorted(input.foreignActorIds)
        };
    }
    if (overlapCount === 1 || sharedIndexActive) {
        return {
            level: 'L3',
            reason: 'A concrete same-file or shared-index risk is present; use Broker arbitration with an implementer and validator lane.',
            ownFiles: input.ownFiles,
            overlappingFiles: uniqueSorted([...overlappingFiles, ...stagedOverlap]),
            foreignActors: uniqueSorted(input.foreignActorIds)
        };
    }
    if (freshForeignReservationCount > 0) {
        return {
            level: 'L3',
            reason: 'Fresh foreign-created task reservations are visible; use Broker arbitration before claiming another captain\'s newly opened work.',
            ownFiles: input.ownFiles,
            overlappingFiles: [],
            foreignActors: uniqueSorted(input.foreignActorIds)
        };
    }
    if (foreignActorCount > 0) {
        return {
            level: 'L2',
            reason: 'Other active actors exist but no file overlap is visible for this scope; keep coordination light and monitor Broker status.',
            ownFiles: input.ownFiles,
            overlappingFiles: [],
            foreignActors: uniqueSorted(input.foreignActorIds)
        };
    }
    return {
        level: 'L1',
        reason: 'No foreign active work or shared-index risk is visible; a single coordinator/implementer path is enough.',
        ownFiles: input.ownFiles,
        overlappingFiles: [],
        foreignActors: []
    };
}
function isFrameworkFoundationPath(filePath) {
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
function inspectFreshTaskReservationForTask(cwd, task, currentActorId, now) {
    const reservations = readFreshTaskReservations(cwd, now);
    const currentActor = currentActorId?.trim() || null;
    return reservations.find((reservation) => reservation.taskId === task.workItemId
        && (!currentActor || reservation.actorId !== currentActor)) ?? null;
}
function readFreshTaskReservations(cwd, now) {
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(taskStorePath))
        return [];
    return readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        const filePath = path.join(taskStorePath, entry);
        try {
            const parsed = parseJsonText(readFileSync(filePath, 'utf8'));
            const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
            if (!workItemId)
                return [];
            if (!isTaskFreshReservationCandidate(parsed))
                return [];
            const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
                ? parsed.claim
                : {};
            if (claimRecord.state === 'active')
                return [];
            const source = parsed.source && typeof parsed.source === 'object' && !Array.isArray(parsed.source)
                ? parsed.source
                : {};
            const sourcePlanPath = normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path);
            const sourceOwner = readPlanningCardOwner(cwd, sourcePlanPath);
            const actorId = sourceOwner
                ?? normalizeOptionalString(parsed.owner ?? parsed.ownerActorId ?? parsed.createdByActor ?? parsed.createdBy ?? parsed.importedByActor ?? parsed.importedBy ?? source.owner ?? source.actorId);
            if (!actorId)
                return [];
            const createdAt = normalizeOptionalString(parsed.createdAt ?? parsed.created_at ?? source.createdAt ?? source.created_at);
            const importedAt = normalizeOptionalString(parsed.importedAt ?? parsed.imported_at ?? source.importedAt ?? source.imported_at);
            const referenceAt = parseIsoMillis(importedAt) ?? parseIsoMillis(createdAt) ?? parseIsoMillis(normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at));
            if (referenceAt === null)
                return [];
            const ageSeconds = Math.max(0, Math.floor((now - referenceAt) / 1000));
            if (ageSeconds > NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS)
                return [];
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
        }
        catch {
            return [];
        }
    });
}
function isTaskFreshReservationCandidate(parsed) {
    const status = normalizeTaskRouteStatus(normalizeOptionalString(parsed.status) ?? 'planned');
    return status === 'planned' || status === 'ready' || status === 'open' || status === 'reserved';
}
function readPlanningCardOwner(cwd, sourcePlanPath) {
    if (!sourcePlanPath)
        return null;
    const candidate = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
    if (!existsSync(candidate))
        return null;
    try {
        const rawText = readFileSync(candidate, 'utf8');
        const frontmatter = parseMarkdownFrontmatter(rawText);
        const owner = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
            ? normalizeOptionalString(frontmatter.owner ?? frontmatter.actor ?? frontmatter.captain)
            : null;
        return owner ?? readFrontmatterScalar(rawText, 'owner') ?? readFrontmatterScalar(rawText, 'actor') ?? readFrontmatterScalar(rawText, 'captain');
    }
    catch {
        return null;
    }
}
function readFrontmatterScalar(rawText, key) {
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(rawText);
    if (!match)
        return null;
    const line = match[1].split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}:`));
    if (!line)
        return null;
    return normalizeOptionalString(line.slice(line.indexOf(':') + 1).replace(/^['"]|['"]$/g, ''));
}
function parseIsoMillis(value) {
    if (!value)
        return null;
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
}
function readActiveClaimRecords(cwd, now) {
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(taskStorePath))
        return [];
    return readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        const filePath = path.join(taskStorePath, entry);
        try {
            const parsed = parseJsonText(readFileSync(filePath, 'utf8'));
            const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
            if (!workItemId)
                return [];
            const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
                ? parsed.claim
                : {};
            if (claimRecord.state !== 'active')
                return [];
            const actorId = normalizeOptionalString(claimRecord.actorId);
            if (!actorId)
                return [];
            const heartbeatAt = normalizeOptionalString(claimRecord.heartbeatAt);
            const ttlSeconds = normalizeOptionalNumber(claimRecord.ttlSeconds);
            return [{
                    taskId: workItemId,
                    title: normalizeOptionalString(parsed.title) ?? workItemId,
                    actorId,
                    intent: normalizeOptionalString(claimRecord.intent) ?? 'write',
                    claimedAt: normalizeOptionalString(claimRecord.claimedAt),
                    heartbeatAt,
                    heartbeatAgeSeconds: heartbeatAt ? Math.max(0, Math.floor((now - Date.parse(heartbeatAt)) / 1000)) : null,
                    ttlSeconds,
                    leaseFresh: heartbeatAt && ttlSeconds !== null ? now - Date.parse(heartbeatAt) <= ttlSeconds * 1000 : null,
                    files: uniqueSorted(readStringArray(claimRecord.files).map(normalizeWorkPath))
                }];
        }
        catch {
            return [];
        }
    });
}
function readActiveLockRecords(cwd, now) {
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    if (!existsSync(lockRoot))
        return [];
    return readdirSync(lockRoot)
        .filter((entry) => entry.endsWith('.lock.json'))
        .flatMap((entry) => {
        try {
            const parsed = parseJsonText(readFileSync(path.join(lockRoot, entry), 'utf8'));
            if (normalizeOptionalString(parsed.status) === 'released')
                return [];
            const workItemId = normalizeOptionalString(parsed.workItemId);
            const actorId = normalizeOptionalString(parsed.actorId ?? parsed.lockedBy);
            if (!workItemId || !actorId)
                return [];
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
        }
        catch {
            return [];
        }
    });
}
function normalizeOptionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function normalizeWorkPath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function readStagedFiles(cwd) {
    const result = spawnSync('git', ['diff', '--name-only', '--cached'], {
        cwd,
        encoding: 'utf8',
        windowsHide: true
    });
    if (result.status !== 0)
        return [];
    return uniqueSorted(String(result.stdout ?? '')
        .split(/\r?\n/)
        .map(normalizeWorkPath)
        .filter(Boolean));
}
function mentionsNotCurrentTask(prompt) {
    const normalized = normalizeSearchText(prompt);
    return /\bnot\s+(?:the\s+)?current\s+task\b|\bnot\s+(?:this\s+)?active\s+task\b/.test(normalized)
        || /不是(?:目前|當前|現在)?(?:這張|此)?(?:任務|active task|current task)/.test(prompt)
        || /不要(?:接|掛|綁|套|附著|attach)(?:到|在)?(?:目前|當前|現在)?(?:這張|此)?(?:任務|active task|current task)/i.test(prompt);
}
function buildChannelPlaybook(input) {
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
function embedTeamRecommendation(nextAction, input) {
    const teamRecommendation = buildTeamRecommendation(input);
    if (!teamRecommendation) {
        return nextAction;
    }
    const playbook = nextAction.playbook && typeof nextAction.playbook === 'object' && !Array.isArray(nextAction.playbook)
        ? { ...nextAction.playbook, teamRecommendation }
        : nextAction.playbook;
    return {
        ...nextAction,
        teamRecommendation,
        playbook
    };
}
function isTaskIdMentioned(workItemId, intent) {
    if (!intent || intent.mentionedTaskIds.length === 0)
        return false;
    return intent.mentionedTaskIds.includes(workItemId.trim().toUpperCase())
        || isTaskIdSuffixMentioned(workItemId, intent);
}
function isTaskIdSuffixMentioned(workItemId, intent) {
    if (!intent || intent.mentionedTaskIds.length === 0)
        return false;
    const normalizedWorkItemId = workItemId.trim().toUpperCase();
    return intent.mentionedTaskIds.some((taskId) => {
        const normalizedTaskId = taskId.trim().toUpperCase();
        return normalizedTaskId.length > 0
            && normalizedTaskId !== normalizedWorkItemId
            && normalizedWorkItemId.endsWith(`-${normalizedTaskId}`);
    });
}
function extractJsonTaskMetadata(rawText) {
    const pick = (key) => {
        const match = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'm').exec(rawText);
        if (!match?.[1])
            return null;
        try {
            return JSON.parse(`"${match[1]}"`);
        }
        catch {
            return match[1];
        }
    };
    const sourcePlanPath = /"source"\s*:\s*\{[\s\S]*?"planPath"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/m.exec(rawText)?.[1] ?? null;
    return {
        schemaVersion: pick('schemaVersion'),
        workItemId: pick('workItemId') ?? pick('id') ?? '',
        title: pick('title'),
        status: pick('status'),
        sourcePlanPath: sourcePlanPath ? JSON.parse(`"${sourcePlanPath}"`) : (pick('planPath') ?? pick('plan_path')),
        hasSource: /"source"\s*:/.test(rawText)
    };
}
function buildMinimalImportedJsonTaskSummary(input) {
    return {
        workItemId: input.workItemId,
        title: input.title,
        status: input.status,
        closedAt: null,
        closedByActor: null,
        closurePacket: null,
        lastTransitionId: null,
        lastTransitionAt: null,
        milestone: null,
        dependencies: [],
        taskPath: path.relative(input.cwd, input.filePath).replace(/\\/g, '/'),
        format: 'json',
        sourcePlanPath: input.sourcePlanPath,
        nearbyPlanPaths: [],
        scopePaths: [],
        outOfScope: [],
        targetRepo: null,
        planningRepo: null,
        allowPlanningMirror: false,
        closureAuthority: null,
        activeClaimActorId: null,
        activeClaimIntent: null,
        planningReadOnlyPaths: [],
        planningMirrorPaths: [],
        targetAllowedFiles: []
    };
}
function buildNextMessages(nextAction, userNotice, integrationBootstrap, runtimeAdapterReadiness, routeMessage) {
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
        messages.push(message('warning', 'ATM_NEXT_INTEGRATION_INSTALL_RECOMMENDED', integrationInstallHint.text, integrationInstallHint.data));
    }
    if (runtimeAdapterReadiness.needsRuntimeAdapterHint) {
        messages.push(message('warning', 'ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED', runtimeAdapterReadiness.suggestedAction ?? 'Python entrypoints were detected. Select a Python runtime adapter/plugin before expecting ATM atom birth or apply routes to mutate Python surfaces.', {
            detectedLanguages: runtimeAdapterReadiness.detectedLanguages,
            bundledLanguageAdapters: runtimeAdapterReadiness.bundledLanguageAdapters,
            bundledProjectAdapters: runtimeAdapterReadiness.bundledProjectAdapters,
            pythonLanguageAdapterAvailable: runtimeAdapterReadiness.pythonLanguageAdapterAvailable,
            candidateRankingAllowed: runtimeAdapterReadiness.candidateRankingAllowed,
            atomBirthApplyDeferred: runtimeAdapterReadiness.atomBirthApplyDeferred,
            missingCapability: runtimeAdapterReadiness.missingCapability
        }));
    }
    if (nextAction.playbook) {
        messages.push(message('warning', 'ATM_CHANNEL_PLAYBOOK_REQUIRED', `Follow the ${nextAction.playbook.channel} playbook exactly before editing, closing, or committing.`, nextAction.playbook));
        if (nextAction.playbook.channel === 'normal') {
            messages.push(message('info', 'ATM_TASK_CLOSE_REMINDER', 'Normal task cards are not finished at validators or evidence: after deliverables exist, always run tasks close before committing.', {
                schemaId: 'atm.taskCloseReminder.v1',
                taskId: readTaskId(nextAction.selectedTask) ?? nextAction.queueHeadTaskId ?? null,
                playbookChannel: 'normal'
            }));
        }
    }
    else if (nextAction.playbookState === 'absent') {
        messages.push(message('info', 'ATM_NEXT_PLAYBOOK_ABSENT', 'This route has no channel playbook. Treat the CLI JSON as structured ATM guidance and follow evidence.nextAction.command as the single next action before mutating files.', nextAction.structuredOutputHint ?? {
            schemaId: 'atm.nextStructuredOutputHint.v1',
            hasPlaybook: false,
            treatCliJsonAs: 'structured-tool-guidance',
            followNextActionField: 'evidence.nextAction.command'
        }));
    }
    if ((nextAction.ignoredArtifactForceAddHints?.length ?? 0) > 0) {
        messages.push(message('warning', 'ATM_NEXT_IGNORED_ARTIFACT_FORCE_ADD_HINT', 'ATM found ignored artifact paths in the current worktree. If one of them is the intended deliverable for the selected route, force-add it explicitly instead of assuming normal git add will see it.', {
            schemaId: 'atm.ignoredArtifactForceAddHints.v1',
            hints: nextAction.ignoredArtifactForceAddHints
        }));
    }
    const promptWorktreeHint = nextAction.promptWorktreeHint;
    if (shouldEmitPromptWorktreeHint(promptWorktreeHint)) {
        messages.push(message('info', 'ATM_NEXT_WORKTREE_SCOPE_HINT', 'ATM classified current dirty files before task selection so you can distinguish prompt-matched hints from unrelated or generated residue.', promptWorktreeHint));
    }
    const deliveryPrinciple = nextAction.deliveryPrinciple
        ?? (nextAction.selectedTask || nextAction.selectedTasks ? buildTaskDeliveryPrinciple({ channel: nextAction.selectedTasks ? 'batch' : 'normal' }) : null);
    if (deliveryPrinciple) {
        messages.push(message('warning', 'ATM_TASK_DELIVERY_PRINCIPLE', 'Task cards are not targets to close; they are delivery contracts. Implement the requested non-.atm deliverables before closing.', deliveryPrinciple));
    }
    if (nextAction.teamRecommendation?.enabled) {
        messages.push(message('info', 'ATM_TEAM_RECOMMENDATION', nextAction.teamRecommendation.reason, {
            schemaId: nextAction.teamRecommendation.schemaId,
            plan: nextAction.teamRecommendation.plan,
            start: nextAction.teamRecommendation.start,
            status: nextAction.teamRecommendation.status,
            recipeId: nextAction.teamRecommendation.recipeId,
            taskId: nextAction.teamRecommendation.taskId,
            ...(nextAction.teamRecommendation.knowledgeSummary ? {
                knowledgeSummary: nextAction.teamRecommendation.knowledgeSummary
            } : {})
        }));
    }
    if (nextAction.governanceReadiness) {
        const readinessRecord = nextAction.governanceReadiness;
        const activeWorkSummary = readinessRecord.activeWorkSummary && typeof readinessRecord.activeWorkSummary === 'object' && !Array.isArray(readinessRecord.activeWorkSummary)
            ? readinessRecord.activeWorkSummary
            : null;
        const brokerRecommendation = activeWorkSummary?.brokerRecommendation && typeof activeWorkSummary.brokerRecommendation === 'object' && !Array.isArray(activeWorkSummary.brokerRecommendation)
            ? activeWorkSummary.brokerRecommendation
            : null;
        const teamLevelRecommendation = activeWorkSummary?.teamLevelRecommendation && typeof activeWorkSummary.teamLevelRecommendation === 'object' && !Array.isArray(activeWorkSummary.teamLevelRecommendation)
            ? activeWorkSummary.teamLevelRecommendation
            : null;
        if (brokerRecommendation?.enabled === true) {
            messages.push(message('warning', 'ATM_ACTIVE_WORK_BROKER_RECOMMENDED', `ATM detected active concurrent work; consider Team Agent Broker ${teamLevelRecommendation?.level ?? 'L3'} before editing.`, {
                schemaId: activeWorkSummary?.schemaId ?? 'atm.activeWorkSummary.v1',
                brokerRecommendation,
                teamLevelRecommendation,
                activeActors: activeWorkSummary?.activeActors ?? [],
                activeClaims: activeWorkSummary?.activeClaims ?? [],
                stagedFiles: activeWorkSummary?.stagedFiles ?? []
            }));
        }
        messages.push(message('info', 'ATM_NEXT_GOVERNANCE_READINESS_HINT', 'ATM surfaced the governance prerequisites early so the agent can prepare claim, evidence, and protected-push checks before reaching commit or push.', nextAction.governanceReadiness));
    }
    messages.push(routeMessage);
    return messages;
}
function buildGovernanceReadinessHint(cwd, input) {
    const gitReadiness = readFastGitReadiness(cwd);
    const currentBranch = gitReadiness.currentBranch;
    const upstreamRef = gitReadiness.upstreamRef;
    const aheadCount = gitReadiness.aheadCount;
    const protectedBranchTarget = Boolean(currentBranch && isProtectedFrameworkBranchTarget(currentBranch));
    const needsFrameworkStatus = Boolean(input.frameworkClaimRequired) || isFrameworkMaintenancePrompt(input.prompt);
    const frameworkStatus = needsFrameworkStatus ? createFrameworkModeStatus({ cwd }) : null;
    const ownFiles = uniqueSorted([
        ...(input.ownFiles ?? []),
        ...(input.taskId ? readTaskWorkFiles(cwd, input.taskId) : [])
    ]);
    const activeWorkSummary = buildActiveWorkSummary(cwd, input.actorId, ownFiles);
    const earlyPreparation = [
        'Read evidence.nextAction.playbook before editing, closing, or committing.',
        'Resolve explicit actor identity before claim, commit, or report.',
        ...(input.frameworkClaimRequired || (frameworkStatus?.repoIdentity.isFrameworkRepo && isFrameworkMaintenancePrompt(input.prompt))
            ? ['Acquire framework-mode claim before editing framework-critical files.']
            : []),
        ...(input.channel === 'batch'
            ? ['Stay on the queue head and expect batch checkpoint before commit.']
            : []),
        ...(protectedBranchTarget
            ? ['Do not wait until push to discover branch-queue or closeout-boundary blockers; rerun doctor and hook pre-push proactively.']
            : [])
    ];
    return {
        schemaId: 'atm.nextGovernanceReadinessHint.v1',
        channel: input.channel,
        currentBranch,
        upstreamRef,
        protectedBranchTarget,
        aheadCount,
        frameworkClaimRequired: Boolean(input.frameworkClaimRequired),
        activeWorkSummary,
        earlyPreparation,
        queueRetryCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'],
        perCriticalCommitGitHeadEvidence: {
            enforcement: 'disabled',
            retainedStrictBoundaries: ['same-commit governed provenance', 'closure packet', 'evidence-only repair', 'task closeout']
        },
        protectedPushHint: protectedBranchTarget
            ? 'Protected framework branches no longer require per-critical-commit git-head evidence; same-commit governed provenance and high-risk closeout evidence remain strict.'
            : null
    };
}
function readTaskWorkFiles(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return [];
    try {
        const parsed = parseJsonText(readFileSync(taskPath, 'utf8'));
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
            ? parsed.claim
            : {};
        const directionLock = parsed.taskDirectionLock && typeof parsed.taskDirectionLock === 'object' && !Array.isArray(parsed.taskDirectionLock)
            ? parsed.taskDirectionLock
            : {};
        return uniqueSorted([
            ...readStringArray(parsed.scope),
            ...readStringArray(parsed.scopePaths),
            ...readStringArray(parsed.files),
            ...readStringArray(parsed.deliverables),
            ...readStringArray(claimRecord.files),
            ...readStringArray(directionLock.allowedFiles)
        ].map(normalizeWorkPath).filter(Boolean));
    }
    catch {
        return [];
    }
}
function readFastGitReadiness(cwd) {
    const gitDirectory = resolveGitDirectory(cwd);
    const currentBranch = gitDirectory ? readCurrentBranchFromGitDir(gitDirectory) : runGitScalar(cwd, ['branch', '--show-current']);
    const upstreamRef = currentBranch && gitDirectory
        ? readUpstreamFromGitConfig(gitDirectory, currentBranch) ?? runGitScalar(cwd, ['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`])
        : (currentBranch ? runGitScalar(cwd, ['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`]) : null);
    const aheadCount = currentBranch && upstreamRef && gitDirectory
        ? (readAheadCountFast(gitDirectory, currentBranch, upstreamRef) ?? Number.parseInt(runGitScalar(cwd, ['rev-list', '--count', `${upstreamRef}..HEAD`]) ?? '0', 10)) || 0
        : 0;
    return { currentBranch, upstreamRef, aheadCount };
}
function resolveGitDirectory(cwd) {
    const dotGit = path.join(cwd, '.git');
    if (!existsSync(dotGit))
        return null;
    try {
        const stat = statSync(dotGit);
        if (stat.isDirectory())
            return dotGit;
        if (stat.isFile()) {
            const text = readFileSync(dotGit, 'utf8').trim();
            const match = /^gitdir:\s*(.+)$/i.exec(text);
            if (match?.[1]) {
                const gitdir = match[1].trim();
                return path.isAbsolute(gitdir) ? gitdir : path.resolve(cwd, gitdir);
            }
        }
    }
    catch {
        return null;
    }
    return null;
}
function readCurrentBranchFromGitDir(gitDirectory) {
    try {
        const head = readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
        const prefix = 'ref: refs/heads/';
        return head.startsWith(prefix) ? head.slice(prefix.length).trim() || null : null;
    }
    catch {
        return null;
    }
}
function readUpstreamFromGitConfig(gitDirectory, branch) {
    try {
        const config = readFileSync(path.join(gitDirectory, 'config'), 'utf8');
        const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const section = new RegExp(`\\[branch "${escaped}"\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(config)?.[1];
        if (!section)
            return null;
        const remote = /^\s*remote\s*=\s*(.+)\s*$/m.exec(section)?.[1]?.trim();
        const merge = /^\s*merge\s*=\s*refs\/heads\/(.+)\s*$/m.exec(section)?.[1]?.trim();
        return remote && merge ? `${remote}/${merge}` : null;
    }
    catch {
        return null;
    }
}
function readAheadCountFast(gitDirectory, branch, upstreamRef) {
    const localSha = readRefSha(gitDirectory, `refs/heads/${branch}`);
    const upstreamSha = readRefSha(gitDirectory, `refs/remotes/${upstreamRef}`);
    if (!localSha || !upstreamSha)
        return null;
    return localSha === upstreamSha ? 0 : null;
}
function readRefSha(gitDirectory, refPath) {
    try {
        const value = readFileSync(path.join(gitDirectory, ...refPath.split('/')), 'utf8').trim();
        return /^[0-9a-f]{40}$/i.test(value) ? value : null;
    }
    catch {
        return readPackedRefSha(gitDirectory, refPath);
    }
}
function readPackedRefSha(gitDirectory, refPath) {
    try {
        const packedRefs = readFileSync(path.join(gitDirectory, 'packed-refs'), 'utf8');
        for (const line of packedRefs.split(/\r?\n/)) {
            if (line.startsWith('#') || line.startsWith('^'))
                continue;
            const [sha, ref] = line.trim().split(/\s+/, 2);
            if (ref === refPath && /^[0-9a-f]{40}$/i.test(sha))
                return sha;
        }
    }
    catch {
        return null;
    }
    return null;
}
function shouldInspectCrossRepoFrameworkStatus(cwd, targetRepo) {
    if (!targetRepo)
        return false;
    const normalizedTarget = targetRepo.replace(/\\/g, '/').trim();
    if (!normalizedTarget)
        return false;
    const currentRoot = path.resolve(cwd);
    const currentName = path.basename(currentRoot).toLowerCase();
    if (normalizedTarget.toLowerCase() === currentName)
        return false;
    if (path.isAbsolute(normalizedTarget) && path.resolve(normalizedTarget) === currentRoot)
        return false;
    return true;
}
function runGitScalar(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0)
        return null;
    const value = String(result.stdout ?? '').trim();
    return value.length > 0 ? value : null;
}
function isProtectedFrameworkBranchTarget(branch) {
    return branch === 'main'
        || branch === 'master'
        || branch === 'trunk'
        || /^release\/.+/.test(branch);
}
