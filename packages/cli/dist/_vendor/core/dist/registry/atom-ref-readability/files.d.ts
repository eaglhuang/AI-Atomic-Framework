import { existsSync } from 'node:fs';
export { existsSync };
export declare function readJson(filePath: string): unknown;
export declare function writeJson(filePath: string, value: unknown): void;
export declare function readText(filePath: string): string;
export declare function writeText(filePath: string, value: string): void;
export declare function walkSourceFiles(repoPath: string): string[];
export declare function safeReadDir(directory: string): string[];
