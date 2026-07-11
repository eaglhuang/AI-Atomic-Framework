// TASK-RFT-0012: extracted verbatim from packages/cli/src/commands/tasks.ts.
// The body of runTasksImport lives here; tasks.ts router re-exports it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { CliError, makeResult, message, relativePathFrom } from '../shared.js';
import { readPluginRegistry } from '../../plugin-registry.js';
import { toStoredPlanningPath, resolvePlanAbsoluteFromStored } from '../planning-repo-root.js';
import { assertRunnerFreshForWriteAction } from '../framework-development.js';
import { assertEmergencyApproval } from '../emergency/gate.js';
import { validateDeliverablesList } from './task-import-validators.js';
import { classifyResetOpenImportForOptions, collectActiveClaimImportSkips, detectPlanHeadings, enrichParsedTasksFromSiblingTaskCards, parseImportOptions, parseSingleCardFromPlugin, parsePlanMarkdown, writeImportEvidence, writeTaskFiles, assertLocalTaskLedgerEnabled, recordStaleRunnerOverride } from '../tasks.js';
export async function runTasksImport(argv) {
    const options = parseImportOptions(argv);
    if (!options.from) {
        throw new CliError('ATM_CLI_USAGE', 'tasks import requires --from <plan.md>.', { exitCode: 2 });
    }
    if (options.dryRun === options.write) {
        throw new CliError('ATM_CLI_USAGE', 'tasks import requires exactly one of --dry-run or --write.', { exitCode: 2 });
    }
    if (options.reconcileMirror && !options.write) {
        throw new CliError('ATM_CLI_USAGE', 'tasks import --reconcile-mirror requires --write.', { exitCode: 2 });
    }
    if (options.reconcileMirror && (options.force || options.forceOverwriteClaims || options.resetOpen || options.reopen)) {
        throw new CliError('ATM_CLI_USAGE', 'tasks import --reconcile-mirror cannot be combined with --force, --force-overwrite-claims, --reset-open, or --reopen.', { exitCode: 2 });
    }
    // TASK-RFT-0011 — reset-open UX classification.
    // The historical behavior: any use of `--reset-open` on a `--write` import
    // triggered `ATM_EMERGENCY_LANE_APPROVAL_REQUIRED`. In the normal
    // Phase 0 → Phase 1 handoff the planning card is marked `in-progress` but no
    // runtime ledger yet exists — reset-open is a harmless no-op there. We peek
    // at the plan + runtime ledger, classify, and only require emergency approval
    // when the reset would actually clobber active state.
    let resetOpenClassification = null;
    if (options.write && options.resetOpen) {
        resetOpenClassification = classifyResetOpenImportForOptions(options);
    }
    const resetOpenNeedsEmergency = options.resetOpen && (resetOpenClassification?.resetOpenEmergencyRequired ?? true);
    const importEmergencyRequired = options.write && (options.force
        || options.forceOverwriteClaims
        || resetOpenNeedsEmergency
        || options.allowStaleRunner);
    let emergencyUse = null;
    if (importEmergencyRequired) {
        emergencyUse = assertEmergencyApproval({
            cwd: options.cwd,
            surface: 'tasks import --write recovery flags',
            permission: 'backend.tasks.import.write',
            taskId: options.from.match(/TASK-[A-Z]+-\d+/i)?.[0] ?? null,
            actorId: null,
            emergencyApproval: options.emergencyApproval,
            flags: [
                ...(options.force ? ['--force'] : []),
                ...(options.forceOverwriteClaims ? ['--force-overwrite-claims'] : []),
                ...(resetOpenNeedsEmergency ? ['--reset-open'] : []),
                ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
            ],
            reason: 'Direct task runtime import backend write.',
            command: `node atm.mjs tasks import --from ${options.from} --write --json`
        });
    }
    if (options.write) {
        const staleGate = assertRunnerFreshForWriteAction({
            cwd: options.cwd,
            action: 'tasks-import-write',
            allowStaleRunner: options.allowStaleRunner
        });
        if (options.allowStaleRunner && staleGate.warning) {
            const importTaskId = options.from.match(/TASK-[A-Z]+-\d+/i)?.[0] ?? 'import-batch';
            await recordStaleRunnerOverride({
                cwd: options.cwd,
                taskId: importTaskId,
                actorId: null,
                action: 'tasks-import-write',
                command: `node atm.mjs tasks import --from ${options.from} --write --allow-stale-runner --json`
            });
        }
    }
    const planAbsolute = resolvePlanAbsoluteFromStored(options.cwd, options.from);
    if (!existsSync(planAbsolute) || !statSync(planAbsolute).isFile()) {
        throw new CliError('ATM_TASKS_PLAN_NOT_FOUND', `Plan markdown file not found: ${options.from}`, {
            exitCode: 2,
            details: { planPath: options.from }
        });
    }
    const planText = readFileSync(planAbsolute, 'utf8');
    const generatedAt = new Date().toISOString();
    let parsed = null;
    const plugins = await readPluginRegistry(options.cwd);
    const enabledPlugin = plugins.find(p => p.mode !== 'disabled');
    if (enabledPlugin) {
        const { plugin, mode } = enabledPlugin;
        try {
            const input = {
                cwd: options.cwd,
                sourcePath: toStoredPlanningPath(options.cwd, planAbsolute),
                raw: planText
            };
            if (typeof plugin.parse === 'function') {
                const parsedTask = await plugin.parse(input);
                if (parsedTask) {
                    const record = parseSingleCardFromPlugin(parsedTask, generatedAt);
                    parsed = {
                        tasks: [record],
                        diagnostics: []
                    };
                }
            }
        }
        catch (err) {
            if (mode === 'enforce') {
                throw new CliError('ATM_PLUGIN_ERROR', `Plugin ${plugin.id} parse failed: ${err instanceof Error ? err.message : err}`, { exitCode: 1 });
            }
            else {
                console.warn(`[tasks:import] Warning: Plugin ${plugin.id} parse failed. Falling back to hardcoded parser:`, err);
            }
        }
    }
    if (!parsed) {
        parsed = parsePlanMarkdown({
            planText,
            planRelativePath: toStoredPlanningPath(options.cwd, planAbsolute),
            importedAt: generatedAt
        });
    }
    parsed = enrichParsedTasksFromSiblingTaskCards({
        cwd: options.cwd,
        planAbsolute,
        parsed,
        importedAt: generatedAt
    });
    if (parsed.diagnostics.some((entry) => entry.level === 'error') || parsed.tasks.length === 0) {
        if (parsed.tasks.length === 0) {
            parsed.diagnostics.push({
                level: 'error',
                code: 'ATM_TASKS_PLAN_EMPTY',
                text: 'No task cards were detected in the plan markdown. Each task must be introduced by a TASK-... heading, YAML front matter, a task table, or a labeled Chinese task block.'
            });
            parsed.diagnostics.push({
                level: 'info',
                code: 'ATM_TASKS_PLAN_EXPECTED_PATTERNS',
                text: 'Supported examples: ## SANGUO-BOOTSTRAP-0101 Title; TaskID: SANGUO-BOOTSTRAP-0101; table columns task/title/milestone/status/dependencies/deliverables.'
            });
            for (const heading of detectPlanHeadings(planText).slice(0, 8)) {
                parsed.diagnostics.push({
                    level: 'info',
                    code: 'ATM_TASKS_PLAN_DETECTED_HEADING',
                    text: heading.text,
                    sourceLine: heading.line
                });
            }
        }
        throw new CliError('ATM_TASKS_PLAN_PARSE_FAILED', 'Task plan import failed before writing any tasks.', {
            exitCode: 1,
            details: {
                diagnostics: parsed.diagnostics,
                planPath: relativePathFrom(options.cwd, planAbsolute)
            }
        });
    }
    const writtenPaths = [];
    let evidencePath = null;
    // TASK-AAO-0064 L1 #4: strict path 驗證
    // 收集所有 parsed tasks 的 deliverables，執行啟發式路徑污染檢測
    const strictPathViolations = [];
    for (const task of parsed.tasks) {
        const violations = validateDeliverablesList(task.deliverables ?? [], options.strictPaths);
        for (const violation of violations) {
            strictPathViolations.push({ taskId: task.workItemId, ...violation });
        }
    }
    if (strictPathViolations.length > 0) {
        if (options.strictPaths) {
            // strict mode → ok=false，回傳 STRICT_PATH_VIOLATION error
            throw new CliError('STRICT_PATH_VIOLATION', 'tasks import --strict-paths detected contaminated deliverable paths.', {
                exitCode: 1,
                details: {
                    violations: strictPathViolations,
                    planPath: relativePathFrom(options.cwd, planAbsolute)
                }
            });
        }
        // 非 strict → 加 warning diagnostics，繼續執行
        for (const violation of strictPathViolations) {
            parsed.diagnostics.push({
                level: 'warning',
                code: 'STRICT_PATH_VIOLATION',
                text: `Task ${violation.taskId}: deliverable entry "${violation.entry}" matched strict-path heuristic (${violation.reason}). Use --strict-paths to escalate to error.`,
                workItemId: violation.taskId
            });
        }
    }
    if (options.write) {
        assertLocalTaskLedgerEnabled(options.cwd, 'import --write');
        const result = writeTaskFiles({
            cwd: options.cwd,
            tasks: parsed.tasks,
            force: options.force,
            forceOverwriteClaims: options.forceOverwriteClaims,
            resetOpen: options.resetOpen,
            reopen: options.reopen,
            reconcileMirror: options.reconcileMirror
        });
        writtenPaths.push(...result.writtenPaths);
        parsed.diagnostics.push(...result.diagnostics);
        if (result.diagnostics.some((entry) => entry.level === 'error')) {
            throw new CliError('ATM_TASKS_IMPORT_WRITE_FAILED', 'Task plan import refused to write because of conflicts.', {
                exitCode: 1,
                details: {
                    diagnostics: result.diagnostics,
                    writtenPaths: result.writtenPaths
                }
            });
        }
        evidencePath = writeImportEvidence({
            cwd: options.cwd,
            tasks: parsed.tasks,
            planPath: toStoredPlanningPath(options.cwd, planAbsolute),
            generatedAt,
            writtenPaths
        });
    }
    const activeClaimSkips = collectActiveClaimImportSkips(options.cwd, parsed.tasks, {
        force: options.force,
        forceOverwriteClaims: options.forceOverwriteClaims,
        resetOpen: options.resetOpen,
        reopen: options.reopen,
        reconcileMirror: options.reconcileMirror
    });
    parsed.diagnostics.push(...activeClaimSkips);
    const manifest = {
        schemaId: 'atm.taskImportManifest',
        specVersion: '0.1.0',
        generatedAt,
        planPath: toStoredPlanningPath(options.cwd, planAbsolute),
        mode: options.dryRun ? 'dry-run' : 'write',
        tasks: parsed.tasks,
        diagnostics: parsed.diagnostics,
        writtenPaths,
        evidencePath
    };
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('info', options.dryRun ? 'ATM_TASKS_IMPORT_DRY_RUN' : 'ATM_TASKS_IMPORT_WRITE_READY', options.dryRun
                ? `Parsed ${parsed.tasks.length} task(s) from plan; no files were written.`
                : `Wrote ${writtenPaths.length} task file(s) and import evidence.`, { tasks: parsed.tasks.length, mode: manifest.mode })
        ],
        evidence: {
            manifest,
            planPath: manifest.planPath,
            writtenPaths,
            evidencePath,
            emergencyUse
        }
    });
}
