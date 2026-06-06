import { type IntegrationAdapter, type IntegrationSourceFile } from '../../integrations-core/src/index.ts';
export declare const integrationClaudeCodePackage: {
    readonly packageName: "@ai-atomic-framework/integration-claude-code";
    readonly packageRole: "claude-code-integration-adapter";
    readonly packageVersion: "0.0.0";
};
export interface ClaudeCodeIntegrationAdapterOptions {
    readonly adapterVersion?: string;
    readonly targetDir?: string;
}
export declare function createClaudeCodeIntegrationAdapter(options?: ClaudeCodeIntegrationAdapterOptions): IntegrationAdapter;
export declare function createClaudeCodeSourceFiles(repositoryRoot?: string): readonly IntegrationSourceFile[];
