export declare function runBootstrap(argv: string[]): Promise<{
    command: string;
    evidence: {
        pinnedRunner: any;
    };
    messages: import("./shared.ts").CommandMessage[];
    ok: boolean;
    mode: string;
    cwd: string;
}>;
