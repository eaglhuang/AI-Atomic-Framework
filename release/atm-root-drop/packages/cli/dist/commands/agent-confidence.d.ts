export declare const supportedAgentProfiles: {
    id: string;
    label: string;
    executionMode: string;
    workflow: string;
}[];
export declare function listSupportedAgentIds(): string[];
export declare function resolveAgentProfile(agentId: any): {
    id: string;
    label: string;
    executionMode: string;
    workflow: string;
} | null;
export declare function verifyAgentsMarkdown(cwd: any): {
    ok: boolean;
    mode: string;
    path: null;
    checked: never[];
    issues: string[];
} | {
    ok: boolean;
    mode: string;
    path: string;
    checked: string[];
    issues: string[];
};
export declare function createAgentConfidenceEvidence(profile: any, criteria: any, agentsMdVerification: any): {
    advisory: boolean;
    blockingRelease: boolean;
    agentId: any;
    agentLabel: any;
    executionMode: any;
    workflow: any;
    confidenceReady: boolean;
    blockers: string[];
    agentsMd: any;
};
