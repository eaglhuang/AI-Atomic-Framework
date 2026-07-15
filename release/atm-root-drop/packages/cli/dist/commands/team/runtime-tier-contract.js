export function buildRuntimeTierContract(recipe) {
    return {
        schemaId: 'atm.teamRuntimeTierContract.v1',
        tiers: ['raw-api', 'agent-sdk', 'editor'],
        providerContractCompatibility: ['RawChatAdapter', 'AgentLoopAdapter', 'EditorAgentAdapter'],
        roleTiers: recipe.agents.map((agent) => {
            const tier = recommendRuntimeTier(agent.role);
            return {
                role: agent.role,
                agentId: agent.agentId,
                runtimeTier: tier,
                rationale: runtimeTierRationale(agent.role, tier)
            };
        })
    };
}
function recommendRuntimeTier(role) {
    if (['reader', 'validator', 'knowledgeScout', 'reviewAgent', 'evidenceCollector'].includes(role))
        return 'raw-api';
    if (['implementer', 'coordinator'].includes(role))
        return 'agent-sdk';
    if (role === 'lieutenant' || role === 'scopeGuardian' || role === 'atomizationPlanner')
        return 'editor';
    return 'raw-api';
}
function runtimeTierRationale(role, tier) {
    if (tier === 'raw-api')
        return `${role} is advisory/read-heavy and should prefer direct low-state API calls.`;
    if (tier === 'agent-sdk')
        return `${role} may need tool-loop orchestration while preserving Coordinator-owned lifecycle.`;
    return `${role} benefits from editor context but remains bounded by Team permission leases.`;
}
