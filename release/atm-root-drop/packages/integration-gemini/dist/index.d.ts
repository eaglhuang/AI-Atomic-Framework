import { type IntegrationAdapter, type IntegrationSourceFile } from '../../integrations-core/src/index.ts';
export declare const integrationGeminiPackage: {
    readonly packageName: "@ai-atomic-framework/integration-gemini";
    readonly packageRole: "gemini-integration-adapter";
    readonly packageVersion: "0.0.0";
};
export interface GeminiIntegrationAdapterOptions {
    readonly adapterVersion?: string;
    readonly targetDir?: string;
}
export interface AntigravityIntegrationAdapterOptions {
    readonly adapterVersion?: string;
}
export declare function createGeminiIntegrationAdapter(options?: GeminiIntegrationAdapterOptions): IntegrationAdapter;
export declare function createAntigravityIntegrationAdapter(options?: AntigravityIntegrationAdapterOptions): IntegrationAdapter;
export declare function createGeminiSourceFiles(repositoryRoot?: string): readonly IntegrationSourceFile[];
export declare function createAntigravitySourceFiles(repositoryRoot?: string): readonly IntegrationSourceFile[];
