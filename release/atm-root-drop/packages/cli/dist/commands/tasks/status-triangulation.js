/**
 * TASK-RFT-0010 — tasks.status.triangulation atom.
 *
 * Strategy Map for `tasks status` / `tasks reconcile` truth triangulation.
 *
 * Compares three lifecycle sources of truth:
 *   - live ledger (task store JSON)
 *   - planning frontmatter (planning .task.md)
 *   - last transition event (event ledger JSONL)
 *
 * Owns the parity-override strategy for "planning mirror is stale but the
 * live claim still defines a unique lane" (which prevents pushing the
 * operator back through `tasks import` for an advisory drift), and emits a
 * recommendation pointing the operator at the right recovery route.
 *
 * Logic is moved verbatim from the previous inline implementation in
 * `packages/cli/src/commands/tasks.ts`. Public JSON shape of
 * `TaskStatusTriangulation` is preserved.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolvePlanAbsoluteFromStored } from '../planning-repo-root.js';
import { relativePathFrom } from '../shared.js';
import { readTaskLedgerPolicy } from '../task-ledger.js';
import { parseClaimRecord } from './task-ledger-readers.js';
import { extractFrontMatter } from './task-import-validators.js';
import { parseCsvPathList } from './task-option-parsers/helpers.js';
import { buildResidueClassification } from './residue-diagnostics.js';
export function resolvePlanningCardPath(cwd, taskDocument) {
    const source = taskDocument.source;
    if (source?.planPath) {
        const resolved = resolvePlanAbsoluteFromStored(cwd, source.planPath);
        if (existsSync(resolved))
            return resolved;
    }
    const relatedPlan = taskDocument.related_plan ?? taskDocument.relatedPlan;
    if (typeof relatedPlan === 'string' && relatedPlan.trim()) {
        const resolved = path.resolve(cwd, relatedPlan);
        if (existsSync(resolved))
            return resolved;
    }
    const aliases = taskDocument.legacyImportAliases;
    const planningFile = aliases?.allowed_files?.find((entry) => entry.endsWith('.task.md') && existsSync(entry));
    return planningFile ?? null;
}
export function readLastTransitionEventRecord(cwd, taskId, transitionId) {
    if (!transitionId)
        return null;
    const policy = readTaskLedgerPolicy(cwd);
    const eventPath = path.join(cwd, policy.eventRoot, taskId, `${transitionId}.json`);
    if (!existsSync(eventPath))
        return null;
    return JSON.parse(readFileSync(eventPath, 'utf8'));
}
/**
 * 讀取指定任務的所有 scope-amendment 事件，依時間順序排列。
 * 供 `buildTaskStatusTriangulation` 與 closeback 輸出使用，讓 reviewer 能區分
 * 正常 linked-surface 成長與可疑 scope drift。
 */
