import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { resolveActorId } from './actor-registry.js';
import { resolveActorWorkSession } from './actor-session.js';
import { createFrameworkModeStatus } from './framework-development.js';
import { CliError, makeResult, message, relativePathFrom } from './shared.js';
import { gitHeadEvidencePath } from './git-head-evidence.js';
import { generateDiffEvidence, mergeDiffEvidenceWithExisting, validateDiffEvidence } from '../../../core/dist/evidence/diff-evidence.js';
export async function runEvidence(argv) {
    const action = (argv[0] ?? '').toLowerCase();
    if (action === 'add') {
        return runEvidenceAdd(argv.slice(1));
    }
    if (action === 'run') {
        return runEvidenceRun(argv.slice(1));
    }
    if (action === 'git-head-backfill') {
        return runGitHeadEvidenceBackfill(argv.slice(1));
    }
    if (action === 'verify') {
        return runEvidenceVerify(argv.slice(1));
    }
    if (action === 'diff') {
        return runEvidenceDiff(argv.slice(1));
    }
    if (action === 'validators') {
        return runEvidenceValidators(argv.slice(1));
    }
    if (action === 'missing') {
        return runEvidenceMissing(argv.slice(1));
    }
    throw new CliError('ATM_CLI_USAGE', 'evidence supports: add, run, git-head-backfill, verify, diff, validators, missing', { exitCode: 2 });
}
/**
 * 將 task card 裡的 validator 字串正規化成 gate 名稱。
 * 例如 "npm run typecheck" → "typecheck"
 *       "npm run validate:cli" → "validate:cli"
 */
function normalizeValidatorGateName(raw) {
    // "npm run <gate>" → "<gate>"
    const npmMatch = raw.match(/^npm run (.+)$/);
    if (npmMatch)
        return npmMatch[1].trim();
    // "node --strip-types scripts/validate-<name>.ts --mode validate" → "validate:<name>"
    const nodeScriptMatch = raw.match(/validate-([a-z0-9-]+)\.ts/);
    if (nodeScriptMatch)
        return `validate:${nodeScriptMatch[1]}`;
    // 已是 gate 名稱
    return raw;
}
/** 依 gate 名稱歸類 tier */
function classifyValidatorTier(gate) {
    // Release gates — 只有 release 類 task 才需要重跑
    if (gate === 'validate:integration-adapter' ||
        gate === 'validate:skill-templates' ||
        gate === 'validate:root-drop-release' ||
        gate === 'validate:onefile-release') {
        return 'release';
    }
    // Focused — 每次任務必須跑的核心 validator
    if (gate === 'typecheck' || gate === 'validate:cli' || gate === 'validate:git-head-evidence') {
        return 'focused';
    }
    // 其他 validate: 前綴 — 視為 focused
    if (gate.startsWith('validate:')) {
        return 'focused';
    }
    // 其餘 framework 健康 gate — 可 batch 重用
    return 'batch';
}
/**
 * TASK-AAO-0017 follow-up：判斷一個 validator 是否為 closure-required（會阻擋 tasks close）。
 * - focused tier：typecheck、validate:cli、validate:* 等每次 task 必須重跑的 gate
 * - release tier：只有 release 變更會出現的 gate（已動態加入 requiredGates）
 * - batch tier：framework 健康類 advisory gate（doctor、framework-development、
 *   tasks-audit、git-head-evidence），不應被 evidence missing 當作 hard block
 * - task card 顯式宣告的 validator 一律視為 closure-required
 */
