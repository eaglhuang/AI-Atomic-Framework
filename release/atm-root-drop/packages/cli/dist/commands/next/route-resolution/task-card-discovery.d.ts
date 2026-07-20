import { type TaskIntent } from '../intent-normalizers.ts';
export declare function listTaskCardFiles(cwd: string): readonly string[];
export declare function listPromptScopedExternalTaskCardFiles(cwd: string, intent: TaskIntent | null, planningRoots?: readonly string[]): readonly string[];
export declare function isTaskPathUnderPreferredPlanningRoots(cwd: string, taskPath: string): boolean;
export declare function listFilesRecursive(directoryPath: string, predicate: (filePath: string) => boolean): readonly string[];
export declare function findNearbyPlanPaths(cwd: string, taskPath: string): readonly string[];
