import { defaultAtomSpecFileName, defaultAtomTestFileName, defaultAtomWorkbenchRoot, resolveAtomWorkbenchPath } from './atom-space.ts';
export declare const defaultAtomSpecTemplatePath: string;
export declare const defaultAtomTestTemplatePath: string;
export { defaultAtomWorkbenchRoot, defaultAtomSpecFileName, defaultAtomTestFileName, resolveAtomWorkbenchPath };
export declare function scaffoldAtomWorkbench(normalizedModel: any, options?: any): {
    ok: boolean;
    atomId: string;
    workbenchPath: string;
    dryRun: boolean;
    overwrittenExisting: boolean;
    createdFiles: Array<{
        kind: string;
        outputPath: string;
    }>;
    overwrittenFiles: Array<{
        kind: string;
        outputPath: string;
    }>;
    skippedFiles: Array<{
        kind: string;
        outputPath: string;
        reason: string;
    }>;
    renderedFiles: Array<{
        kind: string;
        outputPath: string;
        templatePath: string;
    }>;
};
