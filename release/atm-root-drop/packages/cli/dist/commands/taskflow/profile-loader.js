import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.js';
export function buildDelegationContract(profile) {
    const openerPath = profile?.delegation?.openerPath?.trim() || null;
    const hostOpenerAvailable = openerPath !== null;
    const describeOnly = profile?.delegation?.writerInvocation?.describeOnly !== false;
    const invocable = hostOpenerAvailable && !describeOnly;
    const policy = normalizePolicy(profile?.delegation?.policy ?? null, describeOnly, hostOpenerAvailable);
    return {
        hostOpenerAvailable,
        openerPath,
        describeOnly,
        invocable,
        hint: profile?.delegation?.hint ?? 'No host opener profile loaded.',
        displayHint: profile?.delegation?.writerInvocation?.displayHint
            ?? profile?.delegationDisplayHint
            ?? null,
        generationSurface: 'tasks-new',
        policy
    };
}
export function collectMissingPrerequisites(input) {
    const missing = [];
    if (!input.profile) {
        missing.push('profile');
    }
    if (!input.profile?.delegation?.openerPath?.trim()) {
        missing.push('delegation.openerPath');
    }
    if (input.profile && input.profile.delegation.writerInvocation?.describeOnly !== false) {
        missing.push('delegation.writerInvocation.invoke');
    }
    const delegation = buildDelegationContract(input.profile);
    if (input.writeRequested) {
        if (!input.taskIdSupplied && delegation.policy.allocateTaskId.mode !== 'host-opener') {
            missing.push('task-id');
        }
        if (!input.outputPathSupplied && delegation.policy.resolveCanonicalOutputPath.mode !== 'host-opener') {
            missing.push('output');
        }
    }
    return missing;
}
export function canAutoResolveHostOpenerInputs(input) {
    const delegation = buildDelegationContract(input.profile);
    if (!delegation.invocable) {
        return false;
    }
    const canAllocate = input.taskIdSupplied || delegation.policy.allocateTaskId.mode === 'host-opener';
    const canResolvePath = input.outputPathSupplied || delegation.policy.resolveCanonicalOutputPath.mode === 'host-opener';
    return canAllocate && canResolvePath;
}
export function resolveOpenerMode(input) {
    const delegation = buildDelegationContract(input.profile);
    if (!delegation.invocable) {
        return 'template-only-fallback';
    }
    if (input.writeRequested && !canAutoResolveHostOpenerInputs(input)) {
        return 'template-only-fallback';
    }
    return 'delegated-governed';
}
export function buildTaskflowOpenDiagnostics(input) {
    const delegation = buildDelegationContract(input.profile);
    const openerMode = resolveOpenerMode(input);
    const missingPrerequisites = collectMissingPrerequisites(input);
    const codes = [];
    const messages = [];
    if (!input.profile) {
        codes.push('ATM_TASKFLOW_PROFILE_MISSING');
        messages.push('No taskflow profile was loaded; taskflow open is running in template-only-fallback mode.');
    }
    else {
        codes.push('ATM_TASKFLOW_PROFILE_LOADED');
        messages.push(`Loaded profile: ${input.profile.name}`);
    }
    if (!delegation.hostOpenerAvailable) {
        codes.push('ATM_TASKFLOW_HOST_OPENER_UNAVAILABLE');
        messages.push('Host opener path is not declared in the profile.');
    }
    else if (delegation.describeOnly) {
        codes.push('ATM_TASKFLOW_HOST_OPENER_DESCRIBE_ONLY');
        messages.push('Host opener is declared but writerInvocation is describe-only; governed write remains unavailable until an invocable opener contract is configured.');
    }
    else {
        codes.push('ATM_TASKFLOW_HOST_OPENER_INVOCABLE');
        messages.push(`Host opener is available at ${delegation.openerPath}.`);
    }
    if (openerMode === 'template-only-fallback') {
        codes.push('ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK');
        messages.push('taskflow open is in template-only-fallback mode. Use tasks new for explicit template generation or supply a governed profile contract.');
    }
    else {
        codes.push('ATM_TASKFLOW_DELEGATED_GOVERNED');
        messages.push('taskflow open can orchestrate through the delegated governed entry contract.');
    }
    if (delegation.policy.fallbackBehavior.missingPrerequisites.length > 0) {
        messages.push(`Fallback prerequisites: ${delegation.policy.fallbackBehavior.missingPrerequisites.join(', ')}`);
    }
    if (input.writeRequested && missingPrerequisites.includes('task-id')) {
        codes.push('ATM_TASKFLOW_WRITE_TASK_ID_REQUIRED');
        messages.push('Governed write requires --task-id or a host-opener numbering policy.');
    }
    if (input.writeRequested && missingPrerequisites.includes('output')) {
        codes.push('ATM_TASKFLOW_WRITE_OUTPUT_REQUIRED');
        messages.push('Governed write requires --output or a host-opener canonical output-path policy.');
    }
    if (delegation.policy.allocateTaskId.mode === 'host-opener') {
        codes.push('ATM_TASKFLOW_HOST_POLICY_NUMBERING_READY');
        messages.push('Host-neutral numbering policy is configured for delegated allocation.');
    }
    if (delegation.policy.resolveCanonicalOutputPath.mode === 'host-opener') {
        codes.push('ATM_TASKFLOW_HOST_POLICY_PATH_READY');
        messages.push('Host-neutral canonical output-path policy is configured.');
    }
    messages.push(`Generation surface: ${delegation.generationSurface}`);
    return { codes, messages, missingPrerequisites };
}
export function resolveWriteSupport(input) {
    const openerMode = resolveOpenerMode({
        ...input,
        writeRequested: false
    });
    const delegation = buildDelegationContract(input.profile);
    const missingPrerequisites = collectMissingPrerequisites(input);
    if (!input.writeRequested) {
        return {
            requested: false,
            allowed: false,
            reason: 'Write was not requested; taskflow open returned an orchestration plan only.'
        };
    }
    if (!delegation.invocable) {
        return {
            requested: true,
            allowed: false,
            reason: 'Delegated host opener prerequisites are not satisfied; taskflow open must remain in template-only-fallback mode.'
        };
    }
    if (!canAutoResolveHostOpenerInputs(input)) {
        return {
            requested: true,
            allowed: false,
            reason: 'Governed write prerequisites are incomplete; supply --task-id/--output or configure host-opener numbering and output-path policy.'
        };
    }
    if (openerMode !== 'delegated-governed') {
        return {
            requested: true,
            allowed: false,
            reason: 'Delegated governed opener mode is not active.'
        };
    }
    return {
        requested: true,
        allowed: true,
        reason: 'Delegated governed write prerequisites are satisfied; taskflow open may orchestrate tasks new as the generation surface.'
    };
}
function normalizePolicy(policy, describeOnly, hostOpenerAvailable) {
    const allocateTaskId = policy?.allocateTaskId ?? {
        mode: 'fallback',
        prefix: null,
        format: null
    };
    const resolveCanonicalOutputPath = policy?.resolveCanonicalOutputPath ?? {
        mode: 'fallback',
        pattern: null,
        directory: null
    };
    const rosterSyncPolicy = policy?.rosterSyncPolicy ?? 'follow-up-command';
    const rosterSyncIndexPath = policy?.rosterSync?.indexPath?.trim() || null;
    const fallbackBehavior = policy?.fallbackBehavior ?? {
        mode: 'template-only-fallback',
        reason: hostOpenerAvailable && describeOnly
            ? 'Host opener is describe-only, so taskflow open falls back to template-only mode.'
            : hostOpenerAvailable
                ? 'Host opener policy is missing explicit governed write instructions.'
                : 'Host opener is unavailable.'
    };
    return {
        allocateTaskId: {
            mode: allocateTaskId.mode ?? 'fallback',
            prefix: allocateTaskId.prefix?.trim() || null,
            format: allocateTaskId.format?.trim() || null
        },
        resolveCanonicalOutputPath: {
            mode: resolveCanonicalOutputPath.mode ?? 'fallback',
            pattern: resolveCanonicalOutputPath.pattern?.trim() || null,
            directory: resolveCanonicalOutputPath.directory?.trim() || null
        },
        rosterSyncPolicy,
        rosterSync: {
            indexPath: rosterSyncIndexPath
        },
        fallbackBehavior: {
            mode: fallbackBehavior.mode ?? 'template-only-fallback',
            reason: String(fallbackBehavior.reason ?? 'Fallback behavior is unspecified.'),
            missingPrerequisites: Array.isArray(fallbackBehavior.missingPrerequisites)
                ? fallbackBehavior.missingPrerequisites.map((entry) => String(entry).trim()).filter(Boolean)
                : []
        }
    };
}
export function loadProfile(profilePath) {
    const resolvedPath = path.resolve(profilePath);
    if (!fs.existsSync(resolvedPath)) {
        throw new CliError('ATM_TASKFLOW_PROFILE_NOT_FOUND', `Taskflow profile not found at path: ${profilePath}`, { exitCode: 1 });
    }
    let raw = null;
    try {
        raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    }
    catch (err) {
        throw new CliError('ATM_TASKFLOW_PROFILE_PARSE_FAILED', `Failed to parse taskflow profile: ${err instanceof Error ? err.message : String(err)}`, { exitCode: 1 });
    }
    if (!raw || typeof raw !== 'object') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Taskflow profile must be a valid JSON object.', { exitCode: 1 });
    }
    if (raw.schemaId !== 'taskflow.profile.v1') {
        throw new CliError('ATM_TASKFLOW_PROFILE_INVALID_SCHEMA_ID', `Taskflow profile has invalid or missing schemaId. Expected "taskflow.profile.v1", got: ${raw.schemaId}`, { exitCode: 1 });
    }
    // 驗證必要欄位
    if (!raw.id || typeof raw.id !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "id" field in taskflow profile.', { exitCode: 1 });
    }
    if (!raw.name || typeof raw.name !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "name" field in taskflow profile.', { exitCode: 1 });
    }
    if (!raw.repoLabel || typeof raw.repoLabel !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "repoLabel" field in taskflow profile.', { exitCode: 1 });
    }
    if (!raw.ownerRepo || typeof raw.ownerRepo !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "ownerRepo" field in taskflow profile.', { exitCode: 1 });
    }
    if (!raw.taskIdPrefix || typeof raw.taskIdPrefix !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "taskIdPrefix" field in taskflow profile.', { exitCode: 1 });
    }
    if (!raw.taskId || typeof raw.taskId !== 'object' || typeof raw.taskId.format !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "taskId.format" field in taskflow profile.', { exitCode: 1 });
    }
    if (!raw.template || typeof raw.template !== 'object' || typeof raw.template.defaultMarkdown !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "template.defaultMarkdown" field in taskflow profile.', { exitCode: 1 });
    }
    if (raw.template.namedTemplates && typeof raw.template.namedTemplates !== 'object') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Invalid "template.namedTemplates" field in taskflow profile.', { exitCode: 1 });
    }
    if (!raw.capabilities || typeof raw.capabilities !== 'object') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "capabilities" field in taskflow profile.', { exitCode: 1 });
    }
    if (typeof raw.capabilities.supportsDryRun !== 'boolean') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "capabilities.supportsDryRun" field in taskflow profile.', { exitCode: 1 });
    }
    if (typeof raw.capabilities.supportsWrite !== 'boolean') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "capabilities.supportsWrite" field in taskflow profile.', { exitCode: 1 });
    }
    if (raw.delegationDisplayHint && typeof raw.delegationDisplayHint !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Invalid "delegationDisplayHint" field in taskflow profile.', { exitCode: 1 });
    }
    if (!raw.delegation || typeof raw.delegation !== 'object' || typeof raw.delegation.hint !== 'string') {
        throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Missing or invalid "delegation.hint" field in taskflow profile.', { exitCode: 1 });
    }
    if (raw.delegation.writerInvocation) {
        if (typeof raw.delegation.writerInvocation !== 'object') {
            throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Invalid "delegation.writerInvocation" field in taskflow profile.', { exitCode: 1 });
        }
        if (raw.delegation.writerInvocation.describeOnly !== undefined && typeof raw.delegation.writerInvocation.describeOnly !== 'boolean') {
            throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Invalid "delegation.writerInvocation.describeOnly" field in taskflow profile.', { exitCode: 1 });
        }
        if (raw.delegation.writerInvocation.displayHint !== undefined && typeof raw.delegation.writerInvocation.displayHint !== 'string') {
            throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', 'Invalid "delegation.writerInvocation.displayHint" field in taskflow profile.', { exitCode: 1 });
        }
    }
    // 硬性安全限制：supportsWrite 必須為 false
    if (raw.capabilities.supportsWrite === true) {
        throw new CliError('ATM_TASKFLOW_PROFILE_WRITE_NOT_ALLOWED', 'Taskflow profile write permission is not allowed in this version. "supportsWrite" must be false.', { exitCode: 1 });
    }
    return raw;
}
