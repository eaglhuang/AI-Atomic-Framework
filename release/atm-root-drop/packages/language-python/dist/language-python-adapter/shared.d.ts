import type { PythonImportPolicy, PythonLanguageAdapterMessage, PythonStaticCheckPlan } from '../index.ts';
export declare function hasEntrypointSignature(sourceText: string): boolean;
export declare function message(level: PythonLanguageAdapterMessage['level'], code: string, text: string, filePath?: string, line?: number): PythonLanguageAdapterMessage;
export declare function mergePolicy(base: PythonImportPolicy, overrides: Partial<PythonImportPolicy> | undefined): PythonImportPolicy;
export declare function normalizePath(filePath: string): string;
export declare function createStaticCheckPlan(tier: PythonStaticCheckPlan['tier'], commands: readonly string[], input: {
    readonly source: PythonStaticCheckPlan['source'];
    readonly kinds: PythonStaticCheckPlan['kinds'];
    readonly guidance: string;
}): PythonStaticCheckPlan;
