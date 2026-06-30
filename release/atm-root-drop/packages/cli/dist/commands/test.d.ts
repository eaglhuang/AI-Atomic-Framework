export declare function runHelloWorldSmoke(cwd: string): Promise<{
    ok: boolean;
    checks: {
        name: string;
        passed: boolean;
    }[];
    passCount: number;
    total: number;
    specPath: string;
    sourcePath: string;
    smokeResult: any;
}>;
export declare function runTestAsync(argv: string[]): Promise<import("./shared.ts").CommandResult>;
