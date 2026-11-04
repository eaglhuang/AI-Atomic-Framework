export declare const repoRoot: string;
export declare const defaultRegistrySchemaPath: string;
export declare function normalizeProjectPath(repositoryRoot: string, value: string | null | undefined): string | null | undefined;
export declare function normalizeSchemaPath(repositoryRoot: string, value: string | undefined): string | undefined;
export declare function resolveProjectPath(repositoryRoot: string, value: string): string;
export declare function toProjectPath(repositoryRoot: string, filePath: string): string;
export declare function normalizeStringArray(values: (string | null | undefined)[]): string[];
export declare function toPortablePath(value: string): string;
