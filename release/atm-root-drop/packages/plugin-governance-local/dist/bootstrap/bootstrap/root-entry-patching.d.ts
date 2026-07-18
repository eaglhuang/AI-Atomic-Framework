export declare function createAgentsRootEntryBlock(tokens: Record<string, string>): string;
export declare function createReadmeRootEntryBlock(): string;
export declare function patchManagedRootEntry(input: {
    readonly targetPath: string;
    readonly cwd: string;
    readonly force: boolean;
    readonly created: string[];
    readonly unchanged: string[];
    readonly startMarker: string;
    readonly endMarker: string;
    readonly block: string;
    readonly insertion: 'after-frontmatter' | 'after-title';
}): void;
