export declare const defaultAgentPromptSchemaId = "atm.agentPrompt";
export declare const defaultAgentPromptFileName = "prompt.md";
export declare const defaultAgentPromptWorkbenchRoot = "atomic_workbench/atoms";
export declare const defaultAgentPromptSpecFileName = "atom.spec.json";
export declare const defaultAgentPromptTestFileName = "atom.test.ts";
interface PromptPortRecord {
    name: string;
    kind: string;
    required?: boolean;
}
interface AgentPromptModel {
    identity: {
        atomId: string;
        logicalName?: string;
        title?: string;
        description?: string;
    };
    execution: {
        compatibility?: {
            lifecycleMode?: string;
        };
        validation?: {
            commands?: string[];
            evidenceRequired?: boolean;
        };
        language?: {
            primary?: string;
        };
        runtime?: {
            kind?: string;
            versionRange?: string;
        };
        dependencyPolicy?: {
            hostCoupling?: string;
            external?: string;
        };
        performanceBudget?: {
            inputMutation?: string;
        };
    };
    ports?: {
        inputs?: PromptPortRecord[];
        outputs?: PromptPortRecord[];
    };
}
interface AgentPromptOptions {
    workbenchPath?: string;
    workbenchRoot?: string;
    promptFileName?: string;
    specFileName?: string;
    testFileName?: string;
}
interface AgentPromptDocument {
    schemaId: string;
    specVersion: string;
    atomId: string;
    title: string;
    lifecycleMode: string;
    promptPath: string;
    frontmatter: {
        forbiddenRules: string[];
        allowedFiles: string[];
        evidenceContract: {
            evidenceRequired: boolean;
            requiredOutputs: string[];
            validationCommands: string[];
        };
    };
    sections: {
        goal: string;
        context: string;
        inputs: PromptPortRecord[];
        outputs: PromptPortRecord[];
        instructions: string[];
    };
}
export declare function buildAgentPrompt(normalizedModel: AgentPromptModel, options: AgentPromptOptions): {
    ok: boolean;
    atomId: string;
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
        atomId: string;
        title: string;
        lifecycleMode: string;
        promptPath: string;
        frontmatter: {
            forbiddenRules: string[];
            allowedFiles: string[];
            evidenceContract: {
                evidenceRequired: boolean;
                requiredOutputs: string[];
                validationCommands: string[];
            };
        };
        sections: {
            goal: string;
            context: string;
            inputs: PromptPortRecord[];
            outputs: PromptPortRecord[];
            instructions: string[];
        };
    };
    markdown: string;
};
export declare function createAgentPromptDocument(normalizedModel: AgentPromptModel, options: AgentPromptOptions): {
    markdown: string;
    schemaId: string;
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    atomId: string;
    title: string;
    lifecycleMode: string;
    promptPath: string;
    frontmatter: {
        forbiddenRules: string[];
        allowedFiles: string[];
        evidenceContract: {
            evidenceRequired: boolean;
            requiredOutputs: string[];
            validationCommands: string[];
        };
    };
    sections: {
        goal: string;
        context: string;
        inputs: PromptPortRecord[];
        outputs: PromptPortRecord[];
        instructions: string[];
    };
};
export declare function serializeAgentPromptMarkdown(document: AgentPromptDocument): string;
export {};
