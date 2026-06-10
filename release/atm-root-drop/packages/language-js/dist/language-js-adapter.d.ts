import type { AtomCandidate, AtomCandidateDiscoveryRequest, AtomizationPlanningAdapter } from '@ai-atomic-framework/plugin-sdk';
export declare const defaultJavaScriptImportPolicy: Readonly<{
    forbiddenSpecifiers: string[];
    allowedSpecifiers: string[];
}>;
export declare function createJavaScriptLanguageAdapter(policyOverrides?: Partial<{
    forbiddenSpecifiers: string[];
    allowedSpecifiers: string[];
}>): {
    adapterName: string;
    languageIds: string[];
    detectProjectProfile: typeof detectProjectProfile;
    scanImports: typeof scanImports;
    validateComputeAtom: (request: any, profile?: {
        packageManager: string;
        testCommand: null;
        typecheckCommand: null;
        lintCommand: null;
    }) => {
        ok: boolean;
        profile: {
            packageManager: string;
            testCommand: null;
            typecheckCommand: null;
            lintCommand: null;
        };
        imports: any;
        messages: any[];
        commandRunnerContract: {
            executionMode: string;
            packageManager: any;
            commands: ({
                commandKind: any;
                command: any;
                required: any;
            } | null)[];
        };
        evidence: {
            evidenceKind: string;
            summary: string;
            artifactPaths: any;
        }[];
    };
    createCommandRunnerContract: typeof createCommandRunnerContract;
};
export declare function detectProjectProfile(repositoryRoot: any): {
    packageManager: string;
    testCommand: string | null;
    typecheckCommand: string | null;
    lintCommand: string | null;
};
export declare function validateComputeAtom(request: any, profile?: {
    packageManager: string;
    testCommand: null;
    typecheckCommand: null;
    lintCommand: null;
}, basePolicy?: Readonly<{
    forbiddenSpecifiers: string[];
    allowedSpecifiers: string[];
}>): {
    ok: boolean;
    profile: {
        packageManager: string;
        testCommand: null;
        typecheckCommand: null;
        lintCommand: null;
    };
    imports: any;
    messages: any[];
    commandRunnerContract: {
        executionMode: string;
        packageManager: any;
        commands: ({
            commandKind: any;
            command: any;
            required: any;
        } | null)[];
    };
    evidence: {
        evidenceKind: string;
        summary: string;
        artifactPaths: any;
    }[];
};
export declare function discoverJavaScriptAtomCandidates(request: AtomCandidateDiscoveryRequest): readonly AtomCandidate[];
/**
 * Optional SDK capability for the JS/TS adapter. `planAtomize` is
 * intentionally deferred (TASK-ASP-0004 covers the broker bridge), so it
 * throws an explicit not-implemented error instead of guessing a plan.
 */
export declare function createJavaScriptAtomizationPlanningAdapter(): AtomizationPlanningAdapter;
export declare function scanImports(sourceFile: any): {
    filePath: any;
    specifier: string;
    statementKind: string;
    line: number;
}[];
export declare function createCommandRunnerContract(profile: any): {
    executionMode: string;
    packageManager: any;
    commands: ({
        commandKind: any;
        command: any;
        required: any;
    } | null)[];
};
