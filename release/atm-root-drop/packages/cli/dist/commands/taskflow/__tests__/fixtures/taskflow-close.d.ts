export declare function makeBrokerCloseFixture(label: string): Promise<{
    targetRepo: string;
    planningRepo: string;
    taskId: string;
}>;
export declare function makeDualRepoCloseFixture(label: string, options?: {
    closePlanningStatus?: string;
}): Promise<{
    targetRepo: string;
    planningRepo: string;
    taskId: string;
    planPath: string;
    deliveryCommit: string;
    profilePath: string;
}>;
