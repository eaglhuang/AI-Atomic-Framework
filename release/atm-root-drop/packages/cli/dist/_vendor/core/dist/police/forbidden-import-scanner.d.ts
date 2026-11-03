interface ImportRecord {
    readonly source?: string;
    readonly toLayer?: string;
}
interface ForbiddenImportOptions {
    readonly checkId?: string;
    readonly description?: string;
}
export declare function extractImportSources(sourceText: string): string[];
export declare function validateForbiddenImports(importGraph?: unknown[], forbiddenPatterns?: unknown[], options?: ForbiddenImportOptions): {
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
export declare function normalizeImports(imports?: unknown[]): ImportRecord[];
export {};
