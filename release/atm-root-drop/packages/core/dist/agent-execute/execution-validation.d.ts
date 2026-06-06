export declare function normalizeValidationPassOutcome(rawOutcome: any, pass: any): {
    reportPath: string;
    reportDocument: any;
    record: {
        passId: any;
        fixtureSet: any;
        ok: boolean;
        exitCode: any;
        reportPath: string;
        summary: string;
    };
};
export declare function createValidationPassPlan(lifecycleMode: any, reportsDirPath: any): {
    passId: any;
    fixtureSet: any;
    label: any;
    reportPath: string;
}[];
export declare function defaultRunValidationPass(context: any): {
    ok: any;
    exitCode: any;
    summary: string;
    results: any;
};
