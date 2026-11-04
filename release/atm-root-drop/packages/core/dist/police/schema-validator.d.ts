interface SchemaValidatorOptions {
    readonly ajv?: {
        compile: (schema: unknown) => {
            (document: unknown): boolean;
            errors?: unknown[];
        };
    };
    readonly checkId?: string;
    readonly description?: string;
    readonly repositoryRoot?: string;
}
interface SchemaValidationResult {
    readonly ok: boolean;
    readonly errors: string[];
    readonly checkId?: string;
}
export declare function createSchemaValidator(): any;
export declare function validateJsonDocument(document: unknown, schema: unknown, options?: SchemaValidatorOptions): {
    ok: boolean;
    errors: string[];
    checkId: string;
};
export declare function validateJsonFile(documentPath: string, schemaPath: string, options?: SchemaValidatorOptions): {
    ok: boolean;
    errors: string[];
    checkId: string;
} | {
    ok: boolean;
    errors: string[];
    code: string;
};
export declare function createSchemaCheckResult(validations: SchemaValidationResult[], options?: SchemaValidatorOptions): {
    checkId: string;
    kind: string;
    required: boolean;
    description: string;
    ok: boolean;
    violations: {
        code: string;
        severity: string;
        message: string;
    }[];
};
export {};
