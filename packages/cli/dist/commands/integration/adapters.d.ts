import { createClaudeCodeIntegrationAdapter } from '../../../../integration-claude-code/src/index.ts';
import { createCopilotIntegrationAdapter } from '../../../../integration-copilot/src/index.ts';
import { createCodexIntegrationAdapter } from '../../../../integration-codex/src/index.ts';
import { createCursorIntegrationAdapter } from '../../../../integration-cursor/src/index.ts';
import { createAntigravityIntegrationAdapter, createGeminiIntegrationAdapter } from '../../../../integration-gemini/src/index.ts';
import type { IntegrationAdapter } from '../../../../integrations-core/src/index.ts';
import type { InstallIntegrationOptions } from './types.ts';
export type IntegrationHooksModule = typeof import('../integration-hooks.ts');
export declare const integrationAdapterFactories: Readonly<{
    'claude-code': typeof createClaudeCodeIntegrationAdapter;
    codex: typeof createCodexIntegrationAdapter;
    copilot: typeof createCopilotIntegrationAdapter;
    cursor: typeof createCursorIntegrationAdapter;
    gemini: typeof createGeminiIntegrationAdapter;
    antigravity: typeof createAntigravityIntegrationAdapter;
}>;
export declare const primaryEntryPathByAdapterId: Readonly<{
    'claude-code': string;
    codex: string;
    copilot: string;
    cursor: string;
    gemini: string;
    antigravity: string;
}>;
export type KnownCliIntegrationId = keyof typeof integrationAdapterFactories;
export type EditorDetectionSource = 'ATM_EDITOR_ID' | 'ATM_ACTOR_ID' | 'AGENT_IDENTITY' | 'CODEX_HOME';
interface DetectedCurrentEditor {
    readonly id: KnownCliIntegrationId | null;
    readonly source: EditorDetectionSource | null;
    readonly rawValue: string | null;
}
export declare function availableAdapters(repositoryRoot: string): {
    id: import("packages/integrations-core/src/manifest/types.ts").IntegrationAdapterId;
    displayName: string;
    adapterVersion: string;
    targetDir: string;
    fileFormat: import("packages/integrations-core/src/manifest/types.ts").IntegrationFileFormat;
    placeholderStyle: import("packages/integrations-core/src/manifest/types.ts").IntegrationPlaceholderStyle;
    manifestPath: string;
    installed: boolean;
}[];
export declare function detectCurrentEditorIntegrationId(env?: NodeJS.ProcessEnv): DetectedCurrentEditor;
export declare function describeAdapter(adapter: IntegrationAdapter, repositoryRoot: string): {
    id: import("packages/integrations-core/src/manifest/types.ts").IntegrationAdapterId;
    displayName: string;
    adapterVersion: string;
    targetDir: string;
    fileFormat: import("packages/integrations-core/src/manifest/types.ts").IntegrationFileFormat;
    placeholderStyle: import("packages/integrations-core/src/manifest/types.ts").IntegrationPlaceholderStyle;
    manifestPath: string;
    installed: boolean;
};
export declare function createIntegrationContext(repositoryRoot: string, adapter: IntegrationAdapter, options: InstallIntegrationOptions): {
    repositoryRoot: string;
    actor: string | undefined;
    now: string | undefined;
    dryRun: boolean | undefined;
    manifestPath: string;
};
export declare function manifestPathForIntegration(adapterId: string): string;
export declare function createIntegrationAdapter(adapterId: string): IntegrationAdapter;
export declare function isKnownIntegrationAdapter(adapterId: string): boolean;
export declare function requireAdapterId(adapterId: string | undefined, action: string): string;
export declare function asOptionalString(value: unknown): string | undefined;
export {};
