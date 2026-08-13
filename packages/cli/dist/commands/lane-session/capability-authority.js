import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.js';
import { parseClaimRecord } from '../tasks/task-ledger-readers.js';
import { readLaneSession } from './store.js';
import { capabilityFingerprint } from './redaction.js';
import { consumeProxyReceipt, findUsableProxyReceipt } from './proxy-receipt.js';
/**
 * Classify a mutation attempt without consuming any proxy receipt.
 * Use {@link authorizeLaneCapability} at a real mutation seam to also consume
 * an approved proxy receipt and emit an audit artifact.
 */
export function evaluateLaneCapability(input) {
    const cwd = path.resolve(input.cwd);
    const commandClass = input.commandClass;
    const taskId = input.taskId.trim();
    const actorId = input.actorId.trim();
    const claim = readActiveClaim(cwd, taskId);
    const ownerLaneId = claim?.laneSession?.laneSessionId ?? null;
    const ownerActorId = claim?.actorId ?? null;
    const ownerLaneFingerprint = capabilityFingerprint(ownerLaneId, 'lane');
    // Described from the same claim read that decides the outcome, so the source
    // a consumer reports cannot drift from the source that was consulted.
    const disclosure = describeOwnerLaneSource(taskId, claim);
    const executingLaneSessionId = normalizeOptionalString(input.executingLaneSessionId)
        ?? normalizeOptionalString(process.env.ATM_LANE_SESSION_ID);
    const executingLaneFingerprint = capabilityFingerprint(executingLaneSessionId, 'lane');
    // No lane-bound claim: capability binding does not apply. Attribution-only
    // flows (e.g. framework work with no owner-lane claim) are not blocked here.
    if (!ownerLaneId) {
        return decision({
            allowed: true,
            decisionClass: 'owner-lane',
            commandClass,
            taskId,
            actorId,
            ownerActorId,
            ownerLaneFingerprint,
            executingLaneFingerprint,
            proxyReceiptFingerprint: null,
            reason: 'No lane-bound active claim; capability binding does not apply.',
            laneBound: false,
            disclosure
        });
    }
    // Owner lane: the executing lane holds the exact live-claim capability.
    // Actor metadata drift is irrelevant — authority follows the lane.
    if (executingLaneSessionId && executingLaneSessionId === ownerLaneId) {
        return decision({
            allowed: true,
            decisionClass: 'owner-lane',
            commandClass,
            taskId,
            actorId,
            ownerActorId,
            ownerLaneFingerprint,
            executingLaneFingerprint,
            proxyReceiptFingerprint: null,
            reason: 'Executing lane matches the live-claim owner lane capability.',
            laneBound: true,
            disclosure
        });
    }
    // Adopted owner lane: the executing lane is a governed adoption of the owner
    // lane (same capability lineage), even before claim rebind has landed.
    if (executingLaneSessionId && isAdoptionOf(cwd, executingLaneSessionId, ownerLaneId)) {
        return decision({
            allowed: true,
            decisionClass: 'adopted-owner-lane',
            commandClass,
            taskId,
            actorId,
            ownerActorId,
            ownerLaneFingerprint,
            executingLaneFingerprint,
            proxyReceiptFingerprint: null,
            reason: 'Executing lane is a governed adoption of the owner lane capability.',
            laneBound: true,
            disclosure
        });
    }
    // Approved proxy/takeover: a governed receipt delegates this command class
    // from the owner lane to the executing lane.
    if (executingLaneSessionId) {
        const usable = findUsableProxyReceipt({
            cwd,
            taskId,
            ownerLaneId,
            executorLaneId: executingLaneSessionId,
            commandClass,
            now: input.now
        });
        if (usable) {
            return decision({
                allowed: true,
                decisionClass: 'approved-proxy',
                commandClass,
                taskId,
                actorId,
                ownerActorId,
                ownerLaneFingerprint,
                executingLaneFingerprint,
                proxyReceiptFingerprint: proxyFingerprint(usable),
                reason: `Approved ${usable.grantKind} receipt delegates ${commandClass} from owner lane to executing lane.`,
                laneBound: true,
                disclosure
            });
        }
    }
    // Borrowed actor: the attempt trusts an actor string it does not hold the
    // lane capability for. Fail closed.
    return decision({
        allowed: false,
        decisionClass: 'borrowed-actor-blocked',
        commandClass,
        taskId,
        actorId,
        ownerActorId,
        ownerLaneFingerprint,
        executingLaneFingerprint,
        proxyReceiptFingerprint: null,
        reason: executingLaneSessionId
            ? 'Executing lane does not match the owner lane capability and no proxy/takeover receipt delegates this command class.'
            : 'No executing lane capability is present; mutation authority cannot be bound to an actor string alone.',
        laneBound: true,
        disclosure
    });
}
/**
 * Enforce lane capability at a mutation seam. Throws
 * `ATM_LANE_BORROWED_ACTOR_BLOCKED` when the executing lane lacks authority.
 * When an approved proxy receipt authorizes the attempt, it is consumed
 * (single-use) and an audit artifact path is returned.
 */
