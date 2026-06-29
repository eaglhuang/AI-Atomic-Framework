import { createClaudeCodeIntegrationAdapter } from '../../../integration-claude-code/src/index.ts';
import { createCopilotIntegrationAdapter } from '../../../integration-copilot/src/index.ts';
import { createCodexIntegrationAdapter } from '../../../integration-codex/src/index.ts';
import { createCursorIntegrationAdapter } from '../../../integration-cursor/src/index.ts';
import { createAntigravityIntegrationAdapter, createGeminiIntegrationAdapter } from '../../../integration-gemini/src/index.ts';
import type { InstallManifest } from '../../../integrations-core/src/index.ts';
export type GovernedVendorConfigSurface = {
    rootDir: string;
    templateReadme: string;
    exists: boolean;
};
export declare function discoverGovernedVendorConfigSurface(repositoryRoot: string): GovernedVendorConfigSurface;
declare const integrationAdapterFactories: Readonly<{
    'claude-code': typeof createClaudeCodeIntegrationAdapter;
    codex: typeof createCodexIntegrationAdapter;
    copilot: typeof createCopilotIntegrationAdapter;
    cursor: typeof createCursorIntegrationAdapter;
    gemini: typeof createGeminiIntegrationAdapter;
    antigravity: typeof createAntigravityIntegrationAdapter;
}>;
type KnownCliIntegrationId = keyof typeof integrationAdapterFactories;
type EditorDetectionSource = 'ATM_EDITOR_ID' | 'ATM_ACTOR_ID' | 'AGENT_IDENTITY' | 'CODEX_HOME';
interface DetectedCurrentEditor {
    readonly id: KnownCliIntegrationId | null;
    readonly source: EditorDetectionSource | null;
    readonly rawValue: string | null;
}
export interface InstallIntegrationOptions {
    readonly actor?: string;
    readonly now?: string;
    readonly dryRun?: boolean;
    readonly force?: boolean;
}
export declare function checkIntegrationHealth(repositoryRoot: string): Promise<{
    ok: boolean;
    manifestDir: string;
    installed: string[];
    manifests: {
        ok: boolean;
        status: string;
        manifestPath: string;
        adapterId: string | null;
        findings: readonly unknown[];
        driftedFiles: readonly string[];
        staleFields: any[];
    }[];
    failed: {
        ok: boolean;
        status: string;
        manifestPath: string;
        adapterId: string | null;
        findings: readonly unknown[];
        driftedFiles: readonly string[];
        staleFields: any[];
    }[];
}>;
export declare function inspectIntegrationBootstrap(repositoryRoot: string): {
    repoBootstrapped: boolean;
    currentEditorId: "claude-code" | "copilot" | "cursor" | "gemini" | "codex" | "antigravity" | null;
    currentEditorDetectedFrom: EditorDetectionSource | null;
    currentEditorRawValue: string | null;
    currentEditorAdapter: {
        primaryEntryPath: string;
        primaryEntryPresent: boolean;
        installCommand: string;
        verifyCommand: string;
        status: "missing" | "installed" | "manifest-only" | "entry-only";
        id: import("packages/integrations-core/src/manifest/types.ts").IntegrationAdapterId;
        displayName: string;
        adapterVersion: string;
        targetDir: string;
        fileFormat: import("packages/integrations-core/src/manifest/types.ts").IntegrationFileFormat;
        placeholderStyle: import("packages/integrations-core/src/manifest/types.ts").IntegrationPlaceholderStyle;
        manifestPath: string;
        installed: boolean;
    } | null;
    currentEditorAdapterMissing: boolean;
    needsInstallHint: boolean;
    reason: string | null;
    installedAdapters: import("packages/integrations-core/src/manifest/types.ts").IntegrationAdapterId[];
    missingAdapters: import("packages/integrations-core/src/manifest/types.ts").IntegrationAdapterId[];
    adapters: {
        primaryEntryPath: string;
        primaryEntryPresent: boolean;
        installCommand: string;
        verifyCommand: string;
        status: "missing" | "installed" | "manifest-only" | "entry-only";
        id: import("packages/integrations-core/src/manifest/types.ts").IntegrationAdapterId;
        displayName: string;
        adapterVersion: string;
        targetDir: string;
        fileFormat: import("packages/integrations-core/src/manifest/types.ts").IntegrationFileFormat;
        placeholderStyle: import("packages/integrations-core/src/manifest/types.ts").IntegrationPlaceholderStyle;
        manifestPath: string;
        installed: boolean;
    }[];
    suggestedAction: string | null;
};
export declare function describeIntegrationInstallHint(bootstrap: ReturnType<typeof inspectIntegrationBootstrap>): {
    text: string;
    data: {
        reason: string | null;
        currentEditorId: "claude-code" | "copilot" | "cursor" | "gemini" | "codex" | "antigravity" | null;
        currentEditorDetectedFrom: EditorDetectionSource | null;
        currentEditorRawValue: string | null;
        suggestedAction: string | null;
        adapters: {
            id: import("packages/integrations-core/src/manifest/types.ts").IntegrationAdapterId;
            displayName: string;
            status: "missing" | "installed" | "manifest-only" | "entry-only";
            primaryEntryPath: string;
            installCommand: string;
            verifyCommand: string;
        }[];
    };
} | null;
export declare function runIntegration(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export declare function installIntegrationAdapter(repositoryRoot: string, adapterId: string, options?: InstallIntegrationOptions): Promise<{
    adapter: {
        id: import("packages/integrations-core/src/manifest/types.ts").IntegrationAdapterId;
        displayName: string;
        adapterVersion: string;
        targetDir: string;
        fileFormat: import("packages/integrations-core/src/manifest/types.ts").IntegrationFileFormat;
        placeholderStyle: import("packages/integrations-core/src/manifest/types.ts").IntegrationPlaceholderStyle;
        manifestPath: string;
        installed: boolean;
    };
    dryRun: boolean;
    manifestPath: string;
    writtenFiles: readonly string[];
    existingTargetFiles: string[];
    manifest: InstallManifest;
}>;
export declare function detectCurrentEditorIntegrationId(env?: NodeJS.ProcessEnv): DetectedCurrentEditor;
export {};
