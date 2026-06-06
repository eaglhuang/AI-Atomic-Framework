export declare function validateLayerBoundary(importGraph: any[] | undefined, policyDocument: any, options?: any): {
    checkId: any;
    kind: string;
    required: boolean;
    description: any;
    ok: boolean;
    violations: any[];
};
export declare function classifyImportLayer(source: any): "effect" | "core" | "adapter" | "external" | "plugin" | "relative" | "compute";
