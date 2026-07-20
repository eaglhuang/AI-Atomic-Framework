export declare function runSelfHostAlphaAsync(argv: string[]): Promise<{
    criteria1: boolean;
    criteria2: boolean;
    criteria3: boolean;
    criteria4: boolean;
    agent?: string | undefined;
    ok: boolean;
    command: string;
    mode: string;
    cwd: string;
    messages: import("./shared.ts").CommandMessage[];
    evidence: Record<string, unknown>;
}>;
