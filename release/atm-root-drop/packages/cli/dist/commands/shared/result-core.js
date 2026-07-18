import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let outputJsonPath = null;
let globalSummaryProjection = false;
let globalFieldsProjection = null;
export function resetOutputProjectionGlobals() {
    outputJsonPath = null;
    globalSummaryProjection = false;
    globalFieldsProjection = null;
}
export function applyOutputProjectionFlagsFromArgv(argv) {
    resetOutputProjectionGlobals();
    const summaryIdx = argv.indexOf('--summary');
    if (summaryIdx !== -1) {
        globalSummaryProjection = true;
    }
    const fieldsIdx = argv.indexOf('--fields');
    if (fieldsIdx !== -1 && fieldsIdx + 1 < argv.length && !argv[fieldsIdx + 1].startsWith('-')) {
        globalFieldsProjection = argv[fieldsIdx + 1].split(',').map((entry) => entry.trim()).filter(Boolean);
    }
    const outputJsonIdx = argv.indexOf('--output-json');
    if (outputJsonIdx !== -1 && outputJsonIdx + 1 < argv.length && !argv[outputJsonIdx + 1].startsWith('-')) {
        outputJsonPath = argv[outputJsonIdx + 1];
    }
}
export function setOutputJsonPath(resolvedPath) {
    outputJsonPath = resolvedPath;
}
export function resolveNextDefaultOutputPath(cwd) {
    const dir = path.join(path.resolve(cwd), '.atm-temp');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(dir, `next-${stamp}.json`);
}
// 在載入時直接全域掃描一次 process.argv 以備不時之需
const outputJsonIdx = process.argv.indexOf('--output-json');
if (outputJsonIdx !== -1 && outputJsonIdx + 1 < process.argv.length) {
    outputJsonPath = process.argv[outputJsonIdx + 1];
}
const summaryIdx = process.argv.indexOf('--summary');
if (summaryIdx !== -1) {
    globalSummaryProjection = true;
}
const fieldsIdx = process.argv.indexOf('--fields');
if (fieldsIdx !== -1 && fieldsIdx + 1 < process.argv.length) {
    globalFieldsProjection = process.argv[fieldsIdx + 1].split(',').map((entry) => entry.trim()).filter(Boolean);
}
export const configRelativePath = path.join('.atm', 'config.json');
export const frameworkVersion = '0.0.0';
const defaultFrameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
export function readFrameworkVersion(root = defaultFrameworkRoot) {
    const packagePath = path.join(root, 'package.json');
    if (!existsSync(packagePath)) {
        return frameworkVersion;
    }
    try {
        const parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
        if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
            return parsed.version;
        }
    }
    catch {
        // fall through to bundled fallback
    }
    return frameworkVersion;
}
export class CliError extends Error {
    code;
    exitCode;
    details;
    constructor(code, text, options = {}) {
        super(text);
        this.name = 'CliError';
        this.code = code;
        this.exitCode = options.exitCode ?? 1;
        this.details = options.details ?? {};
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readStringList(value) {
    if (!Array.isArray(value))
        return undefined;
    const filtered = value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return filtered.length > 0 ? filtered : undefined;
}
export function projectToolBridgeFields(evidence) {
    if (evidence.suppressToolBridgeProjection === true) {
        return {};
    }
    const nextAction = isRecord(evidence.nextAction) ? evidence.nextAction : null;
    const taskIntent = isRecord(evidence.taskIntent) ? evidence.taskIntent : null;
    const userNotice = isRecord(evidence.userNotice) ? evidence.userNotice : null;
    const runnerMode = isRecord(evidence.runnerMode)
        ? evidence.runnerMode
        : nextAction && isRecord(nextAction.runnerMode)
            ? nextAction.runnerMode
            : null;
    const frameworkReport = isRecord(evidence.report)
        && typeof evidence.action === 'string'
        && (evidence.report.schemaId === 'atm.frameworkDevelopmentStatus')
        ? evidence.report
        : null;
    const frameworkClaim = typeof evidence.action === 'string' && evidence.action === 'claim'
        ? {
            action: 'claim',
            taskId: typeof evidence.taskId === 'string' ? evidence.taskId : null,
            actorId: typeof evidence.actorId === 'string' ? evidence.actorId : null,
            reason: typeof evidence.reason === 'string' ? evidence.reason : null,
            linkedTaskId: typeof evidence.linkedTaskId === 'string' ? evidence.linkedTaskId : null,
            files: readStringList(evidence.files) ?? [],
            lock: isRecord(evidence.lock) ? evidence.lock : null
        }
        : null;
    const evidenceSummary = typeof evidence.action === 'string' && (evidence.action === 'add' || evidence.action === 'run')
        ? {
            action: evidence.action,
            taskId: typeof evidence.taskId === 'string' ? evidence.taskId : null,
            actorId: typeof evidence.actorId === 'string' ? evidence.actorId : null,
            kind: typeof evidence.kind === 'string' ? evidence.kind : null,
            evidencePath: typeof evidence.evidencePath === 'string' ? evidence.evidencePath : null,
            bundleManifestPath: typeof evidence.bundleManifestPath === 'string' ? evidence.bundleManifestPath : null,
            artifactPaths: isRecord(evidence.bundleManifest) ? readStringList(evidence.bundleManifest.artifactPaths) ?? [] : [],
            freshValidationPasses: isRecord(evidence.bundleManifest) ? readStringList(evidence.bundleManifest.freshValidationPasses) ?? [] : [],
            commandRunCount: typeof evidence.commandRunCount === 'number' ? evidence.commandRunCount : null,
            commandRunCache: isRecord(evidence.commandRunCache) ? evidence.commandRunCache : null
        }
        : null;
    const guardReport = typeof evidence.guard === 'string'
        ? {
            guard: evidence.guard,
            taskId: typeof evidence.taskId === 'string' ? evidence.taskId : null,
            actorId: typeof evidence.actorId === 'string' ? evidence.actorId : null,
            files: readStringList(evidence.files) ?? [],
            violations: Array.isArray(evidence.violations) ? evidence.violations : [],
            findings: Array.isArray(evidence.findings) ? evidence.findings : [],
            report: isRecord(evidence.report) ? evidence.report : null,
            claimLeaseId: typeof evidence.claimLeaseId === 'string' ? evidence.claimLeaseId : null,
            failOpen: evidence.failOpen === true
        }
        : null;
    const taskflowReadiness = isRecord(evidence.writeReadinessHint) || isRecord(evidence.historicalClosePreflight)
        ? {
            writeReadinessHint: isRecord(evidence.writeReadinessHint) ? evidence.writeReadinessHint : null,
            historicalClosePreflight: isRecord(evidence.historicalClosePreflight) ? evidence.historicalClosePreflight : null,
            autoEvidencePlan: isRecord(evidence.autoEvidencePlan) ? evidence.autoEvidencePlan : null,
            closebackPathResolution: isRecord(evidence.closebackPathResolution) ? evidence.closebackPathResolution : null,
            closeMode: typeof evidence.closeMode === 'string' ? evidence.closeMode : null
        }
        : null;
    const commitBundle = isRecord(evidence.commitBundle)
        ? evidence.commitBundle
        : isRecord(evidence.governedCommitBundle)
            ? evidence.governedCommitBundle
            : null;
    const skillGrowth = isRecord(evidence.skillGrowth)
        ? evidence.skillGrowth
        : nextAction && isRecord(nextAction.skillGrowth)
            ? nextAction.skillGrowth
            : null;
    const laneSession = isRecord(evidence.laneSession)
        ? evidence.laneSession
        : nextAction && isRecord(nextAction.laneSession)
            ? nextAction.laneSession
            : null;
    const allowedCommands = readStringList(evidence.allowedCommands)
        ?? (nextAction ? readStringList(nextAction.allowedCommands) : undefined);
    const blockedCommands = readStringList(evidence.blockedCommands)
        ?? (nextAction ? readStringList(nextAction.blockedCommands) : undefined);
    return {
        nextAction,
        taskIntent,
        userNotice,
        runnerMode,
        frameworkReport,
        frameworkClaim,
        evidenceSummary,
        guardReport,
        taskflowReadiness,
        commitBundle,
        allowedCommands,
        blockedCommands,
        skillGrowth,
        laneSession
    };
}
const BLOCKED_ACTION_MESSAGE_CODES = new Set([
    'ATM_NEXT_FRAMEWORK_TARGET_REPO_REQUIRED',
    'ATM_GUIDANCE_NEXT_BLOCKED',
    'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED',
    'ATM_NEXT_CLAIM_BLOCKED',
    'ATM_BROKER_LIFECYCLE_BLOCKED',
    'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED',
    'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED',
    'ATM_TASKFLOW_CLOSE_WRITE_BLOCKED'
]);
const USAGE_ERROR_MESSAGE_CODES = new Set([
    'ATM_CLI_USAGE',
    'ATM_CLI_UNKNOWN_COMMAND',
    'ATM_CLI_HELP_NOT_FOUND'
]);
function collectMessageCodes(messages, level) {
    return messages
        .filter((entry) => entry.level === level)
        .map((entry) => entry.code)
        .filter((code) => typeof code === 'string' && code.length > 0);
}
function hasBlockedActionSignal(result) {
    const nextAction = result.evidence?.nextAction;
    if (nextAction?.status === 'blocked') {
        return true;
    }
    return result.messages.some((entry) => {
        if (entry.level !== 'error') {
            return false;
        }
        if (BLOCKED_ACTION_MESSAGE_CODES.has(entry.code)) {
            return true;
        }
        return /_BLOCKED$/.test(entry.code) && !USAGE_ERROR_MESSAGE_CODES.has(entry.code);
    });
}
function resolveSeverityFromResult(result, exitCode) {
    if (exitCode === 2) {
        return 'usage-error';
    }
    if (!result.ok) {
        return hasBlockedActionSignal(result) ? 'blocked' : 'failure';
    }
    const warningCodes = collectMessageCodes(result.messages, 'warn');
    if (warningCodes.length > 0) {
        return 'advisory';
    }
    return 'success';
}
export function resolveCommandExitCode(input) {
    if (typeof input.cliErrorExitCode === 'number') {
        return input.cliErrorExitCode;
    }
    if (input.ok) {
        return 0;
    }
    const errorCodes = collectMessageCodes(input.messages ?? [], 'error');
    if (errorCodes.some((code) => USAGE_ERROR_MESSAGE_CODES.has(code))) {
        return 2;
    }
    return 1;
}
export function enrichCommandResult(result, options = {}) {
    const exitCode = resolveCommandExitCode({
        ok: result.ok,
        messages: result.messages,
        evidence: result.evidence,
        cliErrorExitCode: options.cliErrorExitCode
    });
    const severity = resolveSeverityFromResult(result, exitCode);
    const diagnostics = {
        errorCodes: collectMessageCodes(result.messages, 'error'),
        warningCodes: collectMessageCodes(result.messages, 'warn'),
        infoCodes: collectMessageCodes(result.messages, 'info')
    };
    const blocking = severity === 'blocked' || severity === 'failure' || severity === 'usage-error';
    const toolBridge = projectToolBridgeFields(result.evidence);
    return {
        ...result,
        ...toolBridge,
        severity,
        exitCode,
        blocking,
        diagnostics
    };
}
export function message(level, code, text, data = {}) {
    return { level, code, text, data: data };
}
export async function resolveValue(value) {
    return await Promise.resolve(value);
}
export function makeResult({ ok, command, cwd, mode = 'standalone', messages = [], evidence = {} }) {
    return { ok, command, mode, cwd, messages, evidence: evidence };
}
export function setSummaryProjection(enabled) {
    globalSummaryProjection = enabled;
}
export function setFieldsProjection(fields) {
    globalFieldsProjection = fields;
}
export function getOutputProjectionState() {
    return { outputJsonPath, summary: globalSummaryProjection, fields: globalFieldsProjection };
}
