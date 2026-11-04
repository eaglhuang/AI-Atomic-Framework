interface ValidationPassPlanRecord {
    passId: string;
    fixtureSet: string;
    label: string;
    reportPath: string;
}
interface ValidationResultRecord {
    commandId: string;
    command: string;
    exitCode: number;
    ok: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
    signal: string | null;
}
interface RawValidationOutcome {
    ok?: boolean;
    exitCode?: number;
    summary?: string;
    reportPath?: string;
    reportDocument?: unknown;
    results?: unknown[];
}
interface ValidationPassContext {
    repositoryRoot: string;
    validationCommands: string[];
    pass: ValidationPassPlanRecord;
}
export declare function normalizeValidationPassOutcome(rawOutcome: RawValidationOutcome | unknown, pass: ValidationPassPlanRecord): {
    reportPath: string;
    reportDocument: unknown;
    record: {
        passId: string;
        fixtureSet: string;
        ok: boolean;
        exitCode: number;
        reportPath: string;
        summary: string;
    };
};
export declare function createValidationPassPlan(lifecycleMode: string, reportsDirPath: string): ValidationPassPlanRecord[];
export declare function defaultRunValidationPass(context: ValidationPassContext): {
    ok: boolean;
    exitCode: number;
    summary: string;
    results: ValidationResultRecord[];
};
export {};
