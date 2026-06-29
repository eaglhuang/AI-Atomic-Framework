export declare const supportedAgentProfiles: {
    id: string;
    label: string;
    executionMode: string;
    workflow: string;
}[];
export interface AgentProfile {
    id: string;
    label: string;
    executionMode: string;
    workflow: string;
}
export interface AgentsMdVerificationResult {
    ok: boolean;
    mode: string;
    path: string | null;
    checked: string[];
    issues: string[];
}
export declare function listSupportedAgentIds(): string[];
export declare function resolveAgentProfile(agentId: unknown): {
    id: string;
    label: string;
    executionMode: string;
    workflow: string;
} | null;
export declare function verifyAgentsMarkdown(cwd: string): AgentsMdVerificationResult;
export declare function createAgentConfidenceEvidence(profile: AgentProfile, criteria: Record<string, boolean>, agentsMdVerification: AgentsMdVerificationResult): {
    advisory: boolean;
    blockingRelease: boolean;
    agentId: string;
    agentLabel: string;
    executionMode: string;
    workflow: string;
    confidenceReady: boolean;
    blockers: string[];
    agentsMd: AgentsMdVerificationResult;
};
