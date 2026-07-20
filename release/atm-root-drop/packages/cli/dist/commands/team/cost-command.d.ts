export declare function runTeamCostCommand(argv: string[]): Promise<{
    ok: boolean;
    command: string;
    evidence: {
        action: string;
        costProjection: any;
        admissionOk: boolean;
        admissionFindings: any;
        note: string;
    };
    severity: string;
    exitCode: number;
    blocking: boolean;
    mode: string;
    cwd: string;
    messages: import("../shared.ts").CommandMessage[];
}>;
