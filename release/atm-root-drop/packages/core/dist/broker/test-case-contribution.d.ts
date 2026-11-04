/**
 * Broker-managed shared test-case contributions (TASK-SKL-0023).
 *
 * Feature cards may contribute several integration cases through one bounded
 * group resource intent. Concurrent disjoint contributions compose with member
 * attribution; true same-case conflicts queue or revalidate. Running a case
 * grants no edit authority.
 */
export type TestCaseContributionDisposition = 'compose' | 'queue' | 'revalidate';
export interface TestCaseContributionCase {
    readonly caseId: string;
    readonly semanticKey: string;
    readonly coversAcceptance?: readonly string[];
    readonly coversImpactEdges?: readonly string[];
    readonly expectedRedPredicate?: string | null;
    readonly command?: string | null;
    readonly responsibility?: 'task-required' | 'phase-suite' | 'advisory';
}
export interface TestCaseContributionIntent {
    readonly actorId: string;
    readonly taskId: string;
    readonly contributionResourceKey: string;
    readonly targetGroupId: string;
    readonly cases: readonly TestCaseContributionCase[];
}
export interface TestCaseContributionAttribution {
    readonly actorId: string;
    readonly taskId: string;
    readonly contributionResourceKey: string;
    readonly caseIds: readonly string[];
}
export interface TestCaseContributionDecision {
    readonly schemaId: 'atm.testCaseContributionDecision.v1';
    readonly disposition: TestCaseContributionDisposition;
    readonly targetGroupId: string;
    readonly contributionResourceKey: string;
    readonly composedCases: readonly TestCaseContributionCase[];
    readonly attribution: readonly TestCaseContributionAttribution[];
    readonly conflictCaseIds: readonly string[];
    readonly reason: string;
}
/**
 * Admit one or more feature-card contribution intents for a shared group.
 * Disjoint case ids compose. Identical same-case payloads compose idempotently.
 * Divergent same-case payloads queue (hard conflict) or revalidate (soft drift).
 */
export declare function admitTestCaseContributions(intents: readonly TestCaseContributionIntent[]): TestCaseContributionDecision;
