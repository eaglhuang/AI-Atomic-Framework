export declare const defaultAgentPromptSchemaId = "atm.agentPrompt";
export declare const defaultAgentPromptFileName = "prompt.md";
export declare const defaultAgentPromptWorkbenchRoot = "atomic_workbench/atoms";
export declare const defaultAgentPromptSpecFileName = "atom.spec.json";
export declare const defaultAgentPromptTestFileName = "atom.test.ts";
export declare function buildAgentPrompt(normalizedModel: any, options: any): {
    ok: boolean;
    atomId: any;
    promptPath: string;
    document: {
        markdown: string;
        schemaId: string;
        specVersion: string;
        migration: {
            strategy: string;
            fromVersion: null;
            notes: string;
        };
        atomId: any;
        title: any;
        lifecycleMode: any;
        promptPath: string;
        frontmatter: {
            forbiddenRules: unknown[];
            allowedFiles: unknown[];
            evidenceContract: {
                evidenceRequired: boolean;
                requiredOutputs: unknown[];
                validationCommands: unknown[];
            };
        };
        sections: {
            goal: string;
            context: any;
            inputs: any;
            outputs: any;
            instructions: string[];
        };
    };
    markdown: string;
};
export declare function createAgentPromptDocument(normalizedModel: any, options: any): {
    markdown: string;
    schemaId: string;
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    atomId: any;
    title: any;
    lifecycleMode: any;
    promptPath: string;
    frontmatter: {
        forbiddenRules: unknown[];
        allowedFiles: unknown[];
        evidenceContract: {
            evidenceRequired: boolean;
            requiredOutputs: unknown[];
            validationCommands: unknown[];
        };
    };
    sections: {
        goal: string;
        context: any;
        inputs: any;
        outputs: any;
        instructions: string[];
    };
};
export declare function serializeAgentPromptMarkdown(document: any): string;
