export declare function safeReadJson(filePath: string): any;
export declare function sha256File(filePath: string): string;
export declare function resolveRepositoryPath(cwd: string, relativePath: string): string;
export declare function normalizeRepositoryRelativePath(filePath: string): string;
export declare function requireOptionValue(argv: readonly string[], optionIndex: number, optionName: string): string;
export declare function collectJsonFiles(rootDir: string): string[];
