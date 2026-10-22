interface DependencyMapFixture {
    readonly members?: unknown[];
    readonly edges?: unknown[];
}
interface DependencyGraphValidationOptions {
    readonly checkId?: string;
    readonly description?: string;
}
export declare function buildDependencyGraph(members?: unknown[], edges?: unknown[]): Map<string, string[]>;
export declare function detectCycles(graph: Map<string, string[]>): string[][];
export declare function validateDependencyGraph(mapFixture: DependencyMapFixture, options?: DependencyGraphValidationOptions): {
    checkId: string;
    kind: string;
    required: boolean;
    description: string;
    ok: boolean;
    violations: {
        code: string;
        severity: string;
        message: string;
        atomId: string;
    }[];
    graph: {
        [k: string]: string[];
    };
};
export {};
