export interface RenderedCharterInvariants {
    readonly text: string;
    readonly sourcePath: string | null;
    readonly invariantCount: number;
    readonly fallbackReason: 'missing' | 'unreadable' | 'invalid' | null;
}
export declare function renderCharterInvariantsBlock(repositoryRoot: string): RenderedCharterInvariants;
