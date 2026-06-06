export declare function runBootstrap(argv: any): Promise<{
    command: string;
    evidence: {
        pinnedRunner: any;
    };
    messages: import("./shared.ts").CommandMessage[];
    ok: boolean;
    mode: string;
    cwd: string;
}>;
