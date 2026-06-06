export declare function createSchemaValidator(): any;
export declare function validateJsonDocument(document: any, schema: any, options?: any): {
    ok: boolean;
    errors: any;
    checkId: any;
};
export declare function validateJsonFile(documentPath: any, schemaPath: any, options?: any): {
    ok: boolean;
    errors: any;
    checkId: any;
} | {
    ok: boolean;
    errors: string[];
    code: any;
};
export declare function createSchemaCheckResult(validations: any, options?: any): {
    checkId: any;
    kind: string;
    required: boolean;
    description: any;
    ok: boolean;
    violations: any;
};
