export declare function runTeamReportCommand(argv: string[]): Promise<{
    command: string;
    evidence: {
        action: string;
        reportProjection: {};
        note: string;
    };
    ok: boolean;
    mode: string;
    cwd: string;
    messages: import("../shared.ts").CommandMessage[];
}>;
