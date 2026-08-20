import path from 'node:path';
import { createFrameworkModeStatus } from '../framework-development.js';
import { resolveTaskRunnerArbitration } from '../validate.js';
import { canonicalizeValidatorIdentity, classifyValidatorTier, looksLikeLiteralValidatorCommand, resolveValidatorExpectedCommand } from './validator-classification.js';
import { collectRecordCommandRuns, readRecordValidationPasses, readRecordFreshness, uniqueStrings } from './command-runs.js';
import { isRecord, isCommandRunProof } from './shared-utils.js';
import { readEvidenceBundle, readTaskDocument, readTaskRunnerSyncReceipt, buildAutoEvidenceRequiredCommand } from './evidence-store.js';
/** Keep executable task-card commands attached to their canonical evidence gate. */
export function resolveTaskDeclaredValidatorCommands(taskDocument) {
    const commands = new Map();
    const declared = Array.isArray(taskDocument?.validators)
        ? taskDocument.validators.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    for (const entry of declared) {
        const gate = canonicalizeValidatorIdentity(entry);
        if (!gate || commands.has(gate))
            continue;
        commands.set(gate, looksLikeLiteralValidatorCommand(entry) ? entry.trim() : resolveValidatorExpectedCommand(gate));
    }
    return commands;
}
function normalizeEvidencePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function readRecordArtifactPaths(record) {
    const paths = new Set();
    const collect = (value) => {
        if (!Array.isArray(value))
            return;
        for (const entry of value) {
            if (typeof entry === 'string' && entry.trim())
                paths.add(normalizeEvidencePath(entry));
        }
    };
    collect(record.artifactPaths);
    if (isRecord(record.details))
        collect(record.details.artifactPaths);
    return [...paths].sort((a, b) => a.localeCompare(b));
}
function commandRunMatchesValidator(run, validator, expectedCommand) {
    const runValidators = Array.isArray(run.validators)
        ? (run.validators)
            .filter((entry) => typeof entry === 'string')
            .map((entry) => canonicalizeValidatorIdentity(entry))
        : [];
    const command = typeof run.command === 'string' ? run.command : '';
    return runValidators.includes(validator)
        || canonicalizeValidatorIdentity(command) === validator
        || canonicalizeValidatorIdentity(command) === canonicalizeValidatorIdentity(expectedCommand);
}
function readStringField(record, key) {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function hasTouchedArtifact(recordArtifactPaths, touchedFiles) {
    const touched = new Set(touchedFiles.map(normalizeEvidencePath));
    return recordArtifactPaths.some((artifactPath) => touched.has(artifactPath));
}
export function assessEvidenceFreshness(input) {
    const touchedFiles = uniqueStrings((input.touchedFiles ?? []).map(normalizeEvidencePath));
    const declaredArtifacts = uniqueStrings((input.declaredArtifacts ?? []).map(normalizeEvidencePath));
    const evidenceArtifacts = uniqueStrings(input.validatorReceipts.flatMap((record) => readRecordArtifactPaths(record)));
    const artifactChecks = uniqueStrings([...declaredArtifacts, ...evidenceArtifacts]).map((artifactPath) => ({
        path: artifactPath,
        declared: declaredArtifacts.includes(artifactPath),
        referencedByEvidence: evidenceArtifacts.includes(artifactPath),
        touched: touchedFiles.includes(artifactPath)
    }));
    const decisions = [];
    for (const validator of input.validators) {
        const matchingRecords = input.validatorReceipts.filter((record) => readRecordValidationPasses(record).includes(validator.name)
            || collectRecordCommandRuns(record).some((run) => commandRunMatchesValidator(run, validator.name, validator.expectedCommand)));
        const observedCommands = uniqueStrings(matchingRecords.flatMap((record) => collectRecordCommandRuns(record)
            .filter((run) => commandRunMatchesValidator(run, validator.name, validator.expectedCommand))
            .map((run) => typeof run.command === 'string' ? run.command.trim() : '')));
        const artifactPaths = uniqueStrings(matchingRecords.flatMap((record) => readRecordArtifactPaths(record)));
        const reasons = [];
        if (matchingRecords.length === 0 || validator.evidenceState === 'absent') {
            reasons.push('no matching command-backed validator evidence');
            decisions.push({
                validator: validator.name,
                status: 'missing',
                tier: validator.tier,
                closureRequired: validator.closureRequired,
                expectedCommand: validator.expectedCommand,
                observedCommands,
                artifactPaths,
                reasons
            });
            continue;
        }
        if (validator.evidenceState === 'failed-run')
            reasons.push('latest matching command run has non-zero exit code');
        if (validator.evidenceState === 'diagnostic-only')
            reasons.push('matching evidence lacks stdout/stderr hash and exit-code proof');
        if (validator.evidenceState === 'stale')
            reasons.push('matching evidence is marked historical-reference or draft');
        if (observedCommands.length > 0 && !observedCommands.some((command) => canonicalizeValidatorIdentity(command) === canonicalizeValidatorIdentity(validator.expectedCommand)
            || canonicalizeValidatorIdentity(command) === validator.name)) {
            reasons.push('observed command identity does not match expected validator command');
        }
        if (input.deliveryCommit) {
            const sourceCommits = uniqueStrings(matchingRecords.flatMap((record) => collectRecordCommandRuns(record)
                .filter((run) => commandRunMatchesValidator(run, validator.name, validator.expectedCommand))
                .map((run) => readStringField(run, 'sourceCommit') ?? '')));
            if (sourceCommits.length > 0 && !sourceCommits.includes(input.deliveryCommit)) {
                reasons.push('command-run source commit differs from delivery commit');
            }
        }
        if (hasTouchedArtifact(artifactPaths, touchedFiles)) {
            reasons.push('validator evidence references an artifact touched by this delivery');
        }
        decisions.push({
            validator: validator.name,
            status: reasons.length === 0 && validator.evidenceState === 'pass' ? 'fresh' : 'stale',
            tier: validator.tier,
            closureRequired: validator.closureRequired,
            expectedCommand: validator.expectedCommand,
            observedCommands,
            artifactPaths,
            reasons
        });
    }
    const required = decisions.filter((entry) => entry.closureRequired);
    const rerunValidators = required.filter((entry) => entry.status !== 'fresh');
    const skippedHeavyweightValidators = decisions
        .filter((entry) => !entry.closureRequired && (entry.tier === 'batch' || entry.tier === 'milestone' || entry.tier === 'release'))
        .map((entry) => entry.validator);
    const status = required.length === 0
        ? 'fresh'
        : required.every((entry) => entry.status === 'fresh')
            ? 'fresh'
            : required.every((entry) => entry.status === 'missing')
                ? 'missing'
                : required.some((entry) => entry.status === 'fresh')
                    ? 'partially-stale'
                    : 'stale';
    const requiredCommands = rerunValidators.map((entry) => buildAutoEvidenceRequiredCommand(input.taskId, input.actorId, entry.expectedCommand, entry.validator, input.runnerKind));
    const rerunPlan = {
        schemaId: 'atm.closeValidatorRerunPlan.v1',
        taskId: input.taskId,
        validators: rerunValidators.map((entry) => entry.validator),
        commands: rerunValidators.map((entry) => entry.expectedCommand),
        requiredCommands,
        skippedHeavyweightValidators,
        reason: rerunValidators.length === 0
            ? 'All closure-required validator evidence is fresh.'
            : `Rerun ${rerunValidators.length} closure-required validator(s) with stale or missing evidence.`
    };
    return {
        schemaId: 'atm.evidenceFreshnessVerdict.v1',
        taskId: input.taskId,
        deliveryCommit: input.deliveryCommit ?? null,
        touchedFiles,
        status,
        reasons: uniqueStrings(rerunValidators.flatMap((entry) => entry.reasons.map((reason) => `${entry.validator}: ${reason}`))),
        validators: decisions,
        artifactChecks,
        rerunPlan
    };
}
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
export function buildMissingValidatorFinding(gate, state, taskId, actor, runnerKind, expectedCommand = resolveValidatorExpectedCommand(gate)) {
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
    const taskDeclaredValidatorCommands = resolveTaskDeclaredValidatorCommands(taskDocument);
    const taskDeclaredValidators = [...taskDeclaredValidatorCommands.keys()];
    // 3. 合併並去重
    const allGates = uniqueStrings([...frameworkGates, ...taskDeclaredValidators]);
    // 4. 讀取 evidence bundle
    const bundle = readEvidenceBundle(resolvedCwd, resolvedTaskId);
    const rawBundleRecords = bundle.evidence.map((r) => isRecord(r) ? r : {});
    const runnerReceipt = readTaskRunnerSyncReceipt(resolvedCwd, resolvedTaskId);
    const bundleRecords = runnerReceipt
        ? [
            ...rawBundleRecords,
            {
                schemaId: 'atm.evidenceRecord.v1',
                evidenceKind: 'validation',
                evidenceFreshness: runnerReceipt.publicationDisposition === 'published' ? 'fresh' : 'draft',
                details: {
                    kind: 'test',
                    freshness: runnerReceipt.publicationDisposition === 'published' ? 'fresh' : 'draft',
                    validationPasses: ['build'],
                    commandRuns: [
                        {
                            command: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build',
                            exitCode: runnerReceipt.publicationDisposition === 'published' ? 0 : 1,
                            stdoutSha256: typeof runnerReceipt.runnerInputTreeHash === 'string' ? runnerReceipt.runnerInputTreeHash : 'placeholder',
                            stderrSha256: typeof runnerReceipt.runnerInputTreeHash === 'string' ? runnerReceipt.runnerInputTreeHash : 'placeholder',
                            sourceCommit: typeof runnerReceipt.sealedSourceSha === 'string' ? runnerReceipt.sealedSourceSha : null,
                            validators: ['build']
                        }
                    ]
                }
            }
        ]
        : rawBundleRecords;
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
    // The task validation contract is the sole task-close authority. Framework
    // requiredGates belong to phase/release consumers; promoting them here made
    // evidence-only cards run unrelated suites and split preflight from the
    // task-card contract. Missing/empty task validators stays fail-closed via
    // the caller's validation-contract gate rather than falling back to broad
    // framework validation.
    const declaredChangedFiles = uniqueStrings([
        ...scopePaths,
        ...(Array.isArray(taskDocument?.deliverables)
            ? taskDocument.deliverables.filter((p) => typeof p === 'string')
            : [])
    ]);
    for (const gate of allGates) {
        const state = classifyValidatorEvidenceState(bundleRecords, gate);
        const tier = classifyValidatorTier(gate);
        const closureRequired = taskDeclaredValidators.includes(gate);
        const expectedCommand = taskDeclaredValidatorCommands.get(gate) ?? resolveValidatorExpectedCommand(gate);
        catalogEntries.push({
            name: gate,
            tier,
            closureRequired,
            expectedCommand,
            evidenceState: state
        });
        if (state !== 'pass') {
            const finding = buildMissingValidatorFinding(gate, state, resolvedTaskId, actorId, runnerArbitration.preferredRunnerKind, expectedCommand);
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
    const freshnessVerdict = assessEvidenceFreshness({
        taskId: resolvedTaskId,
        deliveryCommit: null,
        touchedFiles: declaredChangedFiles,
        validators: catalogEntries,
        validatorReceipts: bundleRecords,
        actorId,
        runnerKind: runnerArbitration.preferredRunnerKind,
        declaredArtifacts: declaredChangedFiles
    });
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
        validators: catalogEntries,
        freshnessVerdict,
        rerunPlan: freshnessVerdict.rerunPlan
    };
}
