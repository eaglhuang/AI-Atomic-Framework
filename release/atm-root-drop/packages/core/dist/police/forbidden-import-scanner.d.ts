export declare function extractImportSources(sourceText: any): any[];
export declare function validateForbiddenImports(importGraph?: any[], forbiddenPatterns?: any[], options?: any): {
    checkId: any;
    kind: string;
    required: boolean;
    description: any;
    ok: boolean;
    violations: any[];
};
export declare function normalizeImports(imports?: any[]): any[];
