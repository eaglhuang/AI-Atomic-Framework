import type { LanguageAdapterStaticCheckPlan } from '../../../plugin-sdk/src/language-adapter.ts';
export interface RuntimeLanguageAdapterStaticCheckHint {
    readonly language: string;
    readonly adapterPackage: string;
    readonly fastStaticCheck: LanguageAdapterStaticCheckPlan;
    readonly defaultStaticCheck: LanguageAdapterStaticCheckPlan;
    readonly allStaticCheck: LanguageAdapterStaticCheckPlan;
}
export interface RuntimeAdapterReadinessSummary {
    readonly pythonOnlyHost: boolean;
    readonly languageOnlyHost: boolean;
    readonly needsRuntimeAdapterHint: boolean;
    readonly detectedLanguages: readonly string[];
    readonly bundledLanguageAdapters: readonly string[];
    readonly bundledProjectAdapters: readonly string[];
    readonly pythonLanguageAdapterAvailable: boolean;
    readonly missingLanguageAdapters: readonly string[];
    readonly candidateRankingAllowed: boolean;
    readonly atomBirthApplyDeferred: boolean;
    readonly missingCapability: string | null;
    readonly suggestedAction: string | null;
    readonly explanation: string | null;
    readonly staticCheckHints: readonly RuntimeLanguageAdapterStaticCheckHint[];
}
export declare function inspectRuntimeAdapterReadiness(repositoryRoot: string): RuntimeAdapterReadinessSummary;
