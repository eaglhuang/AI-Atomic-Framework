import { type IntegrationAdapter, type IntegrationSourceFile } from '../../integrations-core/src/index.ts';
export declare const integrationCodexPackage: {
    readonly packageName: "@ai-atomic-framework/integration-codex";
    readonly packageRole: "codex-integration-adapter";
    readonly packageVersion: "0.0.0";
};
export interface CodexIntegrationAdapterOptions {
    readonly adapterVersion?: string;
    readonly targetDir?: string;
}
export declare function createCodexIntegrationAdapter(options?: CodexIntegrationAdapterOptions): IntegrationAdapter;
export declare function createCodexSourceFiles(repositoryRoot?: string): readonly IntegrationSourceFile[];
