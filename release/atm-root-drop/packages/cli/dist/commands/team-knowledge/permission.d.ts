export type KnowledgePermissionDecision = {
    ok: boolean;
    code: 'ATM_TEAM_KNOWLEDGE_PERMISSION_ALLOWED' | 'ATM_TEAM_KNOWLEDGE_INDEX_WRITE_FORBIDDEN';
    permission: 'knowledge.query' | 'knowledge.index.write';
    actorId: string | null;
    reason: string;
    details: Record<string, unknown>;
};
export declare function evaluateKnowledgePermission(action: string, options: Record<string, unknown>): KnowledgePermissionDecision;
