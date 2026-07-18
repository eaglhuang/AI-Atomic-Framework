export declare function routeContextDir(cwd: string): string;
export declare function routeContextPath(cwd: string, routeId: string): string;
export declare function routeFreezeRuntimePath(cwd: string, routeId: string): string;
export declare function writeJson(filePath: string, value: unknown): void;
export declare function relativePath(cwd: string, filePath: string): string;
export declare function sanitizeRouteToken(value: string): string;
export declare function sanitizeRouteFileName(routeId: string): string;
export declare function unique(values: string[]): string[];
export declare function restoreBackups(cwd: string, backups: Record<string, string | null>): void;
