// TASK-MAO-0024: Team Agents Wave Mode candidate planner and DAG grouping.
// Implements docs/specs/team-agents-wave-mode-v1.md §4-§6: given a set of task
// cards, produce ordered waves of cards that are safe to advance in parallel.
// Pure functions only — no IO, no lifecycle mutation. Admission detail beyond
// declared metadata (logical CID write/write proof) is delegated to the broker
// admission surface (TASK-MAO-0026); the planner fails closed on anything it
// cannot decide from declared metadata.
function normalizeSet(values) {
    return new Set((values ?? []).map((v) => v.trim()).filter((v) => v.length > 0));
}
/** A scope path is treated as a directory prefix when it ends with '/'. */
function pathsConflict(a, b) {
    if (a === b)
        return true;
    const aDir = a.endsWith('/');
    const bDir = b.endsWith('/');
    if (aDir && b.startsWith(a))
        return true;
    if (bDir && a.startsWith(b))
        return true;
    return false;
}
/**
 * Decide whether two cards may share a wave. Returns the set of block reasons;
 * an empty set means the pair is co-schedulable. Fails closed: any overlap that
 * is not provably append-safe is reported.
 */
export function pairBlockReasons(left, right, appendSafe) {
    const reasons = new Set();
    // §5 rule 5: target repo must match.
    if ((left.targetRepo ?? null) !== (right.targetRepo ?? null)) {
        reasons.add('target-repo-mismatch');
    }
    // §5 rule 6: closure authority must match.
    if ((left.closureAuthority ?? null) !== (right.closureAuthority ?? null)) {
        reasons.add('closure-authority-mismatch');
    }
    // §5 rule 7: same owner atom/map => generated-artifact contention.
    const lo = (left.ownerAtomOrMap ?? '').trim();
    const ro = (right.ownerAtomOrMap ?? '').trim();
    if (lo.length > 0 && lo === ro) {
        reasons.add('generated-artifact-contention');
    }
    // §5 rule 2/3: scope overlap. Overlap confined to append-safe files is fine.
    for (const lp of left.scopePaths) {
        for (const rp of right.scopePaths) {
            if (!pathsConflict(lp, rp))
                continue;
            const bothAppendSafe = appendSafe.has(lp) && appendSafe.has(rp) && lp === rp;
            if (bothAppendSafe)
                continue;
            // A deliverable-on-deliverable overlap is a same-artifact write/write.
            const leftDelivers = left.deliverables.includes(lp);
            const rightDelivers = right.deliverables.includes(rp);
            if (leftDelivers && rightDelivers) {
                reasons.add('same-atom-write-write');
            }
            else {
                reasons.add('scope-overlap-unknown-range');
            }
        }
    }
    return [...reasons];
}
/** A card is admissible into a wave at all only if it declares validators. */
function selfBlockReasons(card) {
    const reasons = [];
    if (normalizeSet(card.validators).size === 0) {
        reasons.push('missing-validator');
    }
    return reasons;
}
/**
 * Plan ordered waves from a set of candidate cards. Greedy: repeatedly take the
 * largest prefix of dependency-ready cards that are mutually co-schedulable,
 * deferring conflicting cards to the next round. Deterministic by task id order.
 */
export function planWaves(input) {
    const appendSafe = normalizeSet(input.appendSafePaths);
    const closed = new Set(normalizeSet(input.closedTaskIds));
    const remaining = [...input.cards].sort((a, b) => a.taskId.localeCompare(b.taskId));
    const waves = [];
    const unschedulable = [];
    let waveIndex = 0;
    let guard = remaining.length + 1;
    while (remaining.length > 0 && guard-- > 0) {
        const scheduledIds = new Set(closed);
        const accepted = [];
        const deferred = [];
        for (const card of remaining) {
            const self = selfBlockReasons(card);
            // §5 rule 1: every dependency must already be closed (outside the wave).
            const depReady = card.dependencies.every((d) => closed.has(d.trim()));
            if (!depReady) {
                // Unresolvable only if a dep is neither closed nor pending in this set.
                deferred.push(card);
                continue;
            }
            if (self.length > 0) {
                unschedulable.push({ taskId: card.taskId, reasons: self, deferredFromWave: waveIndex });
                continue;
            }
            const conflict = accepted.some((a) => pairBlockReasons(a, card, appendSafe).length > 0);
            if (conflict) {
                deferred.push(card);
            }
            else {
                accepted.push(card);
                scheduledIds.add(card.taskId);
            }
        }
        if (accepted.length === 0) {
            // No progress possible: remaining cards have unresolved dependencies.
            for (const card of remaining) {
                const missing = card.dependencies.filter((d) => !closed.has(d.trim()) && !input.cards.some((c) => c.taskId === d.trim()));
                unschedulable.push({
                    taskId: card.taskId,
                    reasons: ['depends-on-open-wave-member'],
                    deferredFromWave: waveIndex,
                    ...(missing.length ? {} : {})
                });
            }
            break;
        }
        waves.push({
            waveIndex,
            members: accepted.map((c) => ({ taskId: c.taskId }))
        });
        // Accepted cards are considered closed for the purpose of later-wave deps.
        for (const c of accepted)
            closed.add(c.taskId);
        remaining.length = 0;
        remaining.push(...deferred);
        waveIndex += 1;
    }
    return {
        schemaId: 'atm.teamWavePlan.v1',
        waves,
        unschedulable,
        totalCards: input.cards.length
    };
}
