import { type Dirent } from 'node:fs';
export interface LegacyLedgerTaskFile {
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly taskId: string;
    readonly status: string;
    readonly format: 'json' | 'markdown';
    readonly document: Record<string, unknown>;
    readonly rawText?: string;
}
export declare function normalizeRelativePath(value: string): string;
export declare function collectTaskFileValues(value: unknown, files: Set<string>): void;
export declare function taskPathFor(cwd: string, taskId: string): string;
export declare function safeTaskFileReadDir(directoryPath: string): readonly Dirent[];
export declare function safeTaskFileStat(filePath: string): import("fs").Stats | null;
export declare function readJsonRecord(filePath: string): Record<string, unknown>;
export declare function legacyTaskRequiresBaseline(cwd: string, task: LegacyLedgerTaskFile): boolean;