export function authorizeLaneCapability(input) {
    const evaluated = evaluateLaneCapability(input);
    if (!evaluated.allowed) {
        throw new CliError('ATM_LANE_BORROWED_ACTOR_BLOCKED', evaluated.reason, {
            exitCode: 1,
            details: {
                decision: evaluated,
                // Consumed from the decision, not recomputed: the refusal reports the
                // source the refusal itself consulted (INV-ATM-012).
                disclosure: evaluated.disclosure,
                remediation: 'Execute from the owner lane, adopt the owner lane through governance, or supply a proxy/takeover receipt via node atm.mjs lane proxy grant. The owner lane is recorded on the live claim; read it with the disclosed nextCommand rather than trying lane sessions in turn.'
            }
        });
    }
    if (evaluated.decisionClass === 'approved-proxy') {
        const executingLaneSessionId = normalizeOptionalString(input.executingLaneSessionId)
            ?? normalizeOptionalString(process.env.ATM_LANE_SESSION_ID);
        const claim = readActiveClaim(path.resolve(input.cwd), input.taskId.trim());
        const ownerLaneId = claim?.laneSession?.laneSessionId ?? null;
        if (executingLaneSessionId && ownerLaneId) {
            const consumed = consumeProxyReceipt({
                cwd: input.cwd,
                taskId: input.taskId.trim(),
                ownerLaneId,
                executorLaneId: executingLaneSessionId,
                commandClass: input.commandClass,
                now: input.now,
                executingActorId: input.actorId
            });
            return { decision: evaluated, auditPath: consumed?.auditPath ?? null };
        }
    }
    return { decision: evaluated, auditPath: null };
}
/**
 * Describe the record a decision was read from. Takes the claim the caller
 * already read rather than reading it again, so the described source and the
 * consulted source are the same observation (INV-ATM-012).
 */
function describeOwnerLaneSource(taskId, claim) {
    const laneSession = claim?.laneSession ?? null;
    return {
        schemaId: 'atm.laneCapabilityRefusalDisclosure.v1',
        ownerClaimPath: `.atm/history/tasks/${taskId}.json`,
        ownerLaneRecorded: Boolean(laneSession?.laneSessionId),
        ownerLaneExportHintRecorded: Boolean(laneSession?.exportHint),
        nextCommand: `node atm.mjs tasks status --task ${taskId} --json`
    };
}
function readActiveClaim(cwd, taskId) {
    const absolutePath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(absolutePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
        const claim = parseClaimRecord(parsed.claim);
        return claim && claim.state === 'active' ? claim : null;
    }
    catch {
        return null;
    }
}
function isAdoptionOf(cwd, executingLaneSessionId, ownerLaneId) {
    const seen = new Set();
    let current = readLaneSession(cwd, executingLaneSessionId);
    while (current && !seen.has(current.laneId)) {
        seen.add(current.laneId);
        const source = current.adoptionSource;
        if (source && (source.kind === 'adoption' || source.kind === 'handoff')) {
            if (source.sourceLaneId === ownerLaneId)
                return true;
            if (!source.sourceLaneId)
                break;
            current = readLaneSession(cwd, source.sourceLaneId);
            continue;
        }
        break;
    }
    return false;
}
function proxyFingerprint(receipt) {
    return capabilityFingerprint(receipt.receiptId, 'capability');
}
function decision(input) {
    return { schemaId: 'atm.laneCapabilityDecision.v1', ...input };
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
