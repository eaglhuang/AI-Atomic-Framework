import type { ValidateRegistryDocumentOptions, ValidationIssue } from './types.ts';
export declare function validateRegistryDocument(registryDocument: unknown, options?: ValidateRegistryDocumentOptions): {
    ok: boolean;
    schemaPath: string;
    promptReport: {
        code: string;
        summary: string;
        issues: ValidationIssue[];
    };
};
export declare function validateRegistryDocumentFile(registryPath: string, options?: ValidateRegistryDocumentOptions): {
    registryPath: string;
    document: any;
    ok: boolean;
    schemaPath: string;
    promptReport: {
        code: string;
        summary: string;
        issues: ValidationIssue[];
    };
};