function isClosureRequiredValidator(gate, taskDeclaredValidators) {
    if (taskDeclaredValidators.includes(gate))
        return true;
    const tier = classifyValidatorTier(gate);
    return tier === 'focused' || tier === 'release';
}
/** 依 gate 名稱回傳對應的執行指令（human-readable 提示用） */
function resolveValidatorExpectedCommand(gate) {
    if (gate === 'typecheck')
        return 'npm run typecheck';
    if (gate === 'git diff --check')
        return 'git diff --check';
    if (gate.startsWith('validate:'))
        return `npm run ${gate}`;
    if (gate === 'framework-development')
        return 'node atm.mjs next --json';
    if (gate === 'tasks-audit')
        return 'node atm.mjs tasks audit --json';
    if (gate === 'doctor')
        return 'node atm.mjs doctor --json';
    if (gate === 'git-head-evidence')
        return 'node atm.mjs evidence git-head-backfill --actor <actor> --json';
    return `node atm.mjs ${gate} --json`;
}
/** evidence validators --list --task <id> 的執行邏輯 */
function runEvidenceValidators(argv) {
    let cwd = process.cwd();
    let taskId = null;
    let list = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--cwd') {
            cwd = requireValue(argv, i, '--cwd');
            i++;
            continue;
        }
        if (arg === '--task') {
            taskId = requireValue(argv, i, '--task');
            i++;
            continue;
        }
        if (arg === '--list') {
            list = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `evidence validators does not support option ${arg}`, { exitCode: 2 });
    }
    if (!list) {
        throw new CliError('ATM_CLI_USAGE', 'evidence validators requires --list', { exitCode: 2 });
    }
    if (!taskId) {
        throw new CliError('ATM_CLI_USAGE', 'evidence validators --list requires --task <work-item-id>', { exitCode: 2 });
    }
    const resolvedCwd = path.resolve(cwd);
    const resolvedTaskId = taskId.trim();
    // 1. 取得 framework 必要 gates（由 criticalChangedFiles 動態決定）
    const frameworkStatus = createFrameworkModeStatus({ cwd: resolvedCwd });
    const frameworkGates = frameworkStatus.requiredGates;
    // 2. 取得 task card 宣告的 validators（由 tasks import 時寫入 ledger）
    // task card 裡常以完整命令字串表示（如 "npm run typecheck"），需正規化成 gate 名稱
    const taskDocument = readTaskDocument(resolvedCwd, resolvedTaskId);
    const taskDeclaredValidators = Array.isArray(taskDocument?.validators)
        ? taskDocument.validators
            .filter((v) => typeof v === 'string' && v.trim().length > 0)
            .map((v) => normalizeValidatorGateName(v.trim()))
            .filter(Boolean)
        : [];
    // 3. 讀取 evidence 中已記錄的 validationPasses
    const bundle = readEvidenceBundle(resolvedCwd, resolvedTaskId);
    const recordedPasses = new Set();
    for (const record of bundle.evidence) {
        // top-level validationPasses（部分 legacy 格式）
        if (Array.isArray(record.validationPasses)) {
            for (const v of record.validationPasses) {
                if (typeof v === 'string' && v.trim())
                    recordedPasses.add(v.trim());
            }
        }
        // details.validationPasses（主要格式，由 evidence add 寫入）
        if (record.details && typeof record.details === 'object' && !Array.isArray(record.details)) {
            const d = record.details;
            if (Array.isArray(d.validationPasses)) {
                for (const v of d.validationPasses) {
                    if (typeof v === 'string' && v.trim())
                        recordedPasses.add(v.trim());
                }
            }
        }
    }
    // 4. 合併 framework gates 與 task 宣告 validators，去重後排序
    const allGates = uniqueStrings([...frameworkGates, ...taskDeclaredValidators]);
    // 5. 建立 validator catalog
    const catalog = allGates.map((gate) => ({
        name: gate,
        tier: classifyValidatorTier(gate),
        expectedCommand: resolveValidatorExpectedCommand(gate),
        evidenceState: recordedPasses.has(gate) ? 'pass' : 'missing'
    }));
    const passedCount = catalog.filter((v) => v.evidenceState === 'pass').length;
    const missingCount = catalog.filter((v) => v.evidenceState === 'missing').length;
    return makeResult({
        ok: true,
        command: 'evidence',
        cwd: resolvedCwd,
        messages: [
            message('info', 'ATM_EVIDENCE_VALIDATORS_LISTED', `Validator catalog for ${resolvedTaskId}: ${passedCount} passed, ${missingCount} missing.`, {
                taskId: resolvedTaskId,
                total: catalog.length,
                passed: passedCount,
                missing: missingCount
            })
        ],
        evidence: {
            action: 'validators',
            taskId: resolvedTaskId,
            catalog
        }
    });
}
function collectRecordCommandRuns(record) {
    const out = [];
    const top = record.commandRuns;
    if (Array.isArray(top)) {
        for (const r of top)
            if (isRecord(r))
                out.push(r);
    }
    if (isRecord(record.details)) {
        const inner = record.details.commandRuns;
        if (Array.isArray(inner)) {
            for (const r of inner)
                if (isRecord(r))
                    out.push(r);
        }
    }
    return out;
}
function readRecordValidationPasses(record) {
    const passes = new Set();
    const top = record.validationPasses;
    if (Array.isArray(top)) {
        for (const v of top)
            if (typeof v === 'string' && v.trim())
                passes.add(v.trim());
    }
    if (isRecord(record.details)) {
        const inner = record.details.validationPasses;
        if (Array.isArray(inner)) {
            for (const v of inner)
                if (typeof v === 'string' && v.trim())
                    passes.add(v.trim());
        }
    }
    return [...passes];
}
function readRecordFreshness(record) {
    const top = record.evidenceFreshness;
    if (top === 'fresh' || top === 'historical-reference' || top === 'draft')
        return top;
    if (isRecord(record.details)) {
        const inner = record.details.freshness;
        if (inner === 'fresh' || inner === 'historical-reference' || inner === 'draft')
            return inner;
    }
    return 'fresh';
}
function classifyValidatorEvidenceState(bundle, gate) {
    const rank = { pass: 3, stale: 2, 'diagnostic-only': 1 };
    let bestPositive = null;
    let sawFailedRun = false;
    for (const record of bundle) {
        const passes = readRecordValidationPasses(record);
        const commandRuns = collectRecordCommandRuns(record);
        if (passes.includes(gate)) {
            const proof = commandRuns.some((run) => isCommandRunProof(run));
            const freshness = readRecordFreshness(record);
            const state = (freshness === 'fresh' && proof)
                ? 'pass'
                : proof ? 'stale' : 'diagnostic-only';
            if (!bestPositive || rank[state] > rank[bestPositive])
                bestPositive = state;
        }
        for (const run of commandRuns) {
            const runValidators = Array.isArray(run.validators)
                ? (run.validators)
                    .filter((v) => typeof v === 'string')
                    .map((v) => v.trim())
                : [];
            const cmd = typeof run.command === 'string' ? run.command : '';
            const matches = runValidators.includes(gate) || normalizeValidatorGateName(cmd) === gate;
            const exitCode = run.exitCode;
            if (matches && typeof exitCode === 'number' && exitCode !== 0)
                sawFailedRun = true;
        }
    }
    if (bestPositive === 'pass')
        return 'pass';
    if (sawFailedRun)
        return 'failed-run';
    return bestPositive ?? 'absent';
}
function buildMissingValidatorFinding(gate, state, taskId, actor) {
    const expectedCommand = resolveValidatorExpectedCommand(gate);
    const escapedExpected = quoteForShell(expectedCommand);
    const escapedGate = quoteForShell(gate);
    const requiredCommand = `node atm.mjs evidence run --task ${taskId} --actor ${actor} --command ${escapedExpected} --validators ${escapedGate} --json`;
    if (state === 'absent') {
        return {
            code: 'ATM_EVIDENCE_VALIDATOR_ABSENT',
            validator: gate, category: 'absent',
            summary: `No evidence record claims validator '${gate}' passed. Run the validator and capture command-backed evidence.`,
            requiredCommand
        };
    }
    if (state === 'failed-run') {
        return {
            code: 'ATM_EVIDENCE_VALIDATOR_FAILED_RUN',
            validator: gate, category: 'failed-run',
            summary: `Validator '${gate}' has at least one command run with non-zero exit code. Fix the failure and rerun, then add fresh evidence.`,
            requiredCommand
        };
    }
    if (state === 'stale') {
        return {
            code: 'ATM_EVIDENCE_VALIDATOR_STALE',
            validator: gate, category: 'stale',
            summary: `Validator '${gate}' evidence is not fresh (historical-reference or draft). Rerun in this session to refresh.`,
            requiredCommand
        };
    }
    return {
        code: 'ATM_EVIDENCE_VALIDATOR_DIAGNOSTIC_ONLY',
        validator: gate, category: 'diagnostic-only',
        summary: `Validator '${gate}' evidence exists but lacks command-backed proof (stdout/stderr sha256 + exit code). Rerun via evidence run to attach a proof.`,
        requiredCommand
    };
}
/**
 * TASK-AAO-0017: 計算缺失 validator 報告，可被 tasks close / batch checkpoint 的錯誤訊息引用，
 * 也可獨立供 `evidence missing` 子命令呼叫。
 */
