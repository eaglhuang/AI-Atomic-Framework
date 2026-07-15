type ShadowPlanAgent = {
    role: string;
    permissions: readonly string[];
};
type ShadowPlanRecipe = {
    agents: readonly ShadowPlanAgent[];
};
type ShadowCaptainDecision = {
    teamSize: unknown;
};
type ShadowBrokerLaneEvidence = {
    safeToStart?: unknown;
};
type ShadowValidation = {
    ok: boolean;
};
export declare function buildTeamShadowScheduleForPlan(input: {
    cwd: string;
    task: Record<string, unknown> | null | undefined;
    recipe: ShadowPlanRecipe;
    writePaths: string[];
    captainDecision: ShadowCaptainDecision;
    validation: ShadowValidation;
    brokerLane: ShadowBrokerLaneEvidence;
}): import("./scheduler.ts").TeamShadowSchedule;
export {};
