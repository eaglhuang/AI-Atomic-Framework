import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveActorWorkSession } from '../actor-session.js';
import { CliError, parseJsonText } from '../shared.js';
import { pathMatchesTaskScope, uniqueSorted } from '../git-governance/commit-scope-policy.js';
import { normalizeWorkPath } from './playbook-projection.js';
export function inspectClaimDirtyWipAdmission(input) {
    const candidateFiles = uniqueSorted(input.claimFiles.map(normalizeWorkPath).filter(isCodeClaimPath));
    if (candidateFiles.length === 0)
        return clean(input, candidateFiles);
    const dirtyFiles = readDirtyFiles(input.cwd);
    const intersectingFiles = dirtyFiles
        .map((dirty) => dirty.file)
        .filter((file) => candidateFiles.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file)));
    // Explicit adoption needs an authoritative readable snapshot, not absence inferred from a parse failure.
    const ownershipTasks = input.allowUnownedTaskScopedRecovery === true && intersectingFiles.length > 0
        ? readOwnershipTasks(input.cwd, true) : null;
    const blockers = uniqueSorted(intersectingFiles).flatMap((file) => {
        const owner = findDirtyPathOwner(input.cwd, file, ownershipTasks);
        if (isOwnedByRequestingClaim(owner, input.task.workItemId, input.actorId, input.laneSessionId)
            || (!owner && input.allowUnownedTaskScopedRecovery === true))
            return [];
        return [{
                file,
                ownership: owner ? 'foreign' : 'unowned',
                changeKinds: dirtyFiles.find((entry) => entry.file === file)?.changeKinds ?? [],
                ownerTaskId: owner?.taskId ?? null,
                ownerActorId: owner?.actorId ?? null,
                ownerSessionId: owner?.sessionId ?? null,
                ownerLaneSessionId: owner?.laneSessionId ?? null
            }];
    });
    return {
        schemaId: 'atm.claimDirtyWipAdmission.v1',
        ok: blockers.length === 0,
        taskId: input.task.workItemId,
        currentActorId: input.actorId,
        currentLaneSessionId: input.laneSessionId ?? null,
        candidateFiles,
        intersectingFiles: uniqueSorted(blockers.map((entry) => entry.file)),
        blockers
    };
}
export function assertClaimDirtyWipAdmission(input) {
    const admission = inspectClaimDirtyWipAdmission(input);
    if (admission.ok)
        return admission;
    const firstBlocker = admission.blockers[0] ?? null;
    const ownerTaskId = firstBlocker?.ownerTaskId ?? input.task.workItemId;
    const ownerActorId = firstBlocker?.ownerActorId ?? input.actorId;
    const recoveryCommands = {
        finishAndClose: `node atm.mjs taskflow close --task ${ownerTaskId} --actor ${ownerActorId} --json`,
        nonDeliveryWipCommitAndRelease: `node atm.mjs tasks release --task ${ownerTaskId} --actor ${ownerActorId} --wip-commit --reason "preserve dirty WIP" --json`,
        discardAndRelease: `node atm.mjs tasks release --task ${ownerTaskId} --actor ${ownerActorId} --discard-wip --reason "discard WIP" --json`
    };
    throw new CliError('ATM_CLAIM_FOREIGN_UNSTAGED_WIP', `Claim blocked: ${input.task.workItemId} intersects foreign or unowned dirty WIP.`, {
        exitCode: 1,
        details: {
            taskId: input.task.workItemId,
            intersectingFiles: admission.intersectingFiles,
            ownership: admission.blockers.some((entry) => entry.ownership === 'foreign') ? 'foreign' : 'unowned',
            blockers: admission.blockers,
            recoveryCommands,
            recoveryCommand: recoveryCommands.nonDeliveryWipCommitAndRelease,
            requiredAction: 'Ask the owning lane to commit/close/release, or clear unowned WIP before claiming this code scope.'
        }
    });
}
function clean(input, candidateFiles) {
    return { schemaId: 'atm.claimDirtyWipAdmission.v1', ok: true, taskId: input.task.workItemId, currentActorId: input.actorId, currentLaneSessionId: input.laneSessionId ?? null, candidateFiles, intersectingFiles: [], blockers: [] };
}
function readDirtyFiles(cwd) {
    const staged = readGitNames(cwd, ['diff', '--name-only', '--cached']);
    const unstaged = readGitNames(cwd, ['diff', '--name-only']);
    const untracked = readGitNames(cwd, ['ls-files', '--others', '--exclude-standard']);
    const byFile = new Map();
    for (const file of staged)
        addKind(byFile, file, 'staged');
    for (const file of unstaged)
        addKind(byFile, file, 'unstaged');
    for (const file of untracked)
        addKind(byFile, file, 'untracked');
    return [...byFile.entries()].map(([file, kinds]) => ({ file, changeKinds: [...kinds].sort() }));
}
function addKind(map, file, kind) {
    const normalized = normalizeWorkPath(file);
    if (!normalized)
        return;
    const bucket = map.get(normalized) ?? new Set();
    bucket.add(kind);
    map.set(normalized, bucket);
}
function readGitNames(cwd, args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0)
        return [];
    return uniqueSorted(String(result.stdout ?? '').split(/\r?\n/).map(normalizeWorkPath).filter(Boolean));
}
function ownershipUnknown(cwd, recordPath) {
    throw new CliError('ATM_CLAIM_FOREIGN_UNSTAGED_WIP', 'Cannot adopt WIP while task ownership records are unreadable or malformed.', {
        exitCode: 1,
        details: { ownership: 'unknown', taskRecord: path.relative(cwd, recordPath).replace(/\\/g, '/'),
            requiredAction: 'Inspect the task ledger through ATM and repair the ownership record before retrying adoption.' }
    });
}
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function paths(value) {
    return Array.isArray(value) && value.length > 0 && value.every(entry => nonempty(entry) && normalizeWorkPath(entry).length > 0);
}
function assertOwnershipShape(task, taskId) {
    if (!taskId)
        throw new Error('Missing task identity');
    const claim = task.claim;
    if (claim !== undefined && claim !== null) {
        if (!record(claim) || typeof claim.state !== 'string'
            || !['active', 'released', 'handoff', 'taken_over'].includes(claim.state))
            throw new Error('Invalid claim state');
        if (claim.state === 'active' && (!nonempty(claim.actorId) || !paths(claim.files)
            || (claim.laneSession !== undefined && claim.laneSession !== null
                && (!record(claim.laneSession) || !nonempty(claim.laneSession.laneSessionId)))))
            throw new Error('Incomplete active ownership');
    }
    // Existing terminal-retention semantics remain unchanged: these are no longer live owners.
    if (task.status === 'done' || task.status === 'abandoned')
        return;
    const retained = task.wipOwnership;
    if (retained !== undefined && retained !== null && (!record(retained)
        || retained.schemaId !== 'atm.retainedWipOwnership.v1' || retained.taskId !== taskId
        || !nonempty(retained.actorId) || !nonempty(retained.laneSessionId) || !paths(retained.dirtyPaths))) {
        throw new Error('Incomplete retained ownership');
    }
}
function readOwnershipTasks(cwd, strict) {
    const taskDir = path.join(cwd, '.atm', 'history', 'tasks');
    if (!strict && !existsSync(taskDir))
        return [];
    let entries;
    try {
        if (strict && !lstatSync(taskDir).isDirectory())
            throw new Error('Invalid task directory');
        entries = readdirSync(taskDir).filter(name => name.endsWith('.json')).sort();
    }
    catch (error) {
        if (strict)
            ownershipUnknown(cwd, taskDir);
        throw error;
    }
    const tasks = [];
    for (const entry of entries) {
        const recordPath = path.join(taskDir, entry);
        let fd;
        try {
            let text;
            if (strict) {
                if (!lstatSync(recordPath).isFile())
                    throw new Error('Invalid task record type');
                fd = openSync(recordPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
                if (!fstatSync(fd).isFile())
                    throw new Error('Invalid opened task record type');
                text = readFileSync(fd, 'utf8');
            }
            else
                text = readFileSync(recordPath, 'utf8');
            const task = parseJsonText(text);
            if (!record(task))
                throw new Error('Invalid task record');
            const taskId = String(task.workItemId ?? task.id ?? entry.replace(/\.json$/i, '')).trim();
            if (strict)
                assertOwnershipShape(task, taskId);
            tasks.push({ task, taskId, recordPath });
        }
        catch {
            if (strict)
                ownershipUnknown(cwd, recordPath);
        }
        finally {
            if (fd !== undefined)
                closeSync(fd);
        }
    }
    return tasks;
}
function findDirtyPathOwner(cwd, file, ownershipTasks) {
    for (const { task, taskId, recordPath } of ownershipTasks ?? readOwnershipTasks(cwd, false)) {
        try {
            const claim = task.claim && typeof task.claim === 'object' && !Array.isArray(task.claim) ? task.claim : null;
            const activeOwner = readActiveClaimOwner(cwd, taskId, claim, file);
            if (activeOwner)
                return activeOwner;
            const retainedOwner = readRetainedWipOwner(task, taskId, file);
            if (retainedOwner)
                return retainedOwner;
        }
        catch {
            if (ownershipTasks)
                ownershipUnknown(cwd, recordPath);
        }
    }
    return null;
}
function readActiveClaimOwner(cwd, taskId, claim, file) {
    if (!claim || claim.state !== 'active')
        return null;
    const files = Array.isArray(claim.files) ? claim.files.map((value) => normalizeWorkPath(String(value))).filter(Boolean) : [];
    if (!files.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file)))
        return null;
    const actorId = typeof claim.actorId === 'string' ? claim.actorId.trim() : '';
    if (!actorId)
        return null;
    const leaseId = typeof claim.leaseId === 'string' ? claim.leaseId.trim() : null;
    const session = leaseId ? resolveActorWorkSession(cwd, { claimLeaseId: leaseId, includeNonActive: true }) : null;
    const laneSession = claim.laneSession && typeof claim.laneSession === 'object' && !Array.isArray(claim.laneSession) ? claim.laneSession : null;
    return { taskId, actorId, sessionId: session?.sessionId ?? null, laneSessionId: typeof laneSession?.laneSessionId === 'string' ? laneSession.laneSessionId : session?.guidanceSessionId ?? null, authority: 'active-claim' };
}
function readRetainedWipOwner(task, taskId, file) {
    // Retained WIP protects a released, resumable operation.  Once its task is
    // terminal, it cannot remain a live owner: future admission must still see
    // the dirty byte as unowned and fail closed unless an explicit recovery path
    // authorizes it.
    if (task.status === 'done' || task.status === 'abandoned')
        return null;
    const retention = task.wipOwnership && typeof task.wipOwnership === 'object' && !Array.isArray(task.wipOwnership)
        ? task.wipOwnership
        : null;
    if (!retention || retention.schemaId !== 'atm.retainedWipOwnership.v1' || retention.taskId !== taskId)
        return null;
    const actorId = typeof retention.actorId === 'string' ? retention.actorId.trim() : '';
    const laneSessionId = typeof retention.laneSessionId === 'string' ? retention.laneSessionId.trim() : '';
    const dirtyPaths = Array.isArray(retention.dirtyPaths) ? retention.dirtyPaths.map((value) => normalizeWorkPath(String(value))).filter(Boolean) : [];
    if (!actorId || !laneSessionId || !dirtyPaths.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file)))
        return null;
    return { taskId, actorId, sessionId: null, laneSessionId, authority: 'retained-wip' };
}
function isOwnedByRequestingClaim(owner, taskId, actorId, laneSessionId) {
    if (!owner || owner.actorId !== actorId)
        return false;
    if (owner.authority === 'retained-wip')
        return owner.taskId === taskId;
    if (!laneSessionId)
        return true;
    return owner.laneSessionId === laneSessionId;
}
function isCodeClaimPath(file) {
    const normalized = normalizeWorkPath(file);
    return normalized.startsWith('packages/') || normalized.startsWith('scripts/') || normalized.startsWith('release/') || /^(?:package(?:-lock)?\.json|tsconfig(?:\..*)?\.json)$/.test(normalized);
}
