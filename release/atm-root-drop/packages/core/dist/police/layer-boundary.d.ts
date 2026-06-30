interface LayerBoundaryOptions {
    readonly checkId?: string;
    readonly description?: string;
}
export declare function validateLayerBoundary(importGraph: unknown[] | undefined, policyDocument: unknown, options?: LayerBoundaryOptions): {
    checkId: string;
    kind: string;
    required: boolean;
    description: string;
    ok: boolean;
    violations: {
        code: string;
        severity: string;
        message: string;
        path: string;
    }[];
};
export declare function classifyImportLayer(source: unknown): "effect" | "core" | "adapter" | "external" | "plugin" | "relative" | "compute";
export {};
