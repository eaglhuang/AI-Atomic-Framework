export interface AdvisoryReport {
    readonly taskId: string;
    readonly outOfScopeFiles: readonly {
        readonly path: string;
        readonly suggestedCategory: 'primary' | 'secondary' | 'tests';
    }[];
}
export declare function runContextMapAdvisor(cwd: string): AdvisoryReport | null;
