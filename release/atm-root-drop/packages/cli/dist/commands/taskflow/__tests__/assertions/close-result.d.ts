export declare function assertDryRunGovernedBundle(result: any, fixture: {
    taskId: string;
    targetRepo: string;
    planningRepo: string;
}): void;
export declare function assertPlanningCardClosed(stageResult: any, fixture: {
    planPath: string;
    planningRepo: string;
    taskId: string;
    deliveryCommit: string;
}): void;
