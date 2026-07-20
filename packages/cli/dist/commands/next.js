import path from 'node:path';
import { readActiveGuidanceSession, toGuidanceNextAction } from '../../../core/dist/guidance/index.js';
import { buildFirstUseUserNotice } from './first-use-notice.js';
import { runDoctor } from './doctor.js';
import { decideRuntimeNextAction } from './next/channel-strategy.js';
import { withRunnerMode } from './next/runner-mode.js';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.js';
import { inspectIntegrationBootstrap } from './integration.js';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.js';
import { createFrameworkModeStatus } from './framework-development.js';
import { makeResult, message, parseOptions, resolveNextDefaultOutputPath, setOutputJsonPath } from './shared.js';
import { uniqueInOrder } from './next/view-projections.js';
import { hasPromptScopedWorkItems, inspectImportedTaskQueue, resolveTaskIntent } from './next/route-resolution.js';
import { buildActiveTaskDivergenceResult, buildAgentPackHint, buildNextMessages, enrichWithLegacyPlan, shouldInspectCrossRepoFrameworkStatus } from './next/playbook-projection.js';
import { buildPromptScopedNextResult } from './next/prompt-results.js';
export { resolvePromptScopedTaskContext, resolveHandoffResumeTaskRoute, shouldSkipExternalTaskCardScan, shouldSkipMarkdownTaskDiscovery } from './next/route-resolution.js';
export { buildActiveWorkSummary } from './next/playbook-projection.js';
import { compactNextRouteResult } from './next/result-compaction.js';
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
import { createNextProfiler } from './next/profiler.js';
import { claimNextImportedTask, extractClaimIntentFlag } from './next/claim-orchestration.js';
import { buildCrossRepoFrameworkNextResult } from './next/cross-repo-framework-result.js';
export { diagnoseClaimReadinessForTasks } from './next/claim-orchestration.js';
import { buildPromptGuidanceNextResult, buildPromptRequiredNextResult } from './next/prompt-guidance-result.js';
