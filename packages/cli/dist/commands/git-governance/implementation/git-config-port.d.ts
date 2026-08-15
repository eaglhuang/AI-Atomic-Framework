/** Local Git configuration port; identity policy stays in the caller. */
export declare function readGitConfig(cwd: string, key: string): string | null;
export declare function writeGitConfig(cwd: string, key: string, value: string): void;
