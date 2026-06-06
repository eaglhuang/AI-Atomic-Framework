import { type IntegrationAdapter, type IntegrationSourceFile } from '../../integrations-core/src/index.ts';
export declare const integrationCopilotPackage: {
    readonly packageName: "@ai-atomic-framework/integration-copilot";
    readonly packageRole: "copilot-integration-adapter";
    readonly packageVersion: "0.0.0";
};
export interface CopilotIntegrationAdapterOptions {
    readonly adapterVersion?: string;
    readonly targetDir?: string;
}
export declare function createCopilotIntegrationAdapter(options?: CopilotIntegrationAdapterOptions): IntegrationAdapter;
export declare function createCopilotSourceFiles(repositoryRoot?: string): readonly IntegrationSourceFile[];
