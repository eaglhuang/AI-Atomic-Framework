import path from 'node:path';
import { createFrameworkModeStatus } from '../framework-development.js';
import { resolveTaskRunnerArbitration } from '../validate.js';
import { canonicalizeValidatorIdentity, classifyValidatorTier, isClosureRequiredValidator, resolveValidatorExpectedCommand } from './validator-classification.js';
import { collectRecordCommandRuns, readRecordValidationPasses, readRecordFreshness, uniqueStrings } from './command-runs.js';
import { isRecord, isCommandRunProof } from './shared-utils.js';
import { readEvidenceBundle, readTaskDocument, buildAutoEvidenceRequiredCommand } from './evidence-store.js';
export function classifyValidatorEvidenceState(bundle, gate) {
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
                    .map((v) => canonicalizeValidatorIdentity(v))
                : [];
            const cmd = typeof run.command === 'string' ? run.command : '';
            const matches = runValidators.includes(gate) || canonicalizeValidatorIdentity(cmd) === gate;
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
export function buildMissingValidatorFinding(gate, state, taskId, actor, runnerKind) {
    const expectedCommand = resolveValidatorExpectedCommand(gate);
    const requiredCommand = buildAutoEvidenceRequiredCommand(taskId, actor, expectedCommand, gate, runnerKind);
    if (state === 'absent') {
        return {
            code: 'ATM_EVIDENCE_VALIDATOR_ABSENT',
            validator: gate, category: 'absent',
            summary: `No evidence record claims validator '${gate}' passed. Use evidence run so ATM executes the validator and captures command-backed evidence.`,
            requiredCommand
        };
    }
    if (state === 'failed-run') {
        return {
            code: 'ATM_EVIDENCE_VALIDATOR_FAILED_RUN',
            validator: gate, category: 'failed-run',
            summary: `Validator '${gate}' has at least one command run with non-zero exit code. Fix the failure and rerun it through evidence run to add fresh evidence.`,
            requiredCommand
        };
    }
    if (state === 'stale') {
        return {
            code: 'ATM_EVIDENCE_VALIDATOR_STALE',
            validator: gate, category: 'stale',
            summary: `Validator '${gate}' evidence is not fresh (historical-reference or draft). Rerun it through evidence run in this session to refresh.`,
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
export function computeMissingValidatorReport(cwd, taskId, actorId) {
    const resolvedCwd = path.resolve(cwd);
    const resolvedTaskId = taskId.trim();
    const runnerArbitration = resolveTaskRunnerArbitration(resolvedCwd, resolvedTaskId);
    // 1. 取得 framework 必要 gates
    const frameworkStatus = createFrameworkModeStatus({ cwd: resolvedCwd });
    const frameworkGates = frameworkStatus.requiredGates;
    // 2. 取得 task card 宣告的 validators
    const taskDocument = readTaskDocument(resolvedCwd, resolvedTaskId);
    const taskDeclaredValidators = Array.isArray(taskDocument?.validators)
        ? taskDocument.validators
            .filter((v) => typeof v === 'string' && v.trim().length > 0)
            .map((v) => canonicalizeValidatorIdentity(v.trim()))
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
    const scopePaths = Array.isArray(taskDocument?.scopePaths)
        ? taskDocument.scopePaths.filter((p) => typeof p === 'string')
        : [];
    for (const gate of allGates) {
        const state = classifyValidatorEvidenceState(bundleRecords, gate);
        const tier = classifyValidatorTier(gate);
        const closureRequired = isClosureRequiredValidator(gate, taskDeclaredValidators, scopePaths);
        catalogEntries.push({
            name: gate,
            tier,
            closureRequired,
            expectedCommand: resolveValidatorExpectedCommand(gate),
            evidenceState: state
        });
        if (state !== 'pass') {
            const finding = buildMissingValidatorFinding(gate, state, resolvedTaskId, actorId, runnerArbitration.preferredRunnerKind);
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
