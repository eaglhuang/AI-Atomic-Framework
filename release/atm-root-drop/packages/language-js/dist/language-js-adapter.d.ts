import type { AtomCandidate, AtomCandidateDiscoveryRequest, AtomizationPlanningAdapter } from '@ai-atomic-framework/plugin-sdk';
import type { JavaScriptLanguageAdapter, JavaScriptLanguageAdapterManifest, JavaScriptImportRecord, JavaScriptProjectProfile, JavaScriptSourceFile, JavaScriptValidationReport, TestCommandRunnerContract } from './index.ts';
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
export declare function validateComputeAtom(request: any, profile?: JavaScriptProjectProfile, basePolicy?: Readonly<{
    forbiddenSpecifiers: string[];
    allowedSpecifiers: string[];
}>): JavaScriptValidationReport;
export declare function discoverJavaScriptAtomCandidates(request: AtomCandidateDiscoveryRequest): readonly AtomCandidate[];
/**
 * Optional SDK capability for the JS/TS adapter. `planAtomize` is
 * intentionally deferred (TASK-ASP-0004 covers the broker bridge), so it
 * throws an explicit not-implemented error instead of guessing a plan.
 */
export declare function createJavaScriptAtomizationPlanningAdapter(): AtomizationPlanningAdapter;
export declare function scanImports(sourceFile: JavaScriptSourceFile): readonly JavaScriptImportRecord[];
export declare function createCommandRunnerContract(profile: JavaScriptProjectProfile): TestCommandRunnerContract;
