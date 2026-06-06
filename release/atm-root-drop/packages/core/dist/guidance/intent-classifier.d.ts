export type GuidanceIntent = 'legacy-atomization' | 'legacy-candidate-ranking' | 'task-plan-import' | 'adapter-bootstrap' | 'docs-spec' | 'atom-create' | 'upgrade-existing' | 'unknown';
export type GuidanceIntentStatus = 'suggested' | 'active-host' | 'promoted-framework';
export interface GuidanceIntentClassification {
    readonly schemaId: 'atm.guidanceIntentClassification';
    readonly specVersion: '0.1.0';
    readonly goal: string;
    readonly matchedIntent: GuidanceIntent;
    readonly confidence: number;
    readonly matchedTerms: readonly string[];
    readonly requiredFlow: readonly string[];
    readonly nextCommand: string;
    readonly blockedAntiPatterns: readonly string[];
    readonly lexiconSources: readonly string[];
}
export interface GuidanceIntentLexiconEntry {
    readonly phrase: string;
    readonly normalizedPhrase: string;
    readonly intent: GuidanceIntent;
    readonly status: GuidanceIntentStatus;
    readonly reason: string;
    readonly source: 'framework-default' | 'host-local' | 'framework-promotion';
    readonly createdAt: string;
    readonly updatedAt: string;
}
export interface GuidanceIntentLexiconDocument {
    readonly schemaId: 'atm.guidanceIntentLexicon';
    readonly specVersion: '0.1.0';
    readonly entries: readonly GuidanceIntentLexiconEntry[];
}
export interface ClassifyGuidanceIntentOptions {
    readonly repositoryRoot?: string | null;
    readonly adapterStatus?: 'missing' | 'available' | 'unknown';
}
export interface RecordGuidanceIntentPhraseOptions {
    readonly repositoryRoot: string;
    readonly phrase: string;
    readonly intent: GuidanceIntent;
    readonly reason: string;
    readonly status?: GuidanceIntentStatus;
    readonly now?: string;
}
export declare function classifyGuidanceIntent(goal: string, options?: ClassifyGuidanceIntentOptions): GuidanceIntentClassification;
export declare function loadHostIntentLexicon(repositoryRoot: string): GuidanceIntentLexiconDocument;
export declare function recordGuidanceIntentPhrase(options: RecordGuidanceIntentPhraseOptions): {
    readonly lexiconPath: string;
    readonly entry: GuidanceIntentLexiconEntry;
    readonly document: GuidanceIntentLexiconDocument;
    readonly duplicate: boolean;
};
export declare function hostIntentLexiconPath(repositoryRoot: string): string;
export declare function normalizeIntentPhrase(value: string): string;
