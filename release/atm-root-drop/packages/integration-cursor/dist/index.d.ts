import { type IntegrationAdapter, type IntegrationSourceFile } from '../../integrations-core/dist/index.js';
export declare const integrationCursorPackage: {
    readonly packageName: "@ai-atomic-framework/integration-cursor";
    readonly packageRole: "cursor-integration-adapter";
    readonly packageVersion: "0.0.0";
};
export interface CursorIntegrationAdapterOptions {
    readonly adapterVersion?: string;
    readonly targetDir?: string;
}
export declare function createCursorIntegrationAdapter(options?: CursorIntegrationAdapterOptions): IntegrationAdapter;
export declare function createCursorSourceFiles(repositoryRoot?: string): readonly IntegrationSourceFile[];
export declare const cursorAlwaysOnRule: IntegrationSourceFile;
export declare function createCursorRuleFiles(repositoryRoot?: string): readonly IntegrationSourceFile[];