export function readScopeAmendmentEvents(cwd, taskId) {
    const policy = readTaskLedgerPolicy(cwd);
    const eventDir = path.join(cwd, policy.eventRoot, taskId);
    if (!existsSync(eventDir))
        return [];
    let files;
    try {
        files = readdirSync(eventDir)
            .filter((f) => f.includes('scope-amendment') && f.endsWith('.json'))
            .sort();
    }
    catch {
        return [];
    }
    const snapshots = [];
    for (const f of files) {
        try {
            const raw = JSON.parse(readFileSync(path.join(eventDir, f), 'utf8'));
            if (raw.action !== 'scope-amendment')
                continue;
            const meta = raw.amendmentMetadata;
            const command = typeof raw.command === 'string' ? raw.command : '';
            const addedPaths = [...parseScopeAddCommandPaths(command)];
            snapshots.push({
                transitionId: typeof raw.transitionId === 'string' ? raw.transitionId : f.replace('.json', ''),
                actorId: typeof raw.actorId === 'string' ? raw.actorId : null,
                createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
                addedPaths,
                amendmentClass: typeof meta?.amendmentClass === 'string' ? meta.amendmentClass : null,
                amendmentPhase: typeof meta?.amendmentPhase === 'string' ? meta.amendmentPhase : null,
                amendmentMode: meta?.amendmentMode === 'normal' || meta?.amendmentMode === 'repair'
                    ? meta.amendmentMode
                    : null,
                reason: typeof meta?.reason === 'string' ? meta.reason : null
            });
        }
        catch {
            // 跳過無法解析的事件檔
        }
    }
    return snapshots;
}
export function parseScopeAddCommandPaths(command) {
    const tokens = tokenizeCommand(command);
    const paths = [];
    for (let index = 0; index < tokens.length; index += 1) {
        if (tokens[index] !== '--add' && tokens[index] !== '--paths')
            continue;
        const value = tokens[index + 1];
        if (!value)
            continue;
        paths.push(...parseCsvPathList(value));
        index += 1;
    }
    return paths;
}
function tokenizeCommand(command) {
    const tokens = [];
    let current = '';
    let quote = null;
    for (let index = 0; index < command.length; index += 1) {
        const char = command[index];
        if (quote) {
            if (char === quote) {
                quote = null;
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += char;
    }
    if (current)
        tokens.push(current);
    return tokens;
}
export function normalizeParityLifecycleValue(value) {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
    return normalized || null;
}
export function isOpenPlanningParityStatus(status) {
    if (!status)
        return false;
    return ['draft', 'planned', 'open', 'ready', 'running', 'in_progress'].includes(status);
}
export function hasOnlyStatusDivergence(divergence) {
    return divergence.length > 0 && divergence.every((entry) => entry.field === 'status');
}
export function buildPlanningMirrorParityOverride(input) {
    if (!hasOnlyStatusDivergence(input.divergence))
        return null;
    const liveStatus = normalizeParityLifecycleValue(input.liveLedger.status);
    const planningStatus = normalizeParityLifecycleValue(input.planningFrontmatter.status);
    if (!isOpenPlanningParityStatus(liveStatus) || !isOpenPlanningParityStatus(planningStatus)) {
        return null;
    }
    const claimState = normalizeParityLifecycleValue(input.liveLedger.claimState);
    const lastAction = normalizeParityLifecycleValue(input.lastTransitionEvent?.action ?? null);
    const activeClaimLane = claimState === 'active' || lastAction === 'claim';
    const releasedPredecessorLane = claimState === 'released' || lastAction === 'release';
    if (!activeClaimLane && !releasedPredecessorLane) {
        return null;
    }
    const uniqueLaneStatus = activeClaimLane
        ? {
            truth: 'planning mirror is stale, but the active live claim already defines a unique governed lane',
            residue: 'Planning-mirror parity drift is advisory while the active claim remains authoritative.',
            reason: 'The live ledger claim state already identifies the governed operator lane, so the stale planning status should not force import repair or ambiguous-manual-review.'
        }
        : {
            truth: 'planning mirror is stale, but the live ledger already records an intentional release or supersede lane',
            residue: 'The predecessor task was intentionally released or superseded, so parity drift is advisory rather than repairable by import by default.',
            reason: 'The live ledger already records a unique non-claim operator story, so the stale planning status should not push the operator back through tasks import.'
        };
    return {
        residueClassification: {
            bucket: 'no-residue',
            truth: uniqueLaneStatus.truth,
            residue: uniqueLaneStatus.residue,
            reason: uniqueLaneStatus.reason,
            nextCommandTemplate: 'node atm.mjs tasks status --task <id> --json',
            nextCommand: `node atm.mjs tasks status --task ${input.taskId} --json`,
            autoMutationAllowed: false
        },
        recommendation: null
    };
}
/**
 * Triangulate live ledger / planning frontmatter / last transition event into a
 * single `TaskStatusTriangulation` envelope. The shape of the returned object
 * is part of the public `tasks status` JSON contract and must remain stable.
 */
export function buildTaskStatusTriangulation(cwd, taskId, taskDocument) {
    const claim = parseClaimRecord(taskDocument.claim);
    const liveLedger = {
        status: typeof taskDocument.status === 'string' ? taskDocument.status : null,
        claimState: claim?.state ?? null,
        lastTransitionId: typeof taskDocument.lastTransitionId === 'string' ? taskDocument.lastTransitionId : null,
        lastTransitionAt: typeof taskDocument.lastTransitionAt === 'string' ? taskDocument.lastTransitionAt : null
    };
    const lastTransitionEventRecord = readLastTransitionEventRecord(cwd, taskId, liveLedger.lastTransitionId);
    const lastTransitionEvent = lastTransitionEventRecord ? {
        action: typeof lastTransitionEventRecord.action === 'string' ? lastTransitionEventRecord.action : null,
        actorId: typeof lastTransitionEventRecord.actorId === 'string' ? lastTransitionEventRecord.actorId : null,
        createdAt: typeof lastTransitionEventRecord.createdAt === 'string' ? lastTransitionEventRecord.createdAt : null,
        fromStatus: typeof lastTransitionEventRecord.fromStatus === 'string' ? lastTransitionEventRecord.fromStatus : null,
        toStatus: typeof lastTransitionEventRecord.toStatus === 'string' ? lastTransitionEventRecord.toStatus : null
    } : null;
    const planningCardPath = resolvePlanningCardPath(cwd, taskDocument);
    let planningFrontmatter = { status: null, source: null };
    if (planningCardPath) {
        const frontMatter = extractFrontMatter(readFileSync(planningCardPath, 'utf8'));
        if (frontMatter) {
            planningFrontmatter = {
                status: typeof frontMatter.data.status === 'string' ? frontMatter.data.status : null,
                source: relativePathFrom(cwd, planningCardPath)
            };
        }
    }
    const divergence = [];
    if (planningFrontmatter.status && planningFrontmatter.status !== liveLedger.status) {
        divergence.push({
            field: 'status',
            liveLedger: liveLedger.status,
            planningFrontmatter: planningFrontmatter.status,
            lastTransitionEvent: lastTransitionEvent?.toStatus ?? null
        });
    }
    if (lastTransitionEvent?.toStatus && lastTransitionEvent.toStatus !== liveLedger.status) {
        const existing = divergence.find((entry) => entry.field === 'status');
        if (!existing) {
            divergence.push({
                field: 'status',
                liveLedger: liveLedger.status,
                lastTransitionEvent: lastTransitionEvent.toStatus
            });
        }
    }
    const residueClassification = buildResidueClassification({
        cwd,
        taskId,
        taskDocument,
        liveLedger,
        planningFrontmatter,
        lastTransitionEvent,
        divergence
    });
    const parityOverride = buildPlanningMirrorParityOverride({
        taskId,
        liveLedger,
        planningFrontmatter,
        lastTransitionEvent,
        divergence
    });
    const recommendation = parityOverride
        ? parityOverride.recommendation
        : divergence.length > 0
            ? (planningFrontmatter.status === 'done' && liveLedger.status !== 'done'
                ? `node atm.mjs tasks reconcile --task ${taskId} --actor <actor> --delivery-commit <sha> --json`
                : `node atm.mjs tasks import --from <plan.md> --write --json`)
            : null;
    const amendmentHistory = readScopeAmendmentEvents(cwd, taskId);
    return {
        ssot: 'liveLedger',
        liveLedger,
        lastTransitionEvent,
        planningFrontmatter,
        divergence,
        recommendation,
        residueClassification: parityOverride?.residueClassification ?? residueClassification,
        amendmentHistory
    };
}
