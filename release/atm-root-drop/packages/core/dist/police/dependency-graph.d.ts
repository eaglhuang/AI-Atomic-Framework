export declare function buildDependencyGraph(members?: any[], edges?: any[]): Map<any, any>;
export declare function detectCycles(graph: any): any[];
export declare function validateDependencyGraph(mapFixture: any, options?: any): {
    checkId: any;
    kind: string;
    required: boolean;
    description: any;
    ok: boolean;
    violations: {
        code: string;
        severity: string;
        message: string;
        atomId: any;
    }[];
    graph: any;
};
