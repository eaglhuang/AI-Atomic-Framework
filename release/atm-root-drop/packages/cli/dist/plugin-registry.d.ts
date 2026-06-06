import type { ExternalTaskSourcePlugin } from '@ai-atomic-framework/plugin-sdk';
export interface RegisteredExternalTaskSource {
    readonly plugin: ExternalTaskSourcePlugin;
    readonly mode: 'advisory' | 'enforce' | 'disabled';
}
export declare function readPluginRegistry(cwd: string): Promise<readonly RegisteredExternalTaskSource[]>;
