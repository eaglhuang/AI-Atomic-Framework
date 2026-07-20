import type { AtomCandidate, AtomCandidateDiscoveryRequest, AtomizationPlanningAdapter } from '@ai-atomic-framework/plugin-sdk';
import type { JavaScriptLanguageAdapter, JavaScriptLanguageAdapterManifest, JavaScriptImportRecord, JavaScriptImportPolicy, JavaScriptProjectProfile, JavaScriptSourceFile, JavaScriptStaticCheckPlan, JavaScriptValidationReport, LanguageAdapterValidationRequest, TestCommandRunnerContract } from './index.ts';
export declare const defaultJavaScriptImportPolicy: Readonly<{
    forbiddenSpecifiers: string[];
    allowedSpecifiers: string[];
}>;
export declare const defaultJavaScriptLanguageAdapterManifest: JavaScriptLanguageAdapterManifest;
export declare function createJavaScriptLanguageAdapter(policyOverrides?: Partial<{
    forbiddenSpecifiers: string[];
    allowedSpecifiers: string[];
}>): JavaScriptLanguageAdapter;
export declare function detectProjectProfile(repositoryRoot: string): JavaScriptProjectProfile;
export declare function validateComputeAtom(request: LanguageAdapterValidationRequest, profile?: JavaScriptProjectProfile, basePolicy?: JavaScriptImportPolicy): JavaScriptValidationReport;
export declare function discoverJavaScriptAtomCandidates(request: AtomCandidateDiscoveryRequest): readonly AtomCandidate[];
export declare function findJavaScriptSymbolAnchors(sourceFile: JavaScriptSourceFile, symbolName: string): readonly {
    readonly filePath: string;
    readonly lineStart: number;
    readonly lineEnd: number;
}[];
/**
 * Optional SDK capability for the JS/TS adapter. `planAtomize` is
 * intentionally deferred (TASK-ASP-0004 covers the broker bridge), so it
 * throws an explicit not-implemented error instead of guessing a plan.
 */
export declare function createJavaScriptAtomizationPlanningAdapter(): AtomizationPlanningAdapter;
export declare function scanImports(sourceFile: JavaScriptSourceFile): readonly JavaScriptImportRecord[];
export declare function createCommandRunnerContract(profile: JavaScriptProjectProfile): TestCommandRunnerContract;
export declare function createFastJavaScriptStaticCheck(profile: JavaScriptProjectProfile): JavaScriptStaticCheckPlan;
export declare function createDefaultJavaScriptStaticCheck(profile: JavaScriptProjectProfile): JavaScriptStaticCheckPlan;
export declare function createAllJavaScriptStaticCheck(profile: JavaScriptProjectProfile): JavaScriptStaticCheckPlan;
