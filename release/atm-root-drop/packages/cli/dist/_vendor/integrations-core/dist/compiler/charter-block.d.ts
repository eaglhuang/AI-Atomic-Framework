export interface RenderedCharterInvariants {
    readonly text: string;
    readonly sourcePath: string | null;
    readonly invariantCount: number;
    readonly fallbackReason: 'missing' | 'unreadable' | 'invalid' | null;
}
export interface CharterAuthorityBundle {
    readonly ok: boolean;
    readonly atomicCharterPath: string;
    readonly firstPrinciplesPath: string;
    readonly invariantsPath: string;
    readonly charterVersion: string | null;
    readonly lastAmendedAt: string | null;
    readonly invariantCount: number;
    readonly scheduleA: unknown;
    readonly errors: readonly string[];
    readonly repairCommand: string;
}
export declare function loadCharterAuthorityBundle(repositoryRoot: string): CharterAuthorityBundle;
export declare function renderCharterInvariantsBlock(repositoryRoot: string): RenderedCharterInvariants;