export function computeMissingValidatorReport(cwd, taskId, actorId) {
    const resolvedCwd = path.resolve(cwd);
    const resolvedTaskId = taskId.trim();
    // 1. 取得 framework 必要 gates
    const frameworkStatus = createFrameworkModeStatus({ cwd: resolvedCwd });
    const frameworkGates = frameworkStatus.requiredGates;
    // 2. 取得 task card 宣告的 validators
    const taskDocument = readTaskDocument(resolvedCwd, resolvedTaskId);
    const taskDeclaredValidators = Array.isArray(taskDocument?.validators)
        ? taskDocument.validators
            .filter((v) => typeof v === 'string' && v.trim().length > 0)
            .map((v) => normalizeValidatorGateName(v.trim()))
            .filter(Boolean)
        : [];
    // 3. 合併並去重
    const allGates = uniqueStrings([...frameworkGates, ...taskDeclaredValidators]);
    // 4. 讀取 evidence bundle
    const bundle = readEvidenceBundle(resolvedCwd, resolvedTaskId);
    const bundleRecords = bundle.evidence.map((r) => isRecord(r) ? r : {});
    // 5. 分類每個 gate 的 evidence 狀態
    // TASK-AAO-0017 follow-up：closure-required 與 advisory 分開計算，
    // batch-tier framework 健康類 gate 為 advisory，缺失不應阻擋 close。
    const absent = [];
    const failedRun = [];
    const stale = [];
    const diagnosticOnly = [];
    const requiredFindings = [];
    const advisoryFindings = [];
    const catalogEntries = [];
    for (const gate of allGates) {
        const state = classifyValidatorEvidenceState(bundleRecords, gate);
        const tier = classifyValidatorTier(gate);
        const closureRequired = isClosureRequiredValidator(gate, taskDeclaredValidators);
        catalogEntries.push({
            name: gate,
            tier,
            closureRequired,
            expectedCommand: resolveValidatorExpectedCommand(gate),
            evidenceState: state
        });
        if (state !== 'pass') {
            const finding = buildMissingValidatorFinding(gate, state, resolvedTaskId, actorId);
            if (closureRequired) {
                requiredFindings.push(finding);
                if (state === 'absent')
                    absent.push(gate);
                else if (state === 'failed-run')
                    failedRun.push(gate);
                else if (state === 'stale')
                    stale.push(gate);
                else
                    diagnosticOnly.push(gate);
            }
            else {
                advisoryFindings.push(finding);
            }
        }
    }
    const closureRequiredTotal = catalogEntries.filter((entry) => entry.closureRequired).length;
    const passedCount = closureRequiredTotal - requiredFindings.length;
    const missingCount = requiredFindings.length;
    const ok = missingCount === 0;
    // 6. 人類層 TL;DR
    let tldr;
    if (ok) {
        const adv = advisoryFindings.length > 0
            ? ` (${advisoryFindings.length} advisory framework gate(s) not satisfied; not blocking)`
            : '';
        tldr = `All ${closureRequiredTotal} closure-required validator(s) passed for task ${resolvedTaskId}${adv}.`;
    }
    else {
        const parts = [];
        if (absent.length)
            parts.push(`${absent.length} absent (no evidence): ${absent.join(', ')}`);
        if (failedRun.length)
            parts.push(`${failedRun.length} failed-run: ${failedRun.join(', ')}`);
        if (stale.length)
            parts.push(`${stale.length} stale (historical-reference/draft): ${stale.join(', ')}`);
        if (diagnosticOnly.length)
            parts.push(`${diagnosticOnly.length} diagnostic-only (no command proof): ${diagnosticOnly.join(', ')}`);
        tldr = `Task ${resolvedTaskId} close blocked — ${missingCount}/${closureRequiredTotal} closure-required validator(s) not satisfied. ${parts.join('; ')}.`;
    }
    // 7. blockingFindings = closure-required 中的 absent + failed-run
    //    （stale 和 diagnostic-only 是 closure-required 中的警告，非硬封鎖；advisory 全部排除）
    const blockingFindings = requiredFindings.filter((f) => f.category === 'absent' || f.category === 'failed-run');
    return {
        schemaId: 'atm.missingValidatorReport.v1',
        taskId: resolvedTaskId,
        ok,
        tldr,
        totalRequired: closureRequiredTotal,
        passedCount,
        missingCount,
        categories: { absent, failedRun, stale, diagnosticOnly },
        missingValidationPasses: requiredFindings,
        blockingFindings,
        advisoryFindings,
        validators: catalogEntries
    };
}
/** evidence missing --task <id> --actor <actor> 的執行邏輯 */
function runEvidenceMissing(argv) {
    let cwd = '.';
    let taskId = null;
    let actorId = null;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--cwd') {
            cwd = requireValue(argv, i, '--cwd');
            i++;
            continue;
        }
        if (arg === '--task') {
            taskId = requireValue(argv, i, '--task');
            i++;
            continue;
        }
        if (arg === '--actor') {
            actorId = requireValue(argv, i, '--actor');
            i++;
            continue;
        }
        if (arg === '--json' || arg === '--pretty')
            continue;
        throw new CliError('ATM_CLI_USAGE', `evidence missing does not support option ${arg}`, { exitCode: 2 });
    }
    if (!taskId) {
        throw new CliError('ATM_CLI_USAGE', 'evidence missing requires --task <work-item-id>', { exitCode: 2 });
    }
    const resolvedActor = resolveActorId(actorId ?? undefined, cwd);
    const actor = resolvedActor?.actorId ?? actorId ?? 'unknown';
    const report = computeMissingValidatorReport(cwd, taskId, actor);
    const code = report.ok ? 'ATM_EVIDENCE_VALIDATORS_ALL_PASS' : 'ATM_EVIDENCE_VALIDATORS_MISSING';
    const level = report.ok ? 'info' : 'error';
    return makeResult({
        ok: report.ok,
        command: 'evidence',
        cwd: path.resolve(cwd),
        messages: [
            message(level, code, report.tldr, {
                taskId: report.taskId,
                totalRequired: report.totalRequired,
                passedCount: report.passedCount,
                missingCount: report.missingCount,
                categories: report.categories,
                missingValidationPasses: report.missingValidationPasses,
                blockingFindings: report.blockingFindings,
                advisoryFindings: report.advisoryFindings
            })
        ],
        evidence: {
            action: 'missing',
            ...report
        }
    });
}
/** evidence run --task <id> --command "<cmd>" --recent-run 的執行邏輯 */
function runEvidenceRun(argv) {
    const options = parseEvidenceRunOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'evidence run requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const resolvedCwd = path.resolve(options.cwd);
    const resolvedTaskId = options.taskId.trim();
    // 1. 檢查是否要重用最近一次的執行結果
    let reusedRun = null;
    if (options.recentRun) {
        const bundle = readEvidenceBundle(resolvedCwd, resolvedTaskId);
        const runnerKind = normalizeRunnerKind(options.runnerKind ?? inferRunnerKindFromCommand(options.command));
        // 從最新的 evidence 開始往回找匹配的 command run
        for (let i = bundle.evidence.length - 1; i >= 0; i--) {
            const record = bundle.evidence[i];
            const runs = (isRecord(record.details) && Array.isArray(record.details.commandRuns))
                ? record.details.commandRuns.map(r => normalizeCommandRunInput(r, `evidence[${i}]/commandRuns`))
                : [];
            const match = runs.find(r => r.command === options.command && (r.runnerKind ?? 'unknown') === runnerKind);
            if (match) {
                reusedRun = {
                    ...match,
                    cached: true
                };
                break;
            }
        }
    }
    let finalRun;
    if (reusedRun) {
        finalRun = reusedRun;
    }
    else {
        // 2. 實際執行指令
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', options.command] : ['-c', options.command];
        const result = spawnSync(shell, shellArgs, {
            cwd: resolvedCwd,
            encoding: 'utf8',
            env: { ...process.env, ATM_ACTOR_ID: actorId, ATM_TASK_ID: resolvedTaskId }
        });
        finalRun = {
            command: options.command,
            exitCode: result.status ?? (result.error ? 1 : 0),
            stdoutSha256: hashString(result.stdout ?? ''),
            stderrSha256: hashString(result.stderr ?? ''),
            generatedAt: new Date().toISOString(),
            validators: options.validators
        };
        if (result.error) {
            // 執行發生系統錯誤 (例如找不到指令)
            throw new CliError('ATM_EVIDENCE_RUN_FAILED', `Failed to spawn command: ${options.command}`, {
                exitCode: 1,
                details: { error: result.error.message }
            });
        }
    }
    // 3. 呼叫 evidence add 邏輯 (透過建構 argv 再呼叫 runEvidenceAdd)
    // 這樣可以確保寫入格式、sessionId、git commit 等邏輯一致
    const addArgv = [
        '--task', resolvedTaskId,
        '--actor', actorId,
        '--kind', options.kind,
        '--summary', options.summary ?? (reusedRun ? `Reused cached run for: ${options.command}` : `Auto-run: ${options.command}`),
        '--exit-code', finalRun.exitCode.toString(),
        '--stdout-sha256', finalRun.stdoutSha256,
        '--stderr-sha256', finalRun.stderrSha256,
        '--command', finalRun.command
    ];
    if (options.validators.length > 0) {
        addArgv.push('--validators', options.validators.join(','));
    }
    if (options.artifacts.length > 0) {
        addArgv.push('--artifacts', options.artifacts.join(','));
    }
    if (options.runnerKind) {
        addArgv.push('--runner-kind', options.runnerKind);
    }
    if (reusedRun) {
        addArgv.push('--freshness', 'historical-reference');
    }
    return runEvidenceAdd(addArgv);
}
function parseEvidenceRunOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        command: '',
        recentRun: false,
        kind: 'test',
        summary: null,
        artifacts: [],
        validators: [],
        runnerKind: null
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--cwd') {
            options.cwd = requireValue(argv, i, '--cwd');
            i++;
        }
        else if (arg === '--task') {
            options.taskId = requireValue(argv, i, '--task');
            i++;
        }
        else if (arg === '--actor') {
            options.actorId = requireValue(argv, i, '--actor');
            i++;
        }
        else if (arg === '--command') {
            options.command = requireValue(argv, i, '--command');
            i++;
        }
        else if (arg === '--recent-run') {
            options.recentRun = true;
        }
        else if (arg === '--kind') {
            options.kind = requireValue(argv, i, '--kind');
            i++;
        }
        else if (arg === '--summary') {
            options.summary = requireValue(argv, i, '--summary');
            i++;
        }
        else if (arg === '--artifacts') {
            options.artifacts = requireValue(argv, i, '--artifacts').split(',').map(s => s.trim()).filter(Boolean);
            i++;
        }
        else if (arg === '--validators') {
            options.validators = requireValue(argv, i, '--validators').split(',').map(s => s.trim()).filter(Boolean);
            i++;
        }
        else if (arg === '--runner-kind') {
            options.runnerKind = requireValue(argv, i, '--runner-kind');
            i++;
        }
    }
    if (!options.taskId)
        throw new CliError('ATM_CLI_USAGE', 'evidence run requires --task <id>', { exitCode: 2 });
    if (!options.command)
        throw new CliError('ATM_CLI_USAGE', 'evidence run requires --command "<cmd>"', { exitCode: 2 });
    return options;
}
function hashString(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function runEvidenceDiff(argv) {
    const cwd = process.cwd();
    let taskId;
    let staged = false;
    let from;
    let to;
    let outputPath;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if ((arg === '--task' || arg === '-t') && argv[i + 1]) {
            taskId = argv[++i];
        }
        else if (arg === '--staged') {
            staged = true;
        }
        else if (arg === '--from' && argv[i + 1]) {
            from = argv[++i];
        }
        else if (arg === '--to' && argv[i + 1]) {
            to = argv[++i];
        }
        else if (arg === '--output' && argv[i + 1]) {
            outputPath = argv[++i];
        }
    }
    if (!taskId) {
        throw new CliError('ATM_CLI_USAGE', 'evidence diff requires --task <taskId>', { exitCode: 2 });
    }
    const draft = generateDiffEvidence({ taskId, repositoryRoot: cwd, staged, from, to });
    // Merge with existing if output file already has human-written fields
    const resolvedOutput = outputPath ? path.resolve(cwd, outputPath) : null;
    let finalDraft = draft;
    if (resolvedOutput && existsSync(resolvedOutput)) {
        try {
            const existing = JSON.parse(readFileSync(resolvedOutput, 'utf-8'));
            if (existing.evidenceType === 'diff-as-evidence' && existing.taskId === taskId) {
                finalDraft = mergeDiffEvidenceWithExisting(existing, draft);
            }
        }
        catch {
            // ignore; use fresh draft
        }
    }
    const validation = validateDiffEvidence(finalDraft);
    finalDraft._isValid = validation.valid;
    if (resolvedOutput) {
        mkdirSync(path.dirname(resolvedOutput), { recursive: true });
        writeFileSync(resolvedOutput, JSON.stringify(finalDraft, null, 2) + '\n');
    }
    return makeResult({
        ok: true,
        command: 'evidence',
        cwd,
        messages: [
            message('info', 'ATM_EVIDENCE_DIFF_GENERATED', `Diff evidence draft generated for ${taskId}. ${finalDraft._isValid ? 'Ready to submit.' : 'Fill in intent/impact/testCoverage to validate.'}`, {
                taskId,
                changedFiles: finalDraft.changedFiles.length,
                linesAdded: finalDraft.linesAdded,
                linesDeleted: finalDraft.linesDeleted,
                affectedAtoms: finalDraft.affectedAtoms.length,
                isValid: finalDraft._isValid,
                validationReasons: validation.reasons,
                writtenTo: resolvedOutput ?? null
            })
        ],
        evidence: { draft: finalDraft }
    });
}
export function verifyTaskEvidence(input) {
    const bundle = readEvidenceBundle(input.cwd, input.taskId);
    const canonical = bundle.evidence.map((entry) => canonicalizeEvidenceRecord(entry));
    const counts = {
        test: 0,
        artifact: 0,
        attestation: 0,
        review: 0,
        commit: 0,
        waiver: 0,
        other: 0
    };
    for (const record of canonical) {
        counts[record.kind] += 1;
    }
    const nonWaiver = canonical.filter((record) => record.kind !== 'waiver').length;
    const freshCount = canonical.filter((record) => record.freshness === 'fresh').length;
    const commandRunEvidenceCount = canonical.filter((record) => record.hasCommandRunProof).length;
    const verificationCount = counts.test + counts.artifact + counts.attestation + counts.commit;
    const reopenedRedteamTask = detectReopenedOrRedteamTask(input.taskDocument);
    const codeOrFrameworkTask = Boolean(input.frameworkTask) || detectCodeOrFrameworkTask(input.taskDocument, input.taskDeclaredFiles ?? []);
    const missing = [];
    if (input.gate === 'close') {
        if (nonWaiver <= 0) {
            missing.push('at-least-one-non-waiver-evidence');
        }
        if (reopenedRedteamTask && freshCount <= 0) {
            missing.push('fresh-evidence-required');
        }
        if (codeOrFrameworkTask && counts.artifact === nonWaiver) {
            missing.push('artifact-only-evidence-not-allowed');
        }
        if (codeOrFrameworkTask && (counts.test + counts.commit + counts.attestation + commandRunEvidenceCount) <= 0) {
            missing.push('code-or-framework-runnable-evidence');
        }
    }
    else if (input.gate === 'commit') {
        if (nonWaiver <= 0) {
            missing.push('at-least-one-non-waiver-evidence');
        }
        if (verificationCount <= 0) {
            missing.push('commit-or-verification-evidence');
        }
    }
    else {
        if (counts.review <= 0) {
            missing.push('review-evidence');
        }
        if (verificationCount <= 0) {
            missing.push('verification-evidence');
        }
    }
    return {
        ok: missing.length === 0,
        gate: input.gate,
        total: canonical.length,
        counts,
        freshCount,
        commandRunEvidenceCount,
        reopenedRedteamTask,
        codeOrFrameworkTask,
        missing
    };
}
function runEvidenceAdd(argv) {
    const options = parseEvidenceAddOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'evidence add requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const evidencePath = evidencePathForTask(options.cwd, options.taskId);
    const bundle = readEvidenceBundle(options.cwd, options.taskId);
    const nowIso = new Date().toISOString();
    const kind = normalizeEvidenceKind(options.kind);
    const session = resolveActorWorkSession(options.cwd, {
        actorId,
        taskId: options.taskId,
        includeNonActive: true
    });
    // Auto-link logic for evidence add
    if (options.validators.length === 0 && options.commandRun) {
        const autoVal = detectAutoLinkedValidator(options.commandRun.command);
        if (autoVal) {
            options.validators = [autoVal];
        }
    }
    const commandRuns = normalizeEvidenceCommandRuns({
        cwd: options.cwd,
        inlineRun: options.commandRun ? {
            ...options.commandRun,
            validators: options.validators.length > 0 ? options.validators : undefined
        } : null,
        fileRuns: options.commandRuns,
        runnerKind: options.runnerKind,
        sourceCommit: options.sourceCommit
    });
    const validationPasses = uniqueStrings([
        ...options.validators,
        ...commandRuns.flatMap((run) => Array.isArray(run.validators) ? run.validators : [])
    ]);
    const failedValidationRuns = commandRuns.filter((run) => run.exitCode !== 0 && (validationPasses.length > 0 || (Array.isArray(run.validators) && run.validators.length > 0)));
    if (failedValidationRuns.length > 0) {
        throw new CliError('ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND', 'evidence add refused to record validationPasses from commandRuns with non-zero exitCode.', {
            exitCode: 2,
            details: {
                taskId: options.taskId,
                failedCommands: failedValidationRuns.map((run) => ({
                    command: run.command,
                    exitCode: run.exitCode,
                    validators: run.validators ?? []
                })),
                remediation: 'Record failed commands as failure diagnostics, or rerun the validator successfully before adding validation pass evidence.'
            }
        });
    }
    const commandRunCache = commandRuns.length > 0
        ? {
            schemaId: 'atm.commandRunCache.v1',
            cacheKey: hashJson({
                taskId: options.taskId,
                commandRuns: commandRuns.map((run) => ({
                    command: run.command,
                    cwd: run.cwd ?? '.',
                    exitCode: run.exitCode,
                    stdoutSha256: run.stdoutSha256,
                    stderrSha256: run.stderrSha256,
                    runnerKind: run.runnerKind ?? null,
                    sourceCommit: run.sourceCommit ?? null
                }))
            }),
            reusedRunCount: commandRuns.filter((run) => run.cached === true).length,
            runCount: commandRuns.length,
            sourcePath: options.commandRunsPath ? normalizeRelativePath(relativePathFrom(options.cwd, options.commandRunsPath)) : null
        }
        : null;
    const evidenceRecord = {
        evidenceKind: kind === 'waiver' ? 'waiver' : 'validation',
        evidenceType: kind,
        summary: options.summary ?? `${kind} evidence for ${options.taskId}.`,
        artifactPaths: options.artifacts,
        evidenceFreshness: options.freshness,
        producedBy: actorId,
        sessionId: session?.sessionId ?? null,
        createdAt: nowIso,
        details: {
            actorId,
            sessionId: session?.sessionId ?? null,
            kind,
            freshness: options.freshness,
            ...(validationPasses.length > 0 ? { validationPasses } : {}),
            ...(commandRuns.length > 0 ? { commandRuns } : {}),
            ...(commandRunCache ? { commandRunCache } : {})
        }
    };
    const nextEvidence = [...bundle.evidence, evidenceRecord];
    const envelope = {
        taskId: options.taskId,
        updatedAt: nowIso,
        evidence: nextEvidence
    };
    writeEvidenceEnvelope(evidencePath, envelope);
    return makeResult({
        ok: true,
        command: 'evidence',
        cwd: options.cwd,
        messages: [message('info', 'ATM_EVIDENCE_ADDED', `Added ${kind} evidence for ${options.taskId}.`, {
                taskId: options.taskId,
                actorId,
                sessionId: session?.sessionId ?? null,
                kind
            })],
        evidence: {
            action: 'add',
            taskId: options.taskId,
            actorId,
            kind,
            freshness: options.freshness,
            sessionId: session?.sessionId ?? null,
            evidencePath: relativePathFrom(options.cwd, evidencePath),
            evidenceCount: nextEvidence.length,
            commandRunCount: commandRuns.length,
            commandRunCache
        }
    });
}
function runEvidenceVerify(argv) {
    const options = parseEvidenceVerifyOptions(argv);
    const taskDocument = readTaskDocument(options.cwd, options.taskId);
    const result = verifyTaskEvidence({
        cwd: options.cwd,
        taskId: options.taskId,
        gate: options.gate,
        taskDocument,
        taskDeclaredFiles: extractTaskDeclaredFiles(taskDocument),
        frameworkTask: false
    });
    return makeResult({
        ok: result.ok,
        command: 'evidence',
        cwd: options.cwd,
        messages: [result.ok
                ? message('info', 'ATM_EVIDENCE_VERIFY_OK', `Evidence gate ${result.gate} passed for ${options.taskId}.`, {
                    taskId: options.taskId,
                    gate: result.gate
                })
                : message('error', 'ATM_EVIDENCE_VERIFY_FAILED', `Evidence gate ${result.gate} failed for ${options.taskId}.`, {
                    taskId: options.taskId,
                    gate: result.gate,
                    missing: result.missing
                })],
        evidence: {
            action: 'verify',
            taskId: options.taskId,
            gate: result.gate,
            total: result.total,
            counts: result.counts,
            freshCount: result.freshCount,
            commandRunEvidenceCount: result.commandRunEvidenceCount,
            reopenedRedteamTask: result.reopenedRedteamTask,
            codeOrFrameworkTask: result.codeOrFrameworkTask,
            missing: result.missing,
            evidencePath: relativePathFrom(options.cwd, evidencePathForTask(options.cwd, options.taskId))
        }
    });
}
function runGitHeadEvidenceBackfill(argv) {
    const options = parseGitHeadBackfillOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'evidence git-head-backfill requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const head = runGitScalar(options.cwd, ['rev-parse', '--verify', 'HEAD']);
    if (!head) {
        throw new CliError('ATM_GIT_HEAD_MISSING', 'evidence git-head-backfill requires an existing HEAD commit.', { exitCode: 2 });
    }
    const treeSha = readGovernedCommitTreeWithoutEvidence(options.cwd, head) ?? runGitScalar(options.cwd, ['rev-parse', `${head}^{tree}`]);
    if (!treeSha) {
        throw new CliError('ATM_GIT_TREE_MISSING', 'ATM could not resolve the HEAD tree for git-head evidence backfill.', { exitCode: 2 });
    }
    const nowIso = new Date().toISOString();
    const evidenceAbsolute = path.join(options.cwd, gitHeadEvidencePath);
    const payload = {
        schemaVersion: 'atm.gitHeadEvidence.v0.1',
        evidence: [
            {
                evidenceKind: 'validation',
                evidenceType: 'commit',
                summary: options.summary ?? 'Git HEAD is covered by ATM git-head backfill evidence.',
                artifactPaths: [],
                createdAt: nowIso,
                producedBy: actorId,
                evidenceFreshness: 'fresh',
                commandRuns: [],
                details: {
                    actorId,
                    kind: 'commit',
                    freshness: 'fresh',
                    git: {
                        commitSha: head,
                        treeSha,
                        parentCommitShas: [head],
                        stagedPathCount: 1,
                        evidencePath: gitHeadEvidencePath,
                        generatedAt: nowIso
                    },
                    backfill: {
                        mode: 'head-commit-evidence',
                        coveredCommitSha: head,
                        reason: options.reason ?? 'Backfill git-head evidence for an existing HEAD commit.'
                    }
                }
            }
        ]
    };
    mkdirSync(path.dirname(evidenceAbsolute), { recursive: true });
    appendFileSync(evidenceAbsolute, `${JSON.stringify(payload)}\n`, 'utf8');
    const addResult = runGitCommand(options.cwd, ['add', '--', gitHeadEvidencePath]);
    if (!addResult.ok) {
        throw new CliError('ATM_GIT_ADD_FAILED', 'ATM wrote git-head backfill evidence but could not stage it.', {
            exitCode: 1,
            details: {
                stderr: addResult.stderr || addResult.stdout
            }
        });
    }
    return makeResult({
        ok: true,
        command: 'evidence',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_GIT_HEAD_EVIDENCE_BACKFILLED', 'ATM wrote git-head evidence for the current HEAD. Commit the staged evidence file as the next commit.', {
                actorId,
                commitSha: head,
                treeSha,
                evidencePath: normalizeRelativePath(relativePathFrom(options.cwd, evidenceAbsolute))
            })
        ],
        evidence: {
            action: 'git-head-backfill',
            actorId,
            commitSha: head,
            treeSha,
            evidencePath: normalizeRelativePath(relativePathFrom(options.cwd, evidenceAbsolute))
        }
    });
}
function parseEvidenceAddOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        kind: '',
        summary: null,
        artifacts: [],
        freshness: 'fresh',
        validators: [],
        commandRun: null,
        commandRuns: [],
        commandRunsPath: null,
        commandRunsInputPath: null,
        runnerKind: null,
        sourceCommit: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            options.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--task') {
            options.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--kind') {
            options.kind = requireValue(argv, index, '--kind');
            index += 1;
            continue;
        }
        if (arg === '--summary') {
            options.summary = requireValue(argv, index, '--summary');
            index += 1;
            continue;
        }
        if (arg === '--artifacts') {
            options.artifacts = requireValue(argv, index, '--artifacts').split(',').map((entry) => normalizeRelativePath(entry)).filter(Boolean);
            index += 1;
            continue;
        }
        if (arg === '--freshness') {
            options.freshness = normalizeEvidenceFreshness(requireValue(argv, index, '--freshness'));
            index += 1;
            continue;
        }
        if (arg === '--validators') {
            options.validators = requireValue(argv, index, '--validators').split(',').map((entry) => entry.trim()).filter(Boolean);
            index += 1;
            continue;
        }
        if (arg === '--command') {
            const command = requireValue(argv, index, '--command');
            const exitCode = parseIntegerFlag(argv, '--exit-code');
            const stdoutSha256 = readOptionalFlag(argv, '--stdout-sha256');
            const stderrSha256 = readOptionalFlag(argv, '--stderr-sha256');
            if (exitCode === null || !isSha256(stdoutSha256) || !isSha256(stderrSha256)) {
                throw new CliError('ATM_CLI_USAGE', 'evidence add --command also requires --exit-code, --stdout-sha256, and --stderr-sha256.', { exitCode: 2 });
            }
            options.commandRun = {
                command,
                exitCode,
                stdoutSha256,
                stderrSha256
            };
            index += 1;
            continue;
        }
        if (arg === '--command-runs') {
            options.commandRunsInputPath = requireValue(argv, index, '--command-runs');
            index += 1;
            continue;
        }
        if (arg === '--runner-kind') {
            options.runnerKind = normalizeRunnerKind(requireValue(argv, index, '--runner-kind'));
            index += 1;
            continue;
        }
        if (arg === '--source-commit') {
            options.sourceCommit = requireValue(argv, index, '--source-commit').trim();
            index += 1;
            continue;
        }
        if (arg === '--exit-code' || arg === '--stdout-sha256' || arg === '--stderr-sha256') {
            requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `evidence add does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'evidence add requires --task <work-item-id>.', { exitCode: 2 });
    }
    if (!options.kind) {
        throw new CliError('ATM_CLI_USAGE', 'evidence add requires --kind <test|artifact|attestation|review|commit|waiver>.', { exitCode: 2 });
    }
    const cwd = path.resolve(options.cwd);
    const commandRunsPath = options.commandRunsInputPath ? path.resolve(cwd, options.commandRunsInputPath) : null;
    return {
        ...options,
        cwd,
        taskId: options.taskId.trim(),
        kind: options.kind.trim().toLowerCase(),
        commandRunsPath,
        commandRuns: commandRunsPath ? readCommandRunsInputFile(commandRunsPath) : []
    };
}
function parseGitHeadBackfillOptions(argv) {
    const options = {
        cwd: process.cwd(),
        actorId: null,
        summary: null,
        reason: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            options.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--summary') {
            options.summary = requireValue(argv, index, '--summary');
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            options.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `evidence git-head-backfill does not support option ${arg}`, { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd)
    };
}
function readCommandRunsInputFile(filePath) {
    if (!existsSync(filePath)) {
        throw new CliError('ATM_COMMAND_RUNS_FILE_MISSING', `Command runs file not found: ${filePath}`, { exitCode: 2 });
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch (error) {
        throw new CliError('ATM_COMMAND_RUNS_FILE_INVALID_JSON', `Command runs file is not valid JSON: ${filePath}`, {
            exitCode: 2,
            details: { error: error instanceof Error ? error.message : String(error) }
        });
    }
    const records = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.commandRuns)
            ? parsed.commandRuns
            : isRecord(parsed) && Array.isArray(parsed.runs)
                ? parsed.runs
                : [];
    if (records.length === 0) {
        throw new CliError('ATM_COMMAND_RUNS_FILE_EMPTY', 'Command runs file must be an array or contain commandRuns[].', { exitCode: 2 });
    }
    return records.map((record, index) => normalizeCommandRunInput(record, `commandRuns/${index}`));
}
function normalizeEvidenceCommandRuns(input) {
    const sourceCommit = input.sourceCommit ?? readCurrentCommit(input.cwd);
    return uniqueCommandRuns([
        ...(input.inlineRun ? [input.inlineRun] : []),
        ...input.fileRuns
    ].map((run) => {
        const runnerKind = normalizeRunnerKind(run.runnerKind ?? input.runnerKind ?? inferRunnerKindFromCommand(run.command));
        return {
            ...run,
            cwd: run.cwd ?? '.',
            runnerKind,
            sourceCommit: run.sourceCommit ?? (runnerKind === 'dev-source' ? sourceCommit ?? undefined : undefined),
            cacheKey: run.cacheKey ?? computeCommandRunCacheKey({
                command: run.command,
                cwd: run.cwd ?? '.',
                exitCode: run.exitCode,
                stdoutSha256: run.stdoutSha256,
                stderrSha256: run.stderrSha256,
                runnerKind,
                sourceCommit: run.sourceCommit ?? (runnerKind === 'dev-source' ? sourceCommit ?? undefined : undefined)
            }),
            cached: run.cached === true,
            generatedAt: run.generatedAt ?? new Date().toISOString()
        };
    }));
}
function normalizeCommandRunInput(value, label) {
    if (!isRecord(value)) {
        throw new CliError('ATM_COMMAND_RUN_INVALID', `Command run ${label} must be an object.`, { exitCode: 2 });
    }
    const command = typeof value.command === 'string' ? value.command.trim() : '';
    const exitCode = typeof value.exitCode === 'number'
        ? value.exitCode
        : typeof value.exitCode === 'string'
            ? Number.parseInt(value.exitCode, 10)
            : Number.NaN;
    const stdoutSha256 = typeof value.stdoutSha256 === 'string'
        ? value.stdoutSha256.trim()
        : typeof value.stdoutHash === 'string'
            ? value.stdoutHash.trim()
            : '';
    const stderrSha256 = typeof value.stderrSha256 === 'string'
        ? value.stderrSha256.trim()
        : typeof value.stderrHash === 'string'
            ? value.stderrHash.trim()
            : '';
    if (!command || !Number.isFinite(exitCode) || !isSha256(stdoutSha256) || !isSha256(stderrSha256)) {
        throw new CliError('ATM_COMMAND_RUN_INVALID', `Command run ${label} requires command, exitCode, stdoutSha256, and stderrSha256.`, {
            exitCode: 2,
            details: { label }
        });
    }
    return {
        command,
        cwd: typeof value.cwd === 'string' && value.cwd.trim() ? normalizeRelativePath(value.cwd) : undefined,
        exitCode,
        stdoutSha256,
        stderrSha256,
        validators: Array.isArray(value.validators) ? value.validators.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim()) : undefined,
        cached: value.cached === true,
        cacheKey: typeof value.cacheKey === 'string' && value.cacheKey.trim() ? value.cacheKey.trim() : undefined,
        runnerKind: typeof value.runnerKind === 'string' && value.runnerKind.trim() ? normalizeRunnerKind(value.runnerKind) : undefined,
        sourceCommit: typeof value.sourceCommit === 'string' && value.sourceCommit.trim() ? value.sourceCommit.trim() : undefined,
        runnerVersion: typeof value.runnerVersion === 'string' && value.runnerVersion.trim() ? value.runnerVersion.trim() : undefined,
        generatedAt: typeof value.generatedAt === 'string' && value.generatedAt.trim() ? value.generatedAt.trim() : undefined
    };
}
function normalizeRunnerKind(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'dev' || normalized === 'source' || normalized === 'dev-source' || normalized === 'atm.dev.mjs')
        return 'dev-source';
    if (normalized === 'frozen' || normalized === 'release' || normalized === 'stable' || normalized === 'atm.mjs')
        return 'frozen-runner';
    if (normalized === 'external' || normalized === 'host')
        return 'external';
    return 'unknown';
}
function inferRunnerKindFromCommand(command) {
    if (/\batm\.dev\.mjs\b/.test(command))
        return 'dev-source';
    if (/\batm\.mjs\b/.test(command))
        return 'frozen-runner';
    return 'unknown';
}
function uniqueCommandRuns(runs) {
    const seen = new Set();
    const output = [];
    for (const run of runs) {
        const key = `${run.command}|${run.cwd ?? '.'}|${run.exitCode}|${run.stdoutSha256}|${run.stderrSha256}|${run.runnerKind ?? ''}|${run.sourceCommit ?? ''}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(run);
    }
    return output;
}
function computeCommandRunCacheKey(run) {
    return hashJson({
        schemaId: 'atm.commandRunCacheKey.v1',
        command: run.command,
        cwd: run.cwd,
        exitCode: run.exitCode,
        stdoutSha256: run.stdoutSha256,
        stderrSha256: run.stderrSha256,
        runnerKind: run.runnerKind ?? null,
        sourceCommit: run.sourceCommit ?? null
    });
}
function hashJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function uniqueStrings(values) {
    return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function readCurrentCommit(cwd) {
    return runGitScalar(cwd, ['rev-parse', '--verify', 'HEAD']) ?? undefined;
}
function parseEvidenceVerifyOptions(argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        gate: 'close'
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            options.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--task') {
            options.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--gate') {
            const gate = requireValue(argv, index, '--gate').trim().toLowerCase();
            if (gate !== 'close' && gate !== 'commit' && gate !== 'pr') {
                throw new CliError('ATM_CLI_USAGE', 'evidence verify --gate supports only: close, commit, pr.', { exitCode: 2 });
            }
            options.gate = gate;
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `evidence verify does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'evidence verify requires --task <work-item-id>.', { exitCode: 2 });
    }
    return {
        ...options,
        cwd: path.resolve(options.cwd),
        taskId: options.taskId.trim()
    };
}
function readParentCommitShas(cwd, commitSha) {
    const result = runGitCommand(cwd, ['rev-list', '--parents', '-n', '1', commitSha]);
    if (!result.ok)
        return [];
    return result.stdout.trim().split(/\s+/).slice(1).filter(Boolean);
}
function runGitScalar(cwd, args) {
    const result = runGitCommand(cwd, args);
    return result.ok ? result.stdout.trim() : null;
}
function runGitCommand(cwd, args, env = {}) {
    const result = spawnSync('git', args, {
        cwd,
        env: {
            ...process.env,
            ...env
        },
        encoding: 'utf8'
    });
    return {
        ok: !result.error && result.status === 0,
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: [result.stderr ?? '', result.error?.message ?? ''].filter(Boolean).join('\n')
    };
}
function readGovernedCommitTreeWithoutEvidence(cwd, commitSha) {
    const tempDir = mkdirTempDir();
    const tempIndex = path.join(tempDir, 'index');
    try {
        const readTree = runGitCommand(cwd, ['read-tree', commitSha], {
            GIT_INDEX_FILE: tempIndex
        });
        if (!readTree.ok)
            return null;
        runGitCommand(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', '.atm/history/evidence/git-head.json'], {
            GIT_INDEX_FILE: tempIndex
        });
        const writeTree = runGitCommand(cwd, ['write-tree'], {
            GIT_INDEX_FILE: tempIndex
        });
        return writeTree.ok ? writeTree.stdout.trim() : null;
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
function mkdirTempDir() {
    return path.resolve(mkdtempSync(path.join(os.tmpdir(), 'atm-evidence-backfill-')));
}
function readEvidenceBundle(cwd, taskId) {
    const evidencePath = evidencePathForTask(cwd, taskId);
    if (!existsSync(evidencePath)) {
        return { evidence: [] };
    }
    const parsed = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (Array.isArray(parsed)) {
        return { evidence: parsed.filter(isRecord) };
    }
    if (isRecord(parsed)) {
        if (Array.isArray(parsed.evidence)) {
            return {
                evidence: parsed.evidence.filter(isRecord)
            };
        }
        return { evidence: [parsed] };
    }
    return { evidence: [] };
}
function writeEvidenceEnvelope(evidencePath, envelope) {
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
}
function canonicalizeEvidenceRecord(value) {
    const evidenceType = typeof value.evidenceType === 'string' ? value.evidenceType : '';
    const evidenceKind = typeof value.evidenceKind === 'string' ? value.evidenceKind : '';
    const detailKind = isRecord(value.details) && typeof value.details.kind === 'string' ? value.details.kind : '';
    const detailFreshness = isRecord(value.details) && typeof value.details.freshness === 'string' ? value.details.freshness : '';
    const topFreshness = typeof value.evidenceFreshness === 'string'
        ? value.evidenceFreshness
        : typeof value.freshness === 'string'
            ? value.freshness
            : '';
    const kind = normalizeEvidenceKind(evidenceType || detailKind || evidenceKind);
    return {
        kind,
        summary: typeof value.summary === 'string' ? value.summary : '',
        producedBy: typeof value.producedBy === 'string' ? value.producedBy : null,
        artifactPaths: Array.isArray(value.artifactPaths)
            ? value.artifactPaths.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => normalizeRelativePath(entry))
            : [],
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
        freshness: normalizeEvidenceFreshness(topFreshness || detailFreshness),
        hasCommandRunProof: hasCommandRunProof(value)
    };
}
function normalizeEvidenceKind(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'test' || normalized === 'validation')
        return 'test';
    if (normalized === 'artifact')
        return 'artifact';
    if (normalized === 'attestation')
        return 'attestation';
    if (normalized === 'review')
        return 'review';
    if (normalized === 'commit')
        return 'commit';
    if (normalized === 'waiver')
        return 'waiver';
    return 'other';
}
function normalizeEvidenceFreshness(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'historical-reference' || normalized === 'historical_reference' || normalized === 'reference-only') {
        return 'historical-reference';
    }
    if (normalized === 'draft')
        return 'draft';
    return 'fresh';
}
function evidencePathForTask(cwd, taskId) {
    return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
}
function taskPathForEvidence(cwd, taskId) {
    return path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
}
function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `evidence requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function readTaskDocument(cwd, taskId) {
    const taskPath = taskPathForEvidence(cwd, taskId);
    if (!existsSync(taskPath))
        return null;
    return JSON.parse(readFileSync(taskPath, 'utf8'));
}
function extractTaskDeclaredFiles(taskDocument) {
    if (!taskDocument)
        return [];
    const files = new Set();
    for (const key of ['scope', 'files', 'changedFiles', 'criticalChangedFiles', 'guardPaths', 'targetFiles']) {
        collectTaskFileValues(taskDocument[key], files);
    }
    const source = taskDocument.source;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
        const sourceRecord = source;
        collectTaskFileValues(sourceRecord.path, files);
        collectTaskFileValues(sourceRecord.planPath, files);
    }
    return [...files].sort((left, right) => left.localeCompare(right));
}
function collectTaskFileValues(value, files) {
    if (typeof value === 'string') {
        const normalized = normalizeRelativePath(value);
        if (normalized)
            files.add(normalized);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectTaskFileValues(entry, files);
        }
    }
}
function detectReopenedOrRedteamTask(taskDocument) {
    if (!taskDocument)
        return false;
    for (const field of ['audit_status', 'auditStatus', 'notes', 'summary', 'description']) {
        const text = typeof taskDocument[field] === 'string' ? taskDocument[field] : '';
        if (/(reopened|clean[_ -]?redo|redteam|invalid completion claim|historical draft evidence|draft evidence)/i.test(text)) {
            return true;
        }
    }
    return false;
}
function detectCodeOrFrameworkTask(taskDocument, declaredFiles) {
    if (!taskDocument)
        return declaredFiles.some(isCodeLikePath);
    const closureAuthority = typeof taskDocument.closureAuthority === 'string'
        ? taskDocument.closureAuthority
        : typeof taskDocument.closure_authority === 'string'
            ? taskDocument.closure_authority
            : '';
    const targetRepo = typeof taskDocument.targetRepo === 'string'
        ? taskDocument.targetRepo
        : typeof taskDocument.target_repo === 'string'
            ? taskDocument.target_repo
            : '';
    if (closureAuthority.trim().toLowerCase() === 'target_repo' || targetRepo.trim().length > 0) {
        return true;
    }
    const source = taskDocument.source && typeof taskDocument.source === 'object' && !Array.isArray(taskDocument.source)
        ? taskDocument.source
        : {};
    if (typeof source.planPath === 'string' && source.planPath.trim().length > 0) {
        return true;
    }
    if (declaredFiles.some(isCodeLikePath))
        return true;
    const notes = typeof taskDocument.notes === 'string' ? taskDocument.notes : '';
    return isCodeLikePath(notes);
}
function isCodeLikePath(value) {
    return /(^|[/\s])(packages|scripts|schemas|specs|templates|integrations|examples|tests)\//i.test(value)
        || /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|cs|cpp|c|h|json|ya?ml|sh|ps1)\b/i.test(value);
}
function hasCommandRunProof(value) {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    if (Array.isArray(candidate.commandRuns)) {
        return candidate.commandRuns.some((entry) => isCommandRunProof(entry));
    }
    if (isRecord(candidate.details) && Array.isArray(candidate.details.commandRuns)) {
        return candidate.details.commandRuns.some((entry) => isCommandRunProof(entry));
    }
    return false;
}
function isCommandRunProof(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const candidate = value;
    return typeof candidate.command === 'string'
        && typeof candidate.exitCode === 'number'
        && isSha256(candidate.stdoutSha256)
        && isSha256(candidate.stderrSha256);
}
function isSha256(value) {
    return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value.trim());
}
function readOptionalFlag(argv, flag) {
    const index = argv.indexOf(flag);
    if (index < 0 || index + 1 >= argv.length)
        return null;
    const value = argv[index + 1];
    return value && !value.startsWith('--') ? value.trim() : null;
}
function parseIntegerFlag(argv, flag) {
    const raw = readOptionalFlag(argv, flag);
    if (raw === null)
        return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
}
export function quoteForShell(arg) {
    if (/^[a-zA-Z0-9.\-_:/]+$/.test(arg)) {
        return arg;
    }
    return `"${arg.replace(/"/g, '\\"')}"`;
}
export function detectAutoLinkedValidator(command) {
    const trimmed = command.trim();
    const npmMatch = trimmed.match(/^npm run ([a-z0-9-:]+)$/);
    if (npmMatch) {
        const gate = npmMatch[1];
        if (gate === 'typecheck' || gate.startsWith('validate:')) {
            return gate;
        }
    }
    const nodeMatch = trimmed.match(/^node --strip-types scripts\/validate-([a-z0-9-]+)\.ts --mode validate$/);
    if (nodeMatch) {
        return `validate:${nodeMatch[1]}`;
    }
    return null;
}
