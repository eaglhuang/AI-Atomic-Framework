import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateAtomRefReadability } from '../../../core/dist/registry/atom-ref-readability.js';
import { resolveActorId } from './actor-registry.js';
import { runFrameworkDevelopmentGuard } from './framework-development.js';
import { evaluateGitGovernanceCheck } from './git-governance.js';
import { runCommitRangeGuard } from './hook.js';
import { CliError, makeResult, message } from './shared.js';
export function runGuard(argv) {
    const options = parseGuardArgs(argv);
    if (options.guardName === 'encoding') {
        return runEncodingGuard(options.cwd, options.files);
    }
    if (options.guardName === 'mutation') {
        return runMutationGuard(options);
    }
    if (options.guardName === 'atom-callsite-readability') {
        return runAtomCallsiteReadabilityGuard(options.cwd);
    }
    if (options.guardName === 'atomization-coverage') {
        return runAtomizationCoverageGuard(options.cwd, options.files);
    }
    if (options.guardName === 'framework-development') {
        return runFrameworkDevelopmentGuard(options.cwd, options.files, options.targetRepo);
    }
    if (options.guardName === 'commit-range') {
        return runCommitRangeGuard([...options.rawArgv]);
    }
    return runGitGuard(options);
}
function runEncodingGuard(cwd, files) {
    const findings = [];
    for (const relativeFile of files) {
        const absolutePath = path.resolve(cwd, relativeFile);
        const buffer = readFileSync(absolutePath);
        const text = buffer.toString('utf8');
        if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
            findings.push({ file: relativeFile, issue: 'utf8-bom' });
        }
        if (text.includes('\uFFFD')) {
            findings.push({ file: relativeFile, issue: 'replacement-character' });
        }
        const possibleMojibakePattern = /[\u00c3\u00e2\u00e5].|\u749d.|\u7587.|\u765f./;
        if (possibleMojibakePattern.test(text)) {
            findings.push({ file: relativeFile, issue: 'possible-mojibake' });
        }
    }
    return makeResult({
        ok: findings.length === 0,
        command: 'guard',
        cwd,
        messages: [findings.length === 0 ? message('info', 'ATM_GUARD_ENCODING_OK', 'Encoding guard passed.') : message('error', 'ATM_GUARD_ENCODING_FAILED', 'Encoding guard found issues.', { findingCount: findings.length })],
        evidence: {
            guard: 'encoding',
            files,
            findings
        }
    });
}
function runMutationGuard(options) {
    const resolvedActor = resolveActorId(options.actorId ?? undefined);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'guard mutation requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'guard mutation requires --task <work-item-id>.', { exitCode: 2 });
    }
    if (options.files.length === 0) {
        throw new CliError('ATM_CLI_USAGE', 'guard mutation requires --files <csv>.', { exitCode: 2 });
    }
    const taskPath = path.join(options.cwd, '.atm', 'history', 'tasks', `${options.taskId}.json`);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
            exitCode: 2,
            details: { taskId: options.taskId }
        });
    }
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
    const claim = parseTaskClaim(taskDocument.claim);
    const actorId = resolvedActor.actorId;
    const violations = [];
    if (!claim || claim.state !== 'active') {
        violations.push({
            code: 'claim-missing',
            detail: `Task ${options.taskId} has no active claim.`
        });
    }
    else {
        if (claim.actorId !== actorId) {
            violations.push({
                code: 'claim-owner-mismatch',
                detail: `Task ${options.taskId} claim owner is ${claim.actorId}, not ${actorId}.`
            });
        }
        const claimScope = new Set(claim.files.map((entry) => normalizeRelativePath(entry)));
        const outOfScope = options.files.filter((entry) => !claimScope.has(normalizeRelativePath(entry)));
        if (outOfScope.length > 0) {
            violations.push({
                code: 'scope-outside',
                detail: `Files outside claimed scope: ${outOfScope.join(', ')}`
            });
        }
    }
    const lockPath = path.join(options.cwd, '.atm', 'runtime', 'locks', `${options.taskId}.lock.json`);
    if (existsSync(lockPath)) {
        const lockRecord = JSON.parse(readFileSync(lockPath, 'utf8'));
        const lockedBy = typeof lockRecord.lockedBy === 'string' ? lockRecord.lockedBy : null;
        if (lockedBy && lockedBy !== actorId) {
            violations.push({
                code: 'lock-owner-mismatch',
                detail: `Lock owner is ${lockedBy}, not ${actorId}.`
            });
        }
    }
    return makeResult({
        ok: violations.length === 0 || options.failOpen,
        command: 'guard',
        cwd: options.cwd,
        messages: [violations.length === 0
                ? message('info', 'ATM_GUARD_MUTATION_OK', 'Mutation guard passed for claimed task scope.')
                : options.failOpen
                    ? message('warning', 'ATM_GUARD_MUTATION_FAIL_OPEN', 'Mutation guard found violations but continued in fail-open mode.', { violations })
                    : message('error', 'ATM_GUARD_MUTATION_FAILED', 'Mutation guard failed.', { violations })],
        evidence: {
            guard: 'mutation',
            taskId: options.taskId,
            actorId,
            files: options.files,
            failOpen: options.failOpen,
            violations
        }
    });
}
function runGitGuard(options) {
    const check = evaluateGitGovernanceCheck({
        cwd: options.cwd,
        actorInput: options.actorId,
        taskId: options.taskId,
        requireTrailers: true
    });
    return makeResult({
        ok: check.ok || options.failOpen,
        command: 'guard',
        cwd: options.cwd,
        messages: [check.ok
                ? message('info', 'ATM_GUARD_GIT_OK', 'Git governance guard passed.')
                : options.failOpen
                    ? message('warning', 'ATM_GUARD_GIT_FAIL_OPEN', 'Git governance guard found violations but continued in fail-open mode.', { violations: check.violations })
                    : message('error', 'ATM_GUARD_GIT_FAILED', 'Git governance guard failed.', { violations: check.violations })],
        evidence: {
            guard: 'git',
            actorId: check.actorId,
            taskId: check.taskId,
            claimLeaseId: check.claimLeaseId,
            trailers: check.trailers,
            failOpen: options.failOpen,
            violations: check.violations
        }
    });
}
function runAtomCallsiteReadabilityGuard(cwd) {
    const report = validateAtomRefReadability(cwd);
    return makeResult({
        ok: report.ok,
        command: 'guard',
        cwd,
        messages: [report.ok
                ? message('info', 'ATM_GUARD_ATOM_CALLSITE_READABILITY_OK', 'Atom/map callsite readability guard passed.')
                : message('error', 'ATM_GUARD_ATOM_CALLSITE_READABILITY_FAILED', 'Atom/map callsite readability guard found violations.', { violationCount: report.violationCount })],
        evidence: {
            guard: 'atom-callsite-readability',
            report
        }
    });
}
function runAtomizationCoverageGuard(cwd, files) {
    const scriptPath = path.resolve(cwd, 'scripts', 'validate-atomization-coverage.ts');
    if (!existsSync(scriptPath)) {
        return makeResult({
            ok: false,
            command: 'guard',
            cwd,
            messages: [
                message('error', 'ATM_GUARD_ATOMIZATION_COVERAGE_SCRIPT_MISSING', 'scripts/validate-atomization-coverage.ts is missing. Run TASK-ASA-0004.', {})
            ],
            evidence: { guard: 'atomization-coverage' }
        });
    }
    const newPaths = files.length > 0 ? `--new-paths "${files.join(',')}"` : '';
    const cmd = `node --strip-types "${scriptPath}" --mode guard --repo "${cwd}" ${newPaths}`.trim();
    let stdout = '';
    let exitCode = 0;
    try {
        stdout = execSync(cmd, { encoding: 'utf8' });
    }
    catch (err) {
        stdout = err.stdout?.toString() ?? '';
        exitCode = err.status ?? 1;
    }
    let report = {};
    try {
        report = JSON.parse(stdout);
    }
    catch { }
    const violations = report.violations ?? [];
    return makeResult({
        ok: exitCode === 0,
        command: 'guard',
        cwd,
        messages: exitCode === 0
            ? [message('info', 'ATM_GUARD_ATOMIZATION_COVERAGE_OK', 'Atomization coverage guard passed: every new production source has atom/map ownership or explicit exclusion reason.')]
            : [message('error', 'ATM_GUARD_ATOMIZATION_COVERAGE_FAILED', `Atomization coverage guard found ${violations.length} violations.`, { violations })],
        evidence: {
            guard: 'atomization-coverage',
            schemaId: report.schemaId,
            report
        }
    });
}
function parseGuardArgs(argv) {
    const state = {
        cwd: process.cwd(),
        guardName: null,
        files: [],
        taskId: null,
        actorId: null,
        targetRepo: null,
        failOpen: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            state.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--repo') {
            state.cwd = requireValue(argv, index, '--repo');
            index += 1;
            continue;
        }
        if (arg === '--target-repo') {
            state.targetRepo = requireValue(argv, index, '--target-repo');
            index += 1;
            continue;
        }
        if (arg === '--files') {
            state.files = requireValue(argv, index, '--files').split(',').map((entry) => normalizeRelativePath(entry)).filter(Boolean);
            index += 1;
            continue;
        }
        if (arg === '--task') {
            state.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            state.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        if (arg === '--fail-open') {
            state.failOpen = true;
            continue;
        }
        if (state.guardName === 'commit-range' && (arg === '--base' || arg === '--head')) {
            requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `guard does not support option ${arg}`, { exitCode: 2 });
        }
        if (state.guardName) {
            throw new CliError('ATM_CLI_USAGE', 'guard accepts only one guard name', { exitCode: 2 });
        }
        if (arg !== 'encoding' && arg !== 'mutation' && arg !== 'git' && arg !== 'atom-callsite-readability' && arg !== 'atomization-coverage' && arg !== 'framework-development' && arg !== 'commit-range') {
            throw new CliError('ATM_CLI_USAGE', 'guard supports only: encoding, mutation, git, atom-callsite-readability, atomization-coverage, framework-development, commit-range', { exitCode: 2 });
        }
        state.guardName = arg;
    }
    if (!state.guardName) {
        throw new CliError('ATM_CLI_USAGE', 'guard requires a guard name', { exitCode: 2 });
    }
    if (state.guardName === 'encoding' && state.files.length === 0) {
        throw new CliError('ATM_CLI_USAGE', 'guard encoding requires --files <comma-separated-paths>', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(state.cwd),
        guardName: state.guardName,
        files: state.files,
        taskId: state.taskId,
        actorId: state.actorId,
        targetRepo: state.targetRepo,
        failOpen: state.failOpen,
        rawArgv: argv
    };
}
function parseTaskClaim(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const candidate = value;
    const actorId = typeof candidate.actorId === 'string' ? candidate.actorId.trim() : '';
    const stateRaw = typeof candidate.state === 'string' ? candidate.state.trim() : 'active';
    const state = stateRaw === 'released' || stateRaw === 'handoff' || stateRaw === 'taken_over' ? stateRaw : 'active';
    const files = Array.isArray(candidate.files)
        ? candidate.files.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => normalizeRelativePath(entry))
        : [];
    if (!actorId || files.length === 0) {
        return null;
    }
    return { actorId, state, files };
}
function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function requireValue(argv, optionIndex, optionName) {
    const value = argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `guard requires a value for ${optionName}`, { exitCode: 2 });
    }
    return value;
}
