import { createHash } from 'node:crypto';
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function sha256Json(value) {
    return `sha256:${createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`).digest('hex')}`;
}
function idempotencyKey(input) {
    return [
        'atm-cross-authority-closeback',
        input.taskId.trim().toUpperCase(),
        input.authority,
        input.kind,
        input.head ?? 'no-head',
        input.digest ?? 'no-digest'
    ].join(':');
}
function defaultRecoveryCommand(taskId) {
    return `node atm.mjs taskflow diagnose --task ${taskId} --json`;
}
function recoveryCommand(ports, taskId, authority, phase, disposition) {
    return ports.recoveryCommandFor?.({ taskId, authority, phase, disposition }) ?? defaultRecoveryCommand(taskId);
}
function defaultForbiddenActions(owner) {
    return [
        `Do not bypass the ${owner} gate with raw git commands.`,
        'Do not use --force, --no-verify, or manual .atm edits unless an explicit emergency lane says so.',
        'Do not mutate another authority while this blocker owns the recovery lane.'
    ];
}
function recoveryLane(input) {
    const command = input.command === undefined
        ? recoveryCommand(input.ports, input.taskId, input.owner, input.phase, input.disposition)
        : input.command;
    return {
        disposition: input.disposition,
        owner: input.owner,
        command,
        reason: input.reason,
        forbiddenActions: defaultForbiddenActions(input.owner),
        emergency: input.emergency === true
    };
}
function addBlocker(blockers, input) {
    blockers.push({
        code: input.code,
        summary: input.summary,
        owner: input.lane.owner,
        recoveryLane: input.lane,
        forbiddenActions: input.lane.forbiddenActions,
        recoveryCommand: input.lane.command ?? ''
    });
}
function completedCommitFor(sideEffects, authority) {
    return sideEffects.find((effect) => effect.authority === authority && effect.kind === 'commit' && effect.status === 'completed')?.commitSha ?? null;
}
function authorityRemoteVisible(authority, commitSha) {
    if (authority.remoteVisibilityRequired !== true)
        return true;
    return Boolean(commitSha && authority.remoteReachableCommit === commitSha);
}
function derivePhase(input) {
    if (input.targetCommit && input.planningCommit && input.targetRemoteVisible && input.planningRemoteVisible) {
        return 'both-committed';
    }
    if (input.targetCommit && input.planningCommit)
        return 'closeback-pending';
    if (input.targetCommit)
        return 'target-committed';
    if (input.planningCommit)
        return 'planning-committed';
    return 'prepared';
}
function buildStep(input) {
    const id = `${input.authority}:${input.kind}`;
    return {
        id,
        authority: input.authority,
        kind: input.kind,
        idempotencyKey: idempotencyKey(input),
        recoveryCommand: recoveryCommand(input.ports, input.taskId, input.authority, input.phase) ?? defaultRecoveryCommand(input.taskId)
    };
}
function uniqueRecoveryLanes(lanes) {
    const seen = new Set();
    const result = [];
    for (const lane of lanes) {
        const key = `${lane.owner}:${lane.disposition}:${lane.command ?? '<none>'}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(lane);
    }
    return result;
}
function detectRecoveryCycles(input) {
    const graph = new Map();
    for (const observation of input.observations) {
        graph.set(observation.owner, new Set(observation.blockedBy));
    }
    for (const [owner] of graph) {
        const stack = [];
        const seen = new Set();
        const visit = (node) => {
            if (stack.includes(node)) {
                const nodes = stack.slice(stack.indexOf(node));
                return {
                    nodes,
                    summary: `Recovery cycle detected among ${nodes.join(' -> ')}.`,
                    nextLegalRecoveryLane: recoveryLane({
                        taskId: input.taskId,
                        owner: 'runner-sync',
                        phase: input.phase,
                        disposition: 'recover',
                        reason: 'Break close recovery cycles by making the frozen runner match source before pre-push, evidence, or close retries.',
                        ports: input.ports
                    })
                };
            }
            if (seen.has(node))
                return null;
            seen.add(node);
            stack.push(node);
            for (const next of graph.get(node) ?? []) {
                const cycle = visit(next);
                if (cycle)
                    return cycle;
            }
            stack.pop();
            return null;
        };
        const cycle = visit(owner);
        if (cycle)
            return [cycle];
    }
    return [];
}
function closeReadyLane(taskId, phase, ports) {
    return recoveryLane({
        taskId,
        owner: 'global',
        phase,
        disposition: 'execute-now',
        reason: 'All closeback authorities are ready; execute the next idempotent saga step.',
        ports
    });
}
export function executeTaskCloseSaga(request, snapshot, ports = {}) {
    const targetFiles = uniqueSorted(request.targetFiles);
    const planningFiles = uniqueSorted(request.planningFiles);
    const sideEffectJournal = [...(snapshot.completedSideEffects ?? [])];
    const targetCommit = completedCommitFor(sideEffectJournal, 'target');
    const planningCommit = completedCommitFor(sideEffectJournal, 'planning');
    const targetRemoteVisible = authorityRemoteVisible(snapshot.target, targetCommit);
    const planningRemoteVisible = authorityRemoteVisible(snapshot.planning, planningCommit);
    const phase = derivePhase({ targetCommit, planningCommit, targetRemoteVisible, planningRemoteVisible });
    const blockers = [];
    const recoveryLanes = [];
    if (!snapshot.target.writeable) {
        const lane = recoveryLane({
            taskId: request.taskId,
            owner: 'target',
            phase,
            disposition: 'human-required',
            reason: 'Target authority is not writeable; an operator must restore or choose the authority before close can proceed.',
            ports,
            command: null
        });
        recoveryLanes.push(lane);
        addBlocker(blockers, {
            code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
            summary: 'Target authority is not writeable at prepare time.',
            lane
        });
    }
    if (!snapshot.planning.writeable) {
        const lane = recoveryLane({
            taskId: request.taskId,
            owner: 'planning',
            phase,
            disposition: 'human-required',
            reason: 'Planning authority is not writeable; an operator must restore or choose the authority before close can proceed.',
            ports,
            command: null
        });
        recoveryLanes.push(lane);
        addBlocker(blockers, {
            code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
            summary: 'Planning authority is not writeable at prepare time.',
            lane
        });
    }
    if (snapshot.target.remoteVisibilityRequired === true && targetCommit && !targetRemoteVisible) {
        const lane = recoveryLane({
            taskId: request.taskId,
            owner: 'target',
            phase,
            disposition: 'wait',
            reason: 'Target authority commit exists locally; wait for canonical remote visibility before replaying closeback.',
            ports
        });
        recoveryLanes.push(lane);
        addBlocker(blockers, {
            code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
            summary: 'Target authority commit is local-durable but not remote-visible on the canonical ref.',
            lane
        });
    }
    if (snapshot.planning.remoteVisibilityRequired === true && planningCommit && !planningRemoteVisible) {
        const lane = recoveryLane({
            taskId: request.taskId,
            owner: 'planning',
            phase,
            disposition: 'wait',
            reason: 'Planning authority commit exists locally; wait for canonical remote visibility before replaying closeback.',
            ports
        });
        recoveryLanes.push(lane);
        addBlocker(blockers, {
            code: 'ATM_TASKFLOW_CROSS_AUTHORITY_CLOSEBACK_PENDING',
            summary: 'Planning authority commit is local-durable but not remote-visible on the canonical ref.',
            lane
        });
    }
    const effectivePhase = blockers.length > 0 && phase === 'both-committed' ? 'closeback-pending' : phase;
    const recoveryCycles = detectRecoveryCycles({
        taskId: request.taskId,
        phase: effectivePhase,
        observations: snapshot.recoveryObservations ?? [],
        ports
    });
    for (const cycle of recoveryCycles) {
        recoveryLanes.push(cycle.nextLegalRecoveryLane);
        addBlocker(blockers, {
            code: 'ATM_TASKFLOW_CLOSE_RECOVERY_CYCLE',
            summary: cycle.summary,
            lane: cycle.nextLegalRecoveryLane
        });
    }
    const steps = [
        buildStep({ taskId: request.taskId, authority: 'target', kind: 'prepare', head: snapshot.target.head, digest: snapshot.target.sourceDigest ?? null, phase: effectivePhase, ports }),
        buildStep({ taskId: request.taskId, authority: 'planning', kind: 'prepare', head: snapshot.planning.head, digest: snapshot.planning.sourceDigest ?? null, phase: effectivePhase, ports }),
        ...(targetCommit ? [] : [buildStep({ taskId: request.taskId, authority: 'target', kind: 'commit', head: snapshot.target.head, digest: request.targetBundleDigest, phase: effectivePhase, ports })]),
        ...(planningCommit ? [] : [buildStep({ taskId: request.taskId, authority: 'planning', kind: 'commit', head: snapshot.planning.head, digest: request.planningPatchDigest, phase: effectivePhase, ports })]),
        buildStep({ taskId: request.taskId, authority: 'target', kind: 'receipt', head: targetCommit ?? snapshot.target.head, digest: request.targetBundleDigest, phase: effectivePhase, ports }),
        buildStep({ taskId: request.taskId, authority: 'planning', kind: 'receipt', head: planningCommit ?? snapshot.planning.head, digest: request.planningPatchDigest, phase: effectivePhase, ports }),
        ...(snapshot.target.remoteVisibilityRequired === true ? [buildStep({ taskId: request.taskId, authority: 'target', kind: 'remote-visibility', head: targetCommit, digest: snapshot.target.canonicalRef ?? null, phase: effectivePhase, ports })] : []),
        ...(snapshot.planning.remoteVisibilityRequired === true ? [buildStep({ taskId: request.taskId, authority: 'planning', kind: 'remote-visibility', head: planningCommit, digest: snapshot.planning.canonicalRef ?? null, phase: effectivePhase, ports })] : [])
    ];
    const receiptWithoutDigest = {
        schemaId: 'atm.crossAuthorityClosebackReceipt.v1',
        taskId: request.taskId,
        sourceIdentity: request.sourceIdentity,
        target: snapshot.target,
        planning: snapshot.planning,
        targetBundleDigest: request.targetBundleDigest,
        planningPatchDigest: request.planningPatchDigest,
        planStatusTransition: request.planStatusTransition ?? null,
        acceptanceEvidenceDigest: request.acceptanceEvidenceDigest ?? null,
        phase: effectivePhase,
        sideEffectJournal
    };
    const receipt = {
        ...receiptWithoutDigest,
        receiptDigest: sha256Json(receiptWithoutDigest)
    };
    const globalCompletion = effectivePhase === 'both-committed' && blockers.length === 0 ? 'complete' : 'closeback-pending';
    const legalRecoveryLanes = uniqueRecoveryLanes([
        ...recoveryLanes,
        ...(blockers.length === 0 ? [closeReadyLane(request.taskId, effectivePhase, ports)] : [])
    ]);
    const nextLegalRecoveryLane = blockers[0]?.recoveryLane ?? legalRecoveryLanes[0] ?? closeReadyLane(request.taskId, effectivePhase, ports);
    const forbiddenActions = uniqueStrings(legalRecoveryLanes.flatMap((lane) => lane.forbiddenActions));
    return {
        schemaId: 'atm.crossAuthorityClosebackPlan.v1',
        taskId: request.taskId,
        sourceIdentity: request.sourceIdentity,
        phase: effectivePhase,
        globalCompletion,
        blockers,
        expectedFiles: {
            target: targetFiles,
            planning: planningFiles
        },
        authorityCas: {
            targetHead: snapshot.target.head,
            planningHead: snapshot.planning.head,
            targetSourceDigest: snapshot.target.sourceDigest ?? null,
            planningSourceDigest: snapshot.planning.sourceDigest ?? null
        },
        steps,
        compensations: [
            'Do not replay completed side effects; resume from the sealed side-effect journal.',
            'If an authority CAS moved, return closeback-pending and re-prepare against the observed authority.',
            'If rollback is required, reconcile the existing saga before reverting code.'
        ],
        receipt,
        recoveryCommand: nextLegalRecoveryLane.command ?? defaultRecoveryCommand(request.taskId),
        legalRecoveryLanes,
        nextLegalRecoveryLane,
        forbiddenActions,
        recoveryCycles,
        emergencyLanes: legalRecoveryLanes.filter((lane) => lane.emergency)
    };
}
