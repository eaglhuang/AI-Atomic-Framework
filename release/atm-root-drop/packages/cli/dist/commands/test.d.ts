export declare function runHelloWorldSmoke(cwd: any): Promise<{
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
export declare function runTestAsync(argv: any): Promise<import("./shared.ts").CommandResult>;
