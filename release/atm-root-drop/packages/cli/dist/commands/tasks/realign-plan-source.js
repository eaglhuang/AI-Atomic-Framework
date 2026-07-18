import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError, makeResult, message } from '../shared.js';
import { resolvePlanAbsoluteFromStored, toStoredPlanningPath } from '../planning-repo-root.js';
import { buildPlanningSourceSeal } from './import-task.js';
const PROTECTED_LIFECYCLE_FIELDS = [
    'status',
    'closedAt',
    'closurePacket',
    'owner',
    'claim',
    'taskDirectionLock'
];
function normalizeStoredPath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function sha256Text(text) {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
export function parseRealignMapFile(mapPath) {
    if (!existsSync(mapPath)) {
        throw new CliError('ATM_CLI_USAGE', `tasks realign-plan-source --map file not found: ${mapPath}`, { exitCode: 2 });
    }
    const raw = JSON.parse(readFileSync(mapPath, 'utf8'));
    if (Array.isArray(raw)) {
        return parseMappingEntries(raw);
    }
    if (raw && typeof raw === 'object') {
        const record = raw;
        if (Array.isArray(record.mappings)) {
            return parseMappingEntries(record.mappings);
        }
        return Object.entries(record).map(([from, to]) => {
            if (typeof to !== 'string' || !to.trim()) {
                throw new CliError('ATM_CLI_USAGE', `tasks realign-plan-source map value for ${from} must be a non-empty string.`, { exitCode: 2 });
            }
            return { from: normalizeStoredPath(from), to: normalizeStoredPath(to) };
        });
    }
    throw new CliError('ATM_CLI_USAGE', 'tasks realign-plan-source --map must be a JSON object or array.', { exitCode: 2 });
}
function parseMappingEntries(entries) {
    return entries.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new CliError('ATM_CLI_USAGE', `tasks realign-plan-source map[${index}] must be an object with from/to.`, { exitCode: 2 });
        }
        const record = entry;
        const from = typeof record.from === 'string' ? normalizeStoredPath(record.from) : '';
        const to = typeof record.to === 'string' ? normalizeStoredPath(record.to) : '';
        if (!from || !to) {
            throw new CliError('ATM_CLI_USAGE', `tasks realign-plan-source map[${index}] requires non-empty from/to strings.`, { exitCode: 2 });
        }
        return { from, to };
    });
}
export function parseRealignPlanSourceArgv(argv) {
    let cwd = process.cwd();
    let mapPath = null;
    let dryRun = false;
    let write = false;
    let actorId = null;
    let planningRepoRoot = null;
    let json = false;
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--cwd') {
            cwd = path.resolve(argv[++i] ?? cwd);
            continue;
        }
        if (token === '--map') {
            mapPath = path.resolve(cwd, argv[++i] ?? '');
            continue;
        }
        if (token === '--dry-run') {
            dryRun = true;
            continue;
        }
        if (token === '--write') {
            write = true;
            continue;
        }
        if (token === '--actor') {
            actorId = String(argv[++i] ?? '').trim() || null;
            continue;
        }
        if (token === '--planning-repo' || token === '--planning-repo-root') {
            planningRepoRoot = path.resolve(argv[++i] ?? '');
            continue;
        }
        if (token === '--json') {
            json = true;
            continue;
        }
        if (token === '--help' || token === '-h') {
            throw new CliError('ATM_CLI_USAGE', 'tasks realign-plan-source --map <from-to.json> [--dry-run|--write] [--actor <id>] [--planning-repo <path>] [--json]', { exitCode: 2 });
        }
        throw new CliError('ATM_CLI_USAGE', `tasks realign-plan-source unrecognized argument: ${token}`, { exitCode: 2 });
    }
    if (!mapPath) {
        throw new CliError('ATM_CLI_USAGE', 'tasks realign-plan-source requires --map <from-to.json>.', { exitCode: 2 });
    }
    if (dryRun === write) {
        throw new CliError('ATM_CLI_USAGE', 'tasks realign-plan-source requires exactly one of --dry-run or --write.', { exitCode: 2 });
    }
    if (write && !actorId && !process.env.ATM_ACTOR_ID?.trim()) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks realign-plan-source --write requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    return {
        cwd,
        mapPath,
        dryRun,
        write,
        actorId: actorId ?? process.env.ATM_ACTOR_ID?.trim() ?? null,
        planningRepoRoot,
        json
    };
}
function listTaskLedgerFiles(cwd) {
    const tasksDir = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(tasksDir))
        return [];
    return readdirSync(tasksDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(tasksDir, name))
        .sort((left, right) => left.localeCompare(right));
}
function readSeal(taskDocument) {
    const source = taskDocument.source;
    if (!source || typeof source !== 'object' || Array.isArray(source))
        return null;
    const seal = source.planningSourceSeal;
    if (!seal || typeof seal !== 'object' || Array.isArray(seal))
        return null;
    const record = seal;
    if (record.schemaId !== 'atm.planningSourceSeal.v1')
        return null;
    if (typeof record.taskCardPath !== 'string' || typeof record.contentDigest !== 'string')
        return null;
    return {
        schemaId: 'atm.planningSourceSeal.v1',
        repoIdentity: typeof record.repoIdentity === 'string' ? record.repoIdentity : '',
        repoRoot: typeof record.repoRoot === 'string' ? record.repoRoot : '',
        taskCardPath: normalizeStoredPath(record.taskCardPath),
        planningCommitSha: typeof record.planningCommitSha === 'string' ? record.planningCommitSha : null,
        contentDigest: record.contentDigest,
        amendmentEpoch: Number(record.amendmentEpoch ?? 0),
        sealedAt: typeof record.sealedAt === 'string' ? record.sealedAt : new Date(0).toISOString()
    };
}
function resolveMappedPath(planPath, mappings) {
    const normalized = normalizeStoredPath(planPath);
    for (const mapping of mappings) {
        if (normalized === mapping.from || normalized.endsWith(`/${mapping.from}`) || normalized.endsWith(mapping.from)) {
            return mapping.to;
        }
    }
    return null;
}
function snapshotProtectedFields(taskDocument) {
    const snapshot = {};
    for (const field of PROTECTED_LIFECYCLE_FIELDS) {
        snapshot[field] = structuredClone(taskDocument[field] ?? null);
    }
    return snapshot;
}
function assertProtectedFieldsUnchanged(before, after) {
    const unchanged = [];
    for (const field of PROTECTED_LIFECYCLE_FIELDS) {
        const left = JSON.stringify(before[field] ?? null);
        const right = JSON.stringify(after[field] ?? null);
        if (left !== right) {
            throw new CliError('ATM_TASKS_REALIGN_PROTECTED_FIELD_MUTATION', `tasks realign-plan-source refused to mutate protected lifecycle field: ${field}.`, { exitCode: 1, details: { field, before: before[field] ?? null, after: after[field] ?? null } });
        }
        unchanged.push(field);
    }
    return unchanged;
}
export function buildRealignProposals(input) {
    const proposals = [];
    const planningCwd = input.planningRepoRoot?.trim() || process.env.ATM_PLANNING_REPO_ROOT?.trim() || input.cwd;
    for (const taskPath of listTaskLedgerFiles(input.cwd)) {
        const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
        const taskId = typeof taskDocument.workItemId === 'string' ? taskDocument.workItemId : path.basename(taskPath, '.json');
        const status = typeof taskDocument.status === 'string' ? taskDocument.status : '';
        const source = taskDocument.source && typeof taskDocument.source === 'object' && !Array.isArray(taskDocument.source)
            ? taskDocument.source
            : null;
        const planPath = source && typeof source.planPath === 'string' ? normalizeStoredPath(source.planPath) : '';
        const sealed = readSeal(taskDocument);
        if (status !== 'done' && status !== 'abandoned') {
            proposals.push({
                taskId,
                taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
                previousPlanPath: planPath,
                nextPlanPath: planPath,
                previousSealTaskCardPath: sealed?.taskCardPath ?? null,
                nextSealTaskCardPath: sealed?.taskCardPath ?? '',
                contentDigest: sealed?.contentDigest ?? '',
                protectedFieldsUnchanged: [...PROTECTED_LIFECYCLE_FIELDS],
                decision: 'skip-not-closed',
                reason: `status=${status || '<missing>'} is not a closed ledger state`
            });
            continue;
        }
        if (!planPath) {
            proposals.push({
                taskId,
                taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
                previousPlanPath: '',
                nextPlanPath: '',
                previousSealTaskCardPath: sealed?.taskCardPath ?? null,
                nextSealTaskCardPath: '',
                contentDigest: sealed?.contentDigest ?? '',
                protectedFieldsUnchanged: [...PROTECTED_LIFECYCLE_FIELDS],
                decision: 'skip-no-mapping',
                reason: 'no source.planPath present'
            });
            continue;
        }
        const mapped = resolveMappedPath(planPath, input.mappings);
        if (!mapped) {
            proposals.push({
                taskId,
                taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
                previousPlanPath: planPath,
                nextPlanPath: planPath,
                previousSealTaskCardPath: sealed?.taskCardPath ?? null,
                nextSealTaskCardPath: sealed?.taskCardPath ?? planPath,
                contentDigest: sealed?.contentDigest ?? '',
                protectedFieldsUnchanged: [...PROTECTED_LIFECYCLE_FIELDS],
                decision: 'skip-no-mapping',
                reason: 'planPath does not match any --map from entry'
            });
            continue;
        }
        const absoluteNew = resolvePlanAbsoluteFromStored(planningCwd, mapped);
        if (!existsSync(absoluteNew)) {
            throw new CliError('ATM_TASKS_REALIGN_TARGET_MISSING', `Mapped planning card is missing for ${taskId}: ${mapped}`, { exitCode: 1, details: { taskId, mapped, absoluteNew } });
        }
        const planText = readFileSync(absoluteNew, 'utf8');
        const nextDigest = sha256Text(planText);
        const previousDigest = sealed?.contentDigest ?? '';
        if (previousDigest && previousDigest !== nextDigest) {
            proposals.push({
                taskId,
                taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
                previousPlanPath: planPath,
                nextPlanPath: mapped,
                previousSealTaskCardPath: sealed?.taskCardPath ?? null,
                nextSealTaskCardPath: toStoredPlanningPath(planningCwd, absoluteNew),
                contentDigest: previousDigest,
                protectedFieldsUnchanged: [...PROTECTED_LIFECYCLE_FIELDS],
                decision: 'refuse-digest-mismatch',
                reason: `contentDigest mismatch: sealed=${previousDigest} current=${nextDigest}`
            });
            continue;
        }
        const nextSealPath = toStoredPlanningPath(planningCwd, absoluteNew);
        proposals.push({
            taskId,
            taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
            previousPlanPath: planPath,
            nextPlanPath: mapped,
            previousSealTaskCardPath: sealed?.taskCardPath ?? null,
            nextSealTaskCardPath: nextSealPath,
            contentDigest: previousDigest || nextDigest,
            protectedFieldsUnchanged: [...PROTECTED_LIFECYCLE_FIELDS],
            decision: 'realign',
            reason: 'pure move: contentDigest unchanged'
        });
    }
    return proposals;
}
function applyRealignToDocument(taskDocument, proposal, planningCwd) {
    const before = snapshotProtectedFields(taskDocument);
    const source = taskDocument.source && typeof taskDocument.source === 'object' && !Array.isArray(taskDocument.source)
        ? { ...taskDocument.source }
        : {};
    const absoluteNew = resolvePlanAbsoluteFromStored(planningCwd, proposal.nextPlanPath);
    const nextSeal = buildPlanningSourceSeal({
        cwd: planningCwd,
        planAbsolute: absoluteNew,
        sealedAt: typeof source.planningSourceSeal?.sealedAt === 'string'
            ? source.planningSourceSeal.sealedAt
            : new Date().toISOString()
    });
    // Preserve sealed contentDigest / amendmentEpoch / sealedAt for pure-move proof.
    const previousSeal = readSeal(taskDocument);
    source.planPath = proposal.nextPlanPath;
    source.planningSourceSeal = {
        ...nextSeal,
        contentDigest: previousSeal?.contentDigest ?? nextSeal.contentDigest,
        amendmentEpoch: previousSeal?.amendmentEpoch ?? nextSeal.amendmentEpoch,
        sealedAt: previousSeal?.sealedAt ?? nextSeal.sealedAt
    };
    const nextDocument = {
        ...taskDocument,
        source
    };
    assertProtectedFieldsUnchanged(before, snapshotProtectedFields(nextDocument));
    return nextDocument;
}
export function assertCommitContainsPaths(input) {
    const output = execFileSync('git', ['show', '--name-only', '--pretty=format:', input.commitSha], {
        cwd: input.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const committed = new Set(output
        .split(/\r?\n/)
        .map((line) => normalizeStoredPath(line))
        .filter(Boolean));
    const missing = input.expectedPaths
        .map((entry) => normalizeStoredPath(entry))
        .filter((entry) => entry.length > 0 && !committed.has(entry));
    if (missing.length > 0) {
        throw new CliError('ATM_GIT_RECORD_COMMIT_PAYLOAD_DROPPED', `Commit ${input.commitSha} dropped explicitly staged record file(s): ${missing.join(', ')}.`, {
            exitCode: 1,
            details: {
                commitSha: input.commitSha,
                missing,
                expectedPaths: input.expectedPaths,
                committedPaths: [...committed]
            }
        });
    }
}
function commitWithTemporaryIndex(input) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-realign-index-'));
    const tempIndex = path.join(tempDir, 'index');
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    try {
        execFileSync('git', ['read-tree', 'HEAD'], { cwd: input.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const relative of input.files) {
            execFileSync('git', ['add', '--', relative], { cwd: input.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        }
        const tree = execFileSync('git', ['write-tree'], { cwd: input.cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        const parent = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        const message = `${input.message}\n\nATM-Actor: ${input.actorId}\nATM-Realign-Plan-Source: true\n`;
        const commitSha = execFileSync('git', ['commit-tree', tree, '-p', parent, '-m', message], {
            cwd: input.cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        execFileSync('git', ['update-ref', 'HEAD', commitSha], { cwd: input.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        assertCommitContainsPaths({ cwd: input.cwd, commitSha, expectedPaths: input.files });
        return commitSha;
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
export async function runTasksRealignPlanSource(argv) {
    const options = parseRealignPlanSourceArgv(argv);
    const mappings = parseRealignMapFile(options.mapPath);
    const proposals = buildRealignProposals({
        cwd: options.cwd,
        mappings,
        planningRepoRoot: options.planningRepoRoot
    });
    const refusals = proposals.filter((entry) => entry.decision === 'refuse-digest-mismatch');
    if (refusals.length > 0 && options.write) {
        throw new CliError('ATM_TASKS_REALIGN_DIGEST_MISMATCH', `tasks realign-plan-source refused ${refusals.length} digest-mismatched task(s).`, { exitCode: 1, details: { refusals } });
    }
    const realignable = proposals.filter((entry) => entry.decision === 'realign');
    if (options.dryRun) {
        return makeResult({
            ok: true,
            command: 'tasks realign-plan-source',
            cwd: options.cwd,
            messages: [
                message('info', 'ATM_TASKS_REALIGN_PLAN_SOURCE_DRY_RUN', `Dry-run proposed ${realignable.length} realignments.`, {
                    proposed: realignable.length,
                    refused: refusals.length,
                    skipped: proposals.length - realignable.length - refusals.length
                })
            ],
            evidence: {
                action: 'realign-plan-source',
                dryRun: true,
                mapPath: options.mapPath,
                mappings,
                proposals,
                protectedLifecycleFields: [...PROTECTED_LIFECYCLE_FIELDS]
            }
        });
    }
    const planningCwd = options.planningRepoRoot?.trim() || process.env.ATM_PLANNING_REPO_ROOT?.trim() || options.cwd;
    const writtenPaths = [];
    for (const proposal of realignable) {
        const absoluteTaskPath = path.resolve(options.cwd, proposal.taskPath);
        const current = JSON.parse(readFileSync(absoluteTaskPath, 'utf8'));
        const next = applyRealignToDocument(current, proposal, planningCwd);
        mkdirSync(path.dirname(absoluteTaskPath), { recursive: true });
        writeFileSync(absoluteTaskPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        writtenPaths.push(proposal.taskPath);
    }
    const actorId = options.actorId ?? 'realign-actor';
    let commitSha = null;
    if (writtenPaths.length > 0) {
        commitSha = commitWithTemporaryIndex({
            cwd: options.cwd,
            files: writtenPaths,
            message: `atm: realign closed-ledger planning source paths (${writtenPaths.length} tasks)`,
            actorId
        });
    }
    return makeResult({
        ok: true,
        command: 'tasks realign-plan-source',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_TASKS_REALIGN_PLAN_SOURCE_OK', `Realigned ${writtenPaths.length} closed ledger planning source path(s).`, {
                written: writtenPaths.length,
                commitSha
            })
        ],
        evidence: {
            action: 'realign-plan-source',
            dryRun: false,
            mapPath: options.mapPath,
            mappings,
            proposals,
            writtenPaths,
            commitSha,
            temporaryIndex: true,
            protectedLifecycleFields: [...PROTECTED_LIFECYCLE_FIELDS]
        }
    });
}
export const REALIGN_PROTECTED_LIFECYCLE_FIELDS = PROTECTED_LIFECYCLE_FIELDS;
