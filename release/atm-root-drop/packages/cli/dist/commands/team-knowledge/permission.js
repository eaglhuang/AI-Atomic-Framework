export function evaluateKnowledgePermission(action, options) {
    const actorId = String(options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? '').trim() || null;
    const dryRun = Boolean(options['dry-run']) || !Boolean(options.write);
    const writesIndex = action === 'compact' || (action === 'build' && !dryRun);
    if (!writesIndex) {
        return {
            ok: true,
            code: 'ATM_TEAM_KNOWLEDGE_PERMISSION_ALLOWED',
            permission: 'knowledge.query',
            actorId,
            reason: 'knowledge.query is shareable and advisory-only.',
            details: { action, shareable: true }
        };
    }
    const coordinatorActor = actorId === 'coordinator' || String(actorId ?? '').endsWith('-coordinator');
    if (!coordinatorActor) {
        return {
            ok: false,
            code: 'ATM_TEAM_KNOWLEDGE_INDEX_WRITE_FORBIDDEN',
            permission: 'knowledge.index.write',
            actorId,
            reason: 'knowledge.index.write is coordinator-only and may only write generated runtime cache files.',
            details: { action, actorId, requiredActor: 'coordinator', allowedRoot: '.atm/runtime/knowledge' }
        };
    }
    return {
        ok: true,
        code: 'ATM_TEAM_KNOWLEDGE_PERMISSION_ALLOWED',
        permission: 'knowledge.index.write',
        actorId,
        reason: 'knowledge.index.write granted for coordinator-owned generated runtime cache update.',
        details: { action, actorId, allowedRoot: '.atm/runtime/knowledge' }
    };
}
