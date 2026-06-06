export declare function runTaskflow(argv?: string[]): {
    schemaId: string;
    writeEnabled: boolean;
    ok: boolean;
    command: string;
    mode: string;
    cwd: string;
    messages: import("./shared.ts").CommandMessage[];
    evidence: Record<string, unknown>;
};
