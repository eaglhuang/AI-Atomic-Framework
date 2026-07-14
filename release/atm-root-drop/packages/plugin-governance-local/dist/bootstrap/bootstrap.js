import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultGuards } from '../default-guards.js';
import { createLocalGovernanceStores } from '../stores.js';
import { createContextBudgetSummary, createDefaultContextBudgetPolicy, evaluateContextBudget, estimateContextBudgetTokens, sanitizeBudgetFileId } from './budget.js';
import { createContinuationRunReport, createContinuationSummaryRecord, renderContextSummaryMarkdown } from './prompt.js';
const defaultBootstrapTaskId = 'BOOTSTRAP-0001';
const defaultBootstrapTaskTitle = 'Bootstrap ATM in this repository';
const currentLayoutVersion = 2;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const templateRoot = path.join(repoRoot, 'templates', 'root-drop');
const templateFiles = [
    {
        source: 'AGENTS.md',
        target: 'AGENTS.md'
    },
    {
        source: path.join('.atm', 'profile', 'default.md'),
        target: path.join('.atm', 'runtime', 'profile', 'default.md')
    },
    {
        source: path.join('.atm', 'context', 'INITIAL_SUMMARY.md'),
        target: path.join('.atm', 'history', 'handoff', 'INITIAL_SUMMARY.md')
    }
];
const charterTemplateFiles = [
    {
        source: path.join('.atm', 'charter', 'atomic-charter.template.md'),
        target: path.join('.atm', 'charter', 'atomic-charter.md')
    },
    {
        source: path.join('.atm', 'charter', 'atm-first-principles.template.md'),
        target: path.join('.atm', 'charter', 'atm-first-principles.md')
    },
    {
        source: path.join('.atm', 'charter', 'charter-invariants.template.json'),
        target: path.join('.atm', 'charter', 'charter-invariants.json')
    }
];
const rootDropScriptNames = [
    'atm-next',
    'atm-orient',
    'atm-create',
    'atm-lock',
    'atm-evidence',
    'atm-upgrade-scan',
    'atm-handoff'
];
const rootDropScriptTemplateFiles = rootDropScriptNames.flatMap((scriptName) => [
    {
        source: path.join('.atm', 'scripts', 'sh', `${scriptName}.sh`),
        target: path.join('.atm', 'scripts', 'sh', `${scriptName}.sh`)
    },
    {
        source: path.join('.atm', 'scripts', 'ps', `${scriptName}.ps1`),
        target: path.join('.atm', 'scripts', 'ps', `${scriptName}.ps1`)
    }
]);
const rootAgentsEntryStart = '<!-- ATM ROOT ENTRY:START -->';
const rootAgentsEntryEnd = '<!-- ATM ROOT ENTRY:END -->';
const rootReadmeEntryStart = '<!-- ATM README ENTRY:START -->';
const rootReadmeEntryEnd = '<!-- ATM README ENTRY:END -->';
export function installRootDropScripts(cwd, options = {}) {
    const created = [];
    const unchanged = [];
    writeRootDropScripts(cwd, options.force === true, created, unchanged);
    return {
        created,
        unchanged,
        scriptPaths: rootDropScriptTemplateFiles.map((templateFile) => normalizeRelativePath(templateFile.target)),
        platformHintPath: process.platform === 'win32'
            ? '.atm/scripts/ps'
            : '.atm/scripts/sh'
    };
}
export function adoptLocalGovernanceBundle(cwd, options = {}) {
    const force = options.force === true;
    const taskId = typeof options.taskId === 'string' && options.taskId.trim().length > 0
        ? options.taskId.trim()
        : defaultBootstrapTaskId;
    const taskTitle = typeof options.taskTitle === 'string' && options.taskTitle.trim().length > 0
        ? options.taskTitle.trim()
        : defaultBootstrapTaskTitle;
    const created = [];
    const unchanged = [];
    const paths = createBootstrapPaths(cwd, taskId);
    const migration = migrateLegacyBootstrapLayout(cwd, taskId, paths, force, created, unchanged);
    const stores = createLocalGovernanceStores({ repositoryRoot: cwd });
    for (const directoryPath of Object.values(paths.directories)) {
        ensureDirectory(directoryPath, cwd, created, unchanged);
    }
    const pinnedRunner = installPinnedRunner(cwd, force, created, unchanged);
    stores.documentIndex.initialize?.();
    stores.shardStore.initialize?.();
    stores.artifactStore.initialize?.();
    stores.logStore.initialize?.();
    stores.runReportStore?.initialize?.();
    stores.ruleGuard.initialize?.();
    stores.evidenceStore.initialize?.();
    stores.contextBudgetGuard?.initialize?.();
    stores.contextSummaryStore?.initialize?.();
    const recommendedPrompt = createRecommendedPrompt(taskId);
    const projectProbe = probeRepository(cwd, recommendedPrompt);
    const defaultGuards = createDefaultGuards(projectProbe);
    const defaultContextBudgetPolicy = createDefaultContextBudgetPolicy(projectProbe.generatedAt ?? new Date().toISOString());
    const bootstrapBudgetId = `bootstrap/${taskId}`;
    const contextBudgetReportPath = path.join('.atm', 'history', 'reports', 'context-budget', `bootstrap-${sanitizeBudgetFileId(bootstrapBudgetId)}.json`);
    const contextBudgetSummaryPath = relativePathFrom(cwd, paths.contextBudgetSummaryPath);
    const continuationReportPath = path.join('.atm', 'history', 'reports', 'continuation', `${taskId}.json`);
    const contextSummaryPath = relativePathFrom(cwd, paths.contextSummaryPath);
    const contextSummaryMarkdownPath = relativePathFrom(cwd, paths.contextSummaryMarkdownPath);
    const bootstrapBudgetInput = {
        budgetId: bootstrapBudgetId,
        workItemId: taskId,
        estimatedTokens: estimateContextBudgetTokens(projectProbe, defaultGuards, recommendedPrompt, templateFiles.map((entry) => entry.target)),
        inlineArtifacts: 0,
        requestedSummary: 'Continue from the stored bootstrap summary and evidence paths instead of replaying the full bootstrap probe inline.'
    };
    const bootstrapBudgetEvaluation = evaluateContextBudget(defaultContextBudgetPolicy, bootstrapBudgetInput, projectProbe.generatedAt ?? new Date().toISOString());
    const continuationInput = {
        workItemId: taskId,
        generatedAt: projectProbe.generatedAt ?? new Date().toISOString(),
        summaryId: `summary.${sanitizeBudgetFileId(taskId).toLowerCase()}`,
        summary: 'Default ATM bootstrap pack created and linked to evidence, context budget, and the next continuation prompt.',
        nextActions: [
            `Read .atm/history/tasks/${taskId}.json and .atm/runtime/profile/default.md.`,
            'Run node atm.mjs next --prompt "<current user prompt>" --json, show ATM_USER_NOTICE or evidence.userNotice if present, then execute the returned next action.',
            'Record the first smoke artifact, log, evidence, and handoff before closing the work item.'
        ],
        artifactPaths: ['.atm/history/artifacts', '.atm/history/logs', '.atm/history/reports'],
        evidencePaths: [relativePathFrom(cwd, paths.evidencePath)],
        reportPaths: [normalizeRelativePath(contextBudgetReportPath), normalizeRelativePath(continuationReportPath)],
        authoredBy: '@ai-atomic-framework/plugin-governance-local',
        handoffKind: 'bootstrap',
        continuationGoal: 'Resume bootstrap from the generated task, profile, evidence, and budget surfaces.',
        resumePrompt: recommendedPrompt,
        resumeCommand: ['node', 'atm.mjs', 'next', '--prompt', '<current user prompt>', '--json'],
        budgetDecision: bootstrapBudgetEvaluation.decision,
        hardStop: bootstrapBudgetEvaluation.decision === 'hard-stop'
    };
    const continuationSummary = {
        ...createContinuationSummaryRecord(continuationInput),
        summaryMarkdownPath: normalizeRelativePath(contextSummaryMarkdownPath)
    };
    const bootstrapEvidence = {
        ...createBootstrapEvidence(taskId, projectProbe, defaultGuards, paths),
        pinnedRunner,
        contextBudgetReportPath: normalizeRelativePath(contextBudgetReportPath),
        contextBudgetSummaryPath: bootstrapBudgetEvaluation.decision === 'pass' ? null : normalizeRelativePath(contextBudgetSummaryPath),
        contextSummaryPath: normalizeRelativePath(contextSummaryPath),
        contextSummaryMarkdownPath: normalizeRelativePath(contextSummaryMarkdownPath),
        continuationReportPath: normalizeRelativePath(continuationReportPath),
        budgetDecision: bootstrapBudgetEvaluation.decision,
        continuationGoal: continuationInput.continuationGoal
    };
    writeJson(paths.configPath, createBootstrapConfig(taskId), cwd, force, created, unchanged);
    writeJson(paths.currentTaskPath, createCurrentTaskState(taskId, taskTitle, paths), cwd, force, created, unchanged);
    writeJson(paths.projectProbePath, projectProbe, cwd, force, created, unchanged);
    writeJson(paths.defaultGuardsPath, defaultGuards, cwd, force, created, unchanged);
    writeJson(paths.contextBudgetPolicyPath, defaultContextBudgetPolicy, cwd, force, created, unchanged);
    writeJson(paths.taskPath, createBootstrapTask(taskId, taskTitle, projectProbe, paths), cwd, force, created, unchanged);
    writeJson(paths.lockPath, createBootstrapLock(taskId, paths), cwd, force, created, unchanged);
    writeJson(paths.evidencePath, bootstrapEvidence, cwd, force, created, unchanged);
    writeJson(resolveRepoPath(cwd, contextBudgetReportPath), {
        budgetId: bootstrapBudgetId,
        workItemId: taskId,
        policyId: defaultContextBudgetPolicy.policyId,
        decision: bootstrapBudgetEvaluation.decision,
        estimatedTokens: bootstrapBudgetEvaluation.estimatedTokens,
        inlineArtifacts: bootstrapBudgetEvaluation.inlineArtifacts,
        generatedAt: bootstrapBudgetEvaluation.generatedAt,
        reason: bootstrapBudgetEvaluation.reason
    }, cwd, force, created, unchanged);
    if (bootstrapBudgetEvaluation.decision !== 'pass') {
        writeText(resolveRepoPath(cwd, contextBudgetSummaryPath), createContextBudgetSummary(defaultContextBudgetPolicy, bootstrapBudgetInput, bootstrapBudgetEvaluation), cwd, force, created, unchanged);
    }
    writeJson(resolveRepoPath(cwd, continuationReportPath), createContinuationRunReport(`continuation/${taskId}`, continuationInput), cwd, force, created, unchanged);
    writeJson(resolveRepoPath(cwd, contextSummaryPath), continuationSummary, cwd, force, created, unchanged);
    writeText(resolveRepoPath(cwd, contextSummaryMarkdownPath), renderContextSummaryMarkdown(continuationSummary), cwd, force, created, unchanged);
    if (migration !== null) {
        writeJson(migration.path, migration.report, cwd, force, created, unchanged);
    }
    const templateTokens = {
        RECOMMENDED_PROMPT: recommendedPrompt,
        BOOTSTRAP_TASK_PATH: relativePathFrom(cwd, paths.taskPath),
        BOOTSTRAP_LOCK_PATH: relativePathFrom(cwd, paths.lockPath),
        BOOTSTRAP_PROFILE_PATH: relativePathFrom(cwd, paths.profilePath),
        PROJECT_PROBE_PATH: relativePathFrom(cwd, paths.projectProbePath),
        DEFAULT_GUARDS_PATH: relativePathFrom(cwd, paths.defaultGuardsPath),
        BOOTSTRAP_EVIDENCE_PATH: relativePathFrom(cwd, paths.evidencePath),
        REPOSITORY_KIND: String(projectProbe.repositoryKind ?? 'generic-repository'),
        HOST_WORKFLOW: String(projectProbe.hostWorkflow ?? 'manual'),
        PACKAGE_MANAGER: String(projectProbe.packageManager ?? 'none')
    };
    for (const templateFile of templateFiles) {
        if (templateFile.target === 'AGENTS.md') {
            writeAgentInstructionsTemplate(path.join(templateRoot, templateFile.source), path.join(cwd, templateFile.target), templateTokens, cwd, force, created, unchanged);
            continue;
        }
        writeTemplate(path.join(templateRoot, templateFile.source), path.join(cwd, templateFile.target), templateTokens, cwd, force, created, unchanged);
    }
    patchReadmeEntry(path.join(cwd, 'README.md'), cwd, force, created, unchanged);
    const now = projectProbe.generatedAt ? new Date(String(projectProbe.generatedAt)) : new Date();
    const lastAmendedDate = now.toISOString().slice(0, 10);
    const projectName = (typeof projectProbe.repositoryKind === 'string'
        ? (readProjectName(cwd) ?? projectProbe.repositoryKind)
        : (readProjectName(cwd) ?? path.basename(cwd))) || 'unknown-project';
    const charterTokens = {
        PROJECT_NAME: projectName,
        CHARTER_VERSION: '1.0.0',
        LAST_AMENDED_DATE: `${lastAmendedDate}T00:00:00.000Z`
    };
    const atomicCharterPath = path.join(cwd, '.atm', 'charter', 'atomic-charter.md');
    const firstPrinciplesPath = path.join(cwd, '.atm', 'charter', 'atm-first-principles.md');
    const invariantsPath = path.join(cwd, '.atm', 'charter', 'charter-invariants.json');
    const renderedAtomicCharter = renderTemplate(readFileSync(path.join(templateRoot, '.atm', 'charter', 'atomic-charter.template.md'), 'utf8'), charterTokens);
    const renderedFirstPrinciples = renderTemplate(readFileSync(path.join(templateRoot, '.atm', 'charter', 'atm-first-principles.template.md'), 'utf8'), charterTokens);
    writeText(atomicCharterPath, renderedAtomicCharter, cwd, force, created, unchanged);
    writeText(firstPrinciplesPath, renderedFirstPrinciples, cwd, force, created, unchanged);
    writeTemplate(path.join(templateRoot, '.atm', 'charter', 'charter-invariants.template.json'), invariantsPath, {
        ...charterTokens,
        ATOMIC_CHARTER_SHA256: `sha256:${sha256Bytes(Buffer.from(renderedAtomicCharter, 'utf8'))}`,
        ATM_FIRST_PRINCIPLES_SHA256: `sha256:${sha256Bytes(Buffer.from(renderedFirstPrinciples, 'utf8'))}`
    }, cwd, force, created, unchanged);
    writeRootDropScripts(cwd, force, created, unchanged);
    return {
        created,
        unchanged,
        pinnedRunner,
        adoptedProfile: 'default',
        bootstrapTaskPath: relativePathFrom(cwd, paths.taskPath),
        bootstrapLockPath: relativePathFrom(cwd, paths.lockPath),
        agentInstructionsPath: relativePathFrom(cwd, paths.agentInstructionsPath),
        profilePath: relativePathFrom(cwd, paths.profilePath),
        projectProbePath: relativePathFrom(cwd, paths.projectProbePath),
        defaultGuardsPath: relativePathFrom(cwd, paths.defaultGuardsPath),
        evidencePath: relativePathFrom(cwd, paths.evidencePath),
        contextBudgetPolicyPath: relativePathFrom(cwd, paths.contextBudgetPolicyPath),
        contextBudgetReportPath: normalizeRelativePath(contextBudgetReportPath),
        contextBudgetSummaryPath: bootstrapBudgetEvaluation.decision === 'pass' ? undefined : normalizeRelativePath(contextBudgetSummaryPath),
        contextSummaryPath: normalizeRelativePath(contextSummaryPath),
        contextSummaryMarkdownPath: normalizeRelativePath(contextSummaryMarkdownPath),
        continuationReportPath: normalizeRelativePath(continuationReportPath),
        projectProbe,
        recommendedPrompt,
        charterPath: relativePathFrom(cwd, paths.charterPath),
        charterInvariantsPath: relativePathFrom(cwd, paths.charterInvariantsPath),
        scriptPaths: rootDropScriptTemplateFiles.map((templateFile) => normalizeRelativePath(templateFile.target))
    };
}
export function createOfficialBootstrapCommand(commandCwd = '.') {
    return `node atm.mjs bootstrap --cwd ${commandCwd} --task "${defaultBootstrapTaskTitle}"`;
}
export function createRecommendedPrompt(taskId = defaultBootstrapTaskId) {
    return `Read README.md if present, then run \`node atm.mjs next --prompt "<current user prompt>" --json\` from the repository root before task work. If there is no current user prompt and you are only checking repository orientation, \`node atm.mjs next --json\` is read-only status. If the result includes ATM_USER_NOTICE or evidence.userNotice, show it to the user before executing the returned next action. Use .atm/history/tasks/${taskId}.json, .atm/runtime/profile/default.md, and .atm/history/evidence/${taskId}.json only as supporting runtime state.`;
}
export function createSelfHostingAlphaPrompt() {
    return 'Read README.md if present, then run `node atm.mjs next --prompt "<current user prompt>" --json` from the repository root before task work. If there is no current user prompt and you are only checking repository orientation, `node atm.mjs next --json` is read-only status. If the result includes ATM_USER_NOTICE or evidence.userNotice, show it to the user before executing the returned next action.';
}
function createBootstrapConfig(taskId) {
    return {
        schemaVersion: 'atm.config.v0.1',
        layoutVersion: currentLayoutVersion,
        createdBy: '@ai-atomic-framework/plugin-governance-local',
        adapter: {
            mode: 'standalone',
            implemented: false
        },
        paths: {
            runtime: '.atm/runtime',
            history: '.atm/history',
            catalog: '.atm/catalog',
            profile: '.atm/runtime/profile',
            currentTask: '.atm/runtime/current-task.json',
            projectProbe: '.atm/runtime/project-probe.json',
            defaultGuards: '.atm/runtime/default-guards.json',
            contextBudget: '.atm/runtime/budget',
            tasks: '.atm/history/tasks',
            taskEvents: '.atm/history/task-events',
            locks: '.atm/runtime/locks',
            evidence: '.atm/history/evidence',
            handoff: '.atm/history/handoff',
            artifacts: '.atm/history/artifacts',
            logs: '.atm/history/logs',
            reports: '.atm/history/reports',
            registry: '.atm/catalog/registry',
            index: '.atm/catalog/index',
            shards: '.atm/catalog/shards'
        },
        taskLedger: {
            enabled: true,
            mode: 'auto',
            mirrorExternalTasks: true,
            requireCliTransitions: true,
            provider: 'atm-local'
        },
        adoption: {
            profile: 'default',
            taskPath: `.atm/history/tasks/${taskId}.json`,
            lockPath: `.atm/runtime/locks/${taskId}.lock.json`,
            projectProbePath: '.atm/runtime/project-probe.json',
            defaultGuardsPath: '.atm/runtime/default-guards.json',
            evidencePath: `.atm/history/evidence/${taskId}.json`,
            currentTaskPath: '.atm/runtime/current-task.json'
        }
    };
}
function createCurrentTaskState(taskId, taskTitle, paths) {
    return {
        workItemId: taskId,
        title: taskTitle,
        status: 'open',
        updatedAt: new Date().toISOString(),
        lockPath: relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.lockPath),
        evidencePath: relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.evidencePath),
        summaryPath: relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.contextSummaryPath)
    };
}
function migrateLegacyBootstrapLayout(cwd, taskId, paths, force, created, unchanged) {
    const legacyPairs = [
        [path.join(cwd, '.atm', 'profile', 'default.md'), paths.profilePath],
        [path.join(cwd, '.atm', 'state', 'project-probe.json'), paths.projectProbePath],
        [path.join(cwd, '.atm', 'state', 'default-guards.json'), paths.defaultGuardsPath],
        [path.join(cwd, '.atm', 'state', 'context-budget', 'default-policy.json'), paths.contextBudgetPolicyPath],
        [path.join(cwd, '.atm', 'tasks', `${taskId}.json`), paths.taskPath],
        [path.join(cwd, '.atm', 'locks', `${taskId}.lock.json`), paths.lockPath],
        [path.join(cwd, '.atm', 'evidence', `${taskId}.json`), paths.evidencePath],
        [path.join(cwd, '.atm', 'state', 'context-summary', `${taskId}.json`), paths.contextSummaryPath],
        [path.join(cwd, '.atm', 'state', 'context-summary', `${taskId}.md`), paths.contextSummaryMarkdownPath]
    ];
    const moved = [];
    for (const [legacyPath, nextPath] of legacyPairs) {
        if (!existsSync(legacyPath)) {
            continue;
        }
        if (existsSync(nextPath) && !force) {
            unchanged.push(relativePathFrom(cwd, nextPath));
            continue;
        }
        mkdirSync(path.dirname(nextPath), { recursive: true });
        writeFileSync(nextPath, readFileSync(legacyPath));
        created.push(relativePathFrom(cwd, nextPath));
        moved.push(relativePathFrom(cwd, legacyPath));
    }
    if (moved.length === 0) {
        return null;
    }
    return {
        path: path.join(cwd, '.atm', 'history', 'reports', 'migrations', `layout-v1-to-v${currentLayoutVersion}.json`),
        report: {
            schemaVersion: 'atm.layoutMigration.v0.1',
            migrationId: `layout-v1-to-v${currentLayoutVersion}`,
            migratedAt: new Date().toISOString(),
            taskId,
            fromLayoutVersion: 1,
            toLayoutVersion: currentLayoutVersion,
            copiedFrom: moved,
            notes: 'Legacy ATM layout paths were copied forward into the v2 runtime/history/catalog layout.'
        }
    };
}
function createBootstrapPaths(cwd, taskId) {
    const atmRoot = path.join(cwd, '.atm');
    return {
        configPath: path.join(atmRoot, 'config.json'),
        agentInstructionsPath: path.join(cwd, 'AGENTS.md'),
        profilePath: path.join(atmRoot, 'runtime', 'profile', 'default.md'),
        currentTaskPath: path.join(atmRoot, 'runtime', 'current-task.json'),
        projectProbePath: path.join(atmRoot, 'runtime', 'project-probe.json'),
        defaultGuardsPath: path.join(atmRoot, 'runtime', 'default-guards.json'),
        contextBudgetPolicyPath: path.join(atmRoot, 'runtime', 'budget', 'default-policy.json'),
        contextBudgetSummaryPath: path.join(atmRoot, 'runtime', 'budget', `bootstrap-${sanitizeBudgetFileId(`bootstrap/${taskId}`)}.md`),
        taskPath: path.join(atmRoot, 'history', 'tasks', `${taskId}.json`),
        lockPath: path.join(atmRoot, 'runtime', 'locks', `${taskId}.lock.json`),
        evidencePath: path.join(atmRoot, 'history', 'evidence', `${taskId}.json`),
        contextSummaryPath: path.join(atmRoot, 'history', 'handoff', `${taskId}.json`),
        contextSummaryMarkdownPath: path.join(atmRoot, 'history', 'handoff', `${taskId}.md`),
        contextPath: path.join(atmRoot, 'history', 'handoff', 'INITIAL_SUMMARY.md'),
        directories: {
            runtime: path.join(atmRoot, 'runtime'),
            profile: path.join(atmRoot, 'runtime', 'profile'),
            state: path.join(atmRoot, 'runtime', 'state'),
            locks: path.join(atmRoot, 'runtime', 'locks'),
            rules: path.join(atmRoot, 'runtime', 'rules'),
            contextBudget: path.join(atmRoot, 'runtime', 'budget'),
            history: path.join(atmRoot, 'history'),
            tasks: path.join(atmRoot, 'history', 'tasks'),
            evidence: path.join(atmRoot, 'history', 'evidence'),
            artifacts: path.join(atmRoot, 'history', 'artifacts'),
            logs: path.join(atmRoot, 'history', 'logs'),
            reports: path.join(atmRoot, 'history', 'reports'),
            reportContextBudget: path.join(atmRoot, 'history', 'reports', 'context-budget'),
            reportContinuation: path.join(atmRoot, 'history', 'reports', 'continuation'),
            reportSelfHost: path.join(atmRoot, 'history', 'reports', 'self-host-alpha'),
            reportMigrations: path.join(atmRoot, 'history', 'reports', 'migrations'),
            context: path.join(atmRoot, 'history', 'handoff'),
            catalog: path.join(atmRoot, 'catalog'),
            index: path.join(atmRoot, 'catalog', 'index'),
            shards: path.join(atmRoot, 'catalog', 'shards'),
            registry: path.join(atmRoot, 'catalog', 'registry'),
            charter: path.join(atmRoot, 'charter')
        },
        charterPath: path.join(atmRoot, 'charter', 'atomic-charter.md'),
        charterInvariantsPath: path.join(atmRoot, 'charter', 'charter-invariants.json')
    };
}
function createBootstrapTask(taskId, taskTitle, projectProbe, paths) {
    return {
        schemaVersion: 'atm.workItem.v0.1',
        id: taskId,
        title: taskTitle,
        status: 'open',
        taskKind: 'bootstrap',
        repositoryKind: projectProbe.repositoryKind,
        summary: 'Establish the default ATM bootstrap pack, verify the host workflow, and leave initial evidence for the next agent run.',
        scope: [
            'atm.mjs',
            'README.md',
            'AGENTS.md',
            '.atm/runtime/pinned-runner.json',
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.taskPath),
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.lockPath)
        ],
        guardPaths: [
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.defaultGuardsPath)
        ],
        evidencePath: relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.evidencePath),
        nextPrompt: createRecommendedPrompt(taskId)
    };
}
function createBootstrapLock(taskId, paths) {
    return {
        schemaVersion: 'atm.scopeLock.v0.1',
        taskId,
        status: 'open',
        files: [
            'atm.mjs',
            'README.md',
            'AGENTS.md',
            '.atm/runtime/pinned-runner.json',
            '.atm/config.json',
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.profilePath),
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.currentTaskPath),
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.projectProbePath),
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.defaultGuardsPath),
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.taskPath),
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.evidencePath)
        ]
    };
}
function createBootstrapEvidence(taskId, projectProbe, defaultGuards, paths) {
    return {
        schemaVersion: 'atm.evidence.v0.1',
        taskId,
        status: 'seeded',
        summary: 'Default ATM bootstrap pack created.',
        repositoryKind: projectProbe.repositoryKind,
        packageManager: projectProbe.packageManager,
        recommendedPrompt: createRecommendedPrompt(),
        guardIds: defaultGuards.guards.map((guard) => guard.id),
        artifactDirectories: [
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.directories.artifacts),
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.directories.logs),
            relativePathFrom(path.dirname(paths.agentInstructionsPath), paths.directories.reports)
        ],
        evidence: []
    };
}
function readProjectName(cwd) {
    const packageJsonPath = path.join(cwd, 'package.json');
    if (!existsSync(packageJsonPath)) {
        return null;
    }
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const name = typeof pkg.name === 'string' ? pkg.name.trim() : '';
    return name.length > 0 ? name : null;
}
function probeRepository(cwd, recommendedPrompt) {
    const packageJsonPath = path.join(cwd, 'package.json');
    const packageJson = existsSync(packageJsonPath)
        ? JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        : null;
    const scripts = packageJson?.scripts || {};
    const hasIndexHtml = existsSync(path.join(cwd, 'index.html'));
    const hasArticlesIndex = existsSync(path.join(cwd, 'articles', 'index.html'));
    const hasAssetsCss = existsSync(path.join(cwd, 'assets', 'css'));
    const topLevelEntries = existsSync(cwd)
        ? readdirSync(cwd, { withFileTypes: true }).map((entry) => entry.name).sort()
        : [];
    let repositoryKind = 'generic-repository';
    if (packageJson) {
        repositoryKind = 'javascript-package';
    }
    else if (hasIndexHtml || hasArticlesIndex || hasAssetsCss) {
        repositoryKind = 'static-site';
    }
    return {
        schemaVersion: 'atm.projectProbe.v0.1',
        generatedAt: new Date().toISOString(),
        repositoryKind,
        packageManager: detectPackageManager(cwd, packageJson),
        hostWorkflow: packageJson ? 'script-driven' : (repositoryKind === 'static-site' ? 'file-publish' : 'manual'),
        sourceControl: existsSync(path.join(cwd, '.git')) ? 'git' : 'filesystem',
        detectedFiles: topLevelEntries,
        commands: {
            test: scripts.test ? createPackageManagerCommand(cwd, packageJson, 'test') : null,
            typecheck: scripts.typecheck ? createPackageManagerCommand(cwd, packageJson, 'typecheck') : null,
            lint: scripts.lint ? createPackageManagerCommand(cwd, packageJson, 'lint') : null
        },
        recommendedPrompt
    };
}
function detectPackageManager(cwd, packageJson) {
    if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (existsSync(path.join(cwd, 'yarn.lock'))) {
        return 'yarn';
    }
    if (existsSync(path.join(cwd, 'package-lock.json')) || packageJson) {
        return 'npm';
    }
    return 'none';
}
function createPackageManagerCommand(cwd, packageJson, scriptName) {
    const manager = detectPackageManager(cwd, packageJson);
    if (manager === 'pnpm') {
        return `pnpm run ${scriptName}`;
    }
    if (manager === 'yarn') {
        return `yarn ${scriptName}`;
    }
    return `npm run ${scriptName}`;
}
function ensureDirectory(directoryPath, cwd, created, unchanged) {
    if (existsSync(directoryPath)) {
        unchanged.push(relativePathFrom(cwd, directoryPath));
        return;
    }
    mkdirSync(directoryPath, { recursive: true });
    created.push(relativePathFrom(cwd, directoryPath));
}
function installPinnedRunner(cwd, force, created, unchanged) {
    const runnerPath = path.join(cwd, 'atm.mjs');
    const metadataPath = path.join(cwd, '.atm', 'runtime', 'pinned-runner.json');
    const metadataRelativePath = '.atm/runtime/pinned-runner.json';
    const generatedAt = readPinnedRunnerGeneratedAt(metadataPath) ?? new Date().toISOString();
    const source = resolvePinnedRunnerSource();
    if (source === null) {
        const metadata = {
            schemaVersion: 'atm.pinnedRunner.v0.1',
            runnerPath: 'atm.mjs',
            metadataPath: metadataRelativePath,
            command: 'node atm.mjs next --prompt "<current user prompt>" --json',
            status: 'source-unavailable',
            sourceKind: 'unavailable',
            frameworkVersion: '0.0.0',
            generatedAt,
            reason: 'No pinned onefile launcher source was available. Run bootstrap from release/atm-onefile/atm.mjs or set ATM_PINNED_RUNNER_SOURCE.'
        };
        writeJsonIfChanged(metadataPath, metadata, cwd, created, unchanged);
        return metadata;
    }
    const sourceBytes = readFileSync(source.path);
    const sourceSha256 = sha256Bytes(sourceBytes);
    const sourceStats = statSync(source.path);
    const existingSha256 = existsSync(runnerPath) ? sha256Bytes(readFileSync(runnerPath)) : undefined;
    let status;
    if (existingSha256 === sourceSha256) {
        status = 'unchanged';
        unchanged.push('atm.mjs');
    }
    else if (existingSha256 && !force) {
        status = 'skipped-existing-different';
        unchanged.push('atm.mjs');
    }
    else {
        mkdirSync(path.dirname(runnerPath), { recursive: true });
        copyFileSync(source.path, runnerPath);
        syncExecutableMode(source.path, runnerPath);
        status = existingSha256 ? 'replaced' : 'installed';
        created.push('atm.mjs');
    }
    const metadata = {
        schemaVersion: 'atm.pinnedRunner.v0.1',
        runnerPath: 'atm.mjs',
        metadataPath: metadataRelativePath,
        command: 'node atm.mjs next --prompt "<current user prompt>" --json',
        status,
        sourceKind: source.kind,
        sourcePath: describePinnedRunnerSource(source),
        sha256: sourceSha256,
        existingSha256,
        sizeBytes: sourceStats.size,
        frameworkVersion: '0.0.0',
        generatedAt,
        ...(status === 'skipped-existing-different'
            ? { reason: 'A different root atm.mjs already exists. Re-run bootstrap with --force to replace it with the pinned runner.' }
            : {})
    };
    writeJsonIfChanged(metadataPath, metadata, cwd, created, unchanged);
    return metadata;
}
function resolvePinnedRunnerSource() {
    const explicit = resolveExistingFile(process.env.ATM_PINNED_RUNNER_SOURCE);
    if (explicit) {
        return { path: explicit, kind: 'explicit-env' };
    }
    const onefileLauncher = resolveExistingFile(process.env.ATM_ONEFILE_LAUNCHER_PATH);
    if (onefileLauncher) {
        return { path: onefileLauncher, kind: 'onefile-launcher' };
    }
    const releaseOnefile = resolveExistingFile(path.join(repoRoot, 'release', 'atm-onefile', 'atm.mjs'));
    if (releaseOnefile) {
        return { path: releaseOnefile, kind: 'release-onefile' };
    }
    return null;
}
function resolveExistingFile(filePath) {
    if (!filePath) {
        return null;
    }
    const resolved = path.resolve(filePath);
    if (!existsSync(resolved)) {
        return null;
    }
    return statSync(resolved).isFile() ? resolved : null;
}
function sha256Bytes(value) {
    return createHash('sha256').update(value).digest('hex');
}
function syncExecutableMode(sourcePath, targetPath) {
    if (process.platform === 'win32') {
        return;
    }
    try {
        chmodSync(targetPath, statSync(sourcePath).mode & 0o777);
    }
    catch {
        // Ignore mode sync failures; the runner is still invokable through `node atm.mjs`.
    }
}
function describePinnedRunnerSource(source) {
    if (source.kind === 'onefile-launcher') {
        return 'ATM_ONEFILE_LAUNCHER_PATH';
    }
    if (source.kind === 'explicit-env') {
        return 'ATM_PINNED_RUNNER_SOURCE';
    }
    const relative = path.relative(repoRoot, source.path).replace(/\\/g, '/');
    return relative.startsWith('..') ? source.path : relative;
}
function writeJsonIfChanged(targetPath, value, cwd, created, unchanged) {
    const next = `${JSON.stringify(value, null, 2)}\n`;
    const relativePath = relativePathFrom(cwd, targetPath);
    if (existsSync(targetPath) && readFileSync(targetPath, 'utf8') === next) {
        unchanged.push(relativePath);
        return;
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, next, 'utf8');
    created.push(relativePath);
}
function readPinnedRunnerGeneratedAt(metadataPath) {
    if (!existsSync(metadataPath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(readFileSync(metadataPath, 'utf8'));
        return typeof parsed?.generatedAt === 'string' && parsed.generatedAt.length > 0 ? parsed.generatedAt : null;
    }
    catch {
        return null;
    }
}
function writeTemplate(sourcePath, targetPath, tokens, cwd, force, created, unchanged) {
    const rendered = renderTemplate(readFileSync(sourcePath, 'utf8'), tokens);
    writeText(targetPath, rendered, cwd, force, created, unchanged);
}
function writeAgentInstructionsTemplate(sourcePath, targetPath, tokens, cwd, force, created, unchanged) {
    const rendered = renderTemplate(readFileSync(sourcePath, 'utf8'), tokens);
    if (!existsSync(targetPath)) {
        writeText(targetPath, rendered, cwd, force, created, unchanged);
        return;
    }
    patchManagedRootEntry({
        targetPath,
        cwd,
        force,
        created,
        unchanged,
        startMarker: rootAgentsEntryStart,
        endMarker: rootAgentsEntryEnd,
        block: createAgentsRootEntryBlock(tokens),
        insertion: 'after-frontmatter'
    });
}
function patchReadmeEntry(targetPath, cwd, force, created, unchanged) {
    if (!existsSync(targetPath)) {
        return;
    }
    patchManagedRootEntry({
        targetPath,
        cwd,
        force,
        created,
        unchanged,
        startMarker: rootReadmeEntryStart,
        endMarker: rootReadmeEntryEnd,
        block: createReadmeRootEntryBlock(),
        insertion: 'after-title'
    });
}
function createAgentsRootEntryBlock(tokens) {
    return [
        rootAgentsEntryStart,
        '',
        '## ATM Governance Entry',
        '',
        'Read the repository root README.md for project context, then run:',
        '',
        '```bash',
        'node atm.mjs next --prompt "<current user prompt>" --json',
        '```',
        '',
        'First-contact behavior:',
        '',
        '1. For user-requested task work, run `node atm.mjs next --prompt "<current user prompt>" --json`; use `node atm.mjs next --json` only as read-only orientation when no user prompt is available.',
        '2. If the ATM result returns an `ATM_USER_NOTICE` message or `evidence.userNotice`, show that notice to the user in natural language before running the returned next action.',
        '3. If existing host instructions reference a missing local document, mention the missing file once and continue with the ATM route.',
        '4. After an onboarding or refresh command succeeds, return to the user original request and continue the actual work.',
        '',
        'Editor integration self-check:',
        '',
        '1. If `.atm/config.json` exists, confirm this editor already has its repo-local ATM entry files before trusting ATM skill routing.',
        '2. If the current editor entry file is missing, install the matching adapter immediately with `node atm.mjs integration add <editor-id> --json`, then verify it with `node atm.mjs integration verify <editor-id> --json`.',
        '3. Expected primary entry files:',
        '   - `codex`: `integrations/codex-skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add codex --json`',
        '   - `claude-code`: `.claude/skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add claude-code --json`',
        '   - `cursor`: `.cursor/rules/skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add cursor --json`',
        '   - `copilot`: `.github/instructions/atm-governance-router.instructions.md` via `node atm.mjs integration add copilot --json`',
        '   - `gemini`: `.gemini/commands/atm-governance-router.toml` via `node atm.mjs integration add gemini --json`',
        '   - `antigravity`: `GEMINI.md` via `node atm.mjs integration add antigravity --json`',
        '4. Google-side coverage has two entry shapes: `gemini` installs Gemini CLI command files under `.gemini/commands`, while `antigravity` installs the Antigravity editor entry `GEMINI.md` and `.agents/skills`. If the current Google editor is Antigravity, verify/install `antigravity`, not only `gemini`.',
        '',
        'Python-only runtime self-check:',
        '',
        '1. If the project probe reports Python without JavaScript or TypeScript, candidate ranking and source inventory can continue, but atom birth/apply must not be described as ready until a Python runtime/language adapter or plugin has been selected.',
        '2. If this ATM release does not bundle a dedicated Python language adapter/plugin, say that explicitly. Treat it as an expected product gap, not as host-repo corruption.',
        '3. In that case, continue with ATM discovery routes such as candidate ranking, source inventory, police evidence, or docs-first work, and tell the user that Python atom birth/apply remains deferred until a Python adapter/plugin is installed or implemented.',
        '',
        'Treat these ATM runtime files as supporting state only:',
        '',
        `- ${tokens.BOOTSTRAP_TASK_PATH}`,
        `- ${tokens.BOOTSTRAP_PROFILE_PATH}`,
        `- ${tokens.BOOTSTRAP_EVIDENCE_PATH}`,
        '',
        rootAgentsEntryEnd
    ].join('\n');
}
function createReadmeRootEntryBlock() {
    return [
        rootReadmeEntryStart,
        '',
        '## AI Agent Entry',
        '',
        'After reading this repository overview, run:',
        '',
        '```bash',
        'node atm.mjs next --prompt "<current user prompt>" --json',
        '```',
        '',
        'Use `node atm.mjs next --json` only as read-only orientation when no user prompt is available. If the result includes an `ATM_USER_NOTICE` message or `evidence.userNotice`, show it to the user in natural language before running the returned next action.',
        '',
        'After an onboarding or refresh command succeeds, return to the user original request and continue the actual work.',
        '',
        rootReadmeEntryEnd
    ].join('\n');
}
function patchManagedRootEntry(input) {
    const current = readFileSync(input.targetPath, 'utf8');
    const normalizedBlock = normalizeTextBlock(input.block);
    const next = upsertManagedRootEntryBlock(current, normalizedBlock, input.startMarker, input.endMarker, input.insertion, input.force);
    const relativePath = relativePathFrom(input.cwd, input.targetPath);
    if (next === current) {
        input.unchanged.push(relativePath);
        return;
    }
    mkdirSync(path.dirname(input.targetPath), { recursive: true });
    writeFileSync(input.targetPath, next, 'utf8');
    input.created.push(relativePath);
}
function upsertManagedRootEntryBlock(current, block, startMarker, endMarker, insertion, force) {
    const existingPattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\r?\\n?`, 'm');
    const lineBreak = detectTrailingNewline(current);
    const formattedBlock = block.replace(/\n/g, lineBreak);
    if (existingPattern.test(current)) {
        return current.replace(existingPattern, `${formattedBlock}${lineBreak}`);
    }
    if (current.includes('node atm.mjs next --prompt "<current user prompt>" --json') && !force) {
        return current;
    }
    const insertionIndex = findRootEntryInsertionIndex(current, insertion);
    const prefix = current.slice(0, insertionIndex).replace(/[ \t]+$/u, '');
    const suffix = current.slice(insertionIndex).replace(/^\r?\n/u, '');
    if (prefix.length === 0) {
        return `${formattedBlock}${lineBreak}${lineBreak}${suffix}`;
    }
    return `${prefix}${lineBreak}${lineBreak}${formattedBlock}${lineBreak}${lineBreak}${suffix}`;
}
function findRootEntryInsertionIndex(current, insertion) {
    if (insertion === 'after-frontmatter') {
        const frontmatterMatch = current.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
        if (frontmatterMatch) {
            return frontmatterMatch[0].length;
        }
        return 0;
    }
    const titleMatch = current.match(/^# .*(?:\r?\n|$)/m);
    if (titleMatch && typeof titleMatch.index === 'number') {
        return titleMatch.index + titleMatch[0].length;
    }
    return 0;
}
function normalizeTextBlock(value) {
    return value.trim().replace(/\r\n/g, '\n');
}
function detectTrailingNewline(value) {
    return value.includes('\r\n') ? '\r\n' : '\n';
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function writeRootDropScripts(cwd, force, created, unchanged) {
    for (const scriptFile of rootDropScriptTemplateFiles) {
        writeTemplate(path.join(templateRoot, scriptFile.source), path.join(cwd, scriptFile.target), {}, cwd, force, created, unchanged);
    }
}
function writeJson(targetPath, value, cwd, force, created, unchanged) {
    if (existsSync(targetPath) && !force) {
        unchanged.push(relativePathFrom(cwd, targetPath));
        return;
    }
    writeJsonFile(targetPath, value);
    created.push(relativePathFrom(cwd, targetPath));
}
function writeText(targetPath, value, cwd, force, created, unchanged) {
    if (existsSync(targetPath) && !force) {
        unchanged.push(relativePathFrom(cwd, targetPath));
        return;
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, value, 'utf8');
    created.push(relativePathFrom(cwd, targetPath));
}
function renderTemplate(template, tokens) {
    let rendered = stripTemplateHeader(template);
    for (const [token, value] of Object.entries(tokens)) {
        rendered = rendered.replaceAll(`{{${token}}}`, value);
    }
    return rendered;
}
function stripTemplateHeader(template) {
    return template.replace(/^\s*<!--\s*ATM TEMPLATE:[\s\S]*?-->\s*/i, '');
}
function capabilityResult(text, artifacts = [], evidence = []) {
    return {
        ok: true,
        messages: [text],
        artifacts,
        evidence
    };
}
function resolveRepoPath(repositoryRoot, filePath) {
    return path.resolve(repositoryRoot, filePath);
}
function relativePathFrom(basePath, absolutePath) {
    return path.relative(basePath, absolutePath).replace(/\\/g, '/');
}
function normalizeRelativePath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}
function writeJsonFile(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function readJsonFile(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
function readUnknownFile(filePath) {
    if (filePath.endsWith('.json')) {
        return readJsonFile(filePath);
    }
    return readFileSync(filePath, 'utf8');
}
function writeUnknownFile(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (typeof value === 'string') {
        writeFileSync(filePath, value, 'utf8');
        return;
    }
    writeJsonFile(filePath, value);
}
function withJsonExtension(name) {
    return name.endsWith('.json') ? name : `${name}.json`;
}
function appendManifestRecord(filePath, record) {
    const manifest = readManifestRecords(filePath).filter((entry) => entry.artifactPath !== record.artifactPath);
    manifest.push(record);
    writeJsonFile(filePath, manifest);
}
function readManifestRecords(filePath) {
    if (!existsSync(filePath)) {
        return [];
    }
    const parsed = readJsonFile(filePath);
    return Array.isArray(parsed) ? parsed : [];
}
function writeContentFile(filePath, content) {
    if (typeof content === 'string') {
        writeFileSync(filePath, content, 'utf8');
        return;
    }
    writeFileSync(filePath, content);
}
function readDocumentIndex(documentIndexPath) {
    const filePath = path.join(documentIndexPath, 'documents.json');
    if (!existsSync(filePath)) {
        return [];
    }
    const parsed = readJsonFile(filePath);
    return Array.isArray(parsed) ? parsed : [];
}
function listFilesRecursive(directoryPath) {
    if (!existsSync(directoryPath)) {
        return [];
    }
    const results = [];
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...listFilesRecursive(absolutePath));
            continue;
        }
        if (entry.isFile()) {
            results.push(absolutePath);
        }
    }
    return results.sort((left, right) => left.localeCompare(right));
}
function readEvidenceDocument(filePath) {
    if (!existsSync(filePath)) {
        return { wrapper: null, evidence: [] };
    }
    const parsed = readJsonFile(filePath);
    if (Array.isArray(parsed)) {
        return { wrapper: null, evidence: parsed };
    }
    if (parsed && typeof parsed === 'object') {
        const wrapper = parsed;
        if (Array.isArray(wrapper.evidence)) {
            return { wrapper, evidence: wrapper.evidence };
        }
        if (isEvidenceRecord(wrapper)) {
            return { wrapper: null, evidence: [wrapper] };
        }
        return { wrapper, evidence: [] };
    }
    return { wrapper: null, evidence: [] };
}
function readEvidenceRecords(filePath) {
    return readEvidenceDocument(filePath).evidence;
}
function isEvidenceRecord(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    return typeof candidate.evidenceKind === 'string'
        && typeof candidate.summary === 'string'
        && Array.isArray(candidate.artifactPaths);
}
function normalizeWorkItem(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value;
    const workItemId = String(candidate.workItemId ?? candidate.id ?? candidate.taskId ?? '').trim();
    const title = String(candidate.title ?? '').trim();
    const status = String(candidate.status ?? '').trim();
    if (!workItemId || !title || !status) {
        return null;
    }
    return {
        workItemId,
        title,
        status: status
    };
}
function createEmptyRegistry(timestamp) {
    return {
        schemaId: 'atm.registry',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Local governance registry initialized.'
        },
        registryId: 'ATM-LOCAL-REGISTRY',
        generatedAt: timestamp,
        entries: []
    };
}
