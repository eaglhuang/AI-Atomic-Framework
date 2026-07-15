type TeamRuntimeTier = 'raw-api' | 'agent-sdk' | 'editor';
type RuntimeTierAgent = {
    role: string;
    agentId: string;
};
type RuntimeTierRecipe = {
    agents: readonly RuntimeTierAgent[];
};
export declare function buildRuntimeTierContract(recipe: RuntimeTierRecipe): {
    schemaId: string;
    tiers: readonly ["raw-api", "agent-sdk", "editor"];
    providerContractCompatibility: readonly ["RawChatAdapter", "AgentLoopAdapter", "EditorAgentAdapter"];
    roleTiers: {
        role: string;
        agentId: string;
        runtimeTier: TeamRuntimeTier;
        rationale: string;
    }[];
};
export {};
