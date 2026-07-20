import type { GovernedVendorConfigSurface } from './types.ts';
export declare function discoverGovernedVendorConfigSurface(repositoryRoot: string): GovernedVendorConfigSurface;
export declare function inspectIntegrationBootstrap(repositoryRoot: string): {
    repoBootstrapped: boolean;
    currentEditorId: "claude-code" | "copilot" | "cursor" | "gemini" | "codex" | "antigravity" | null;
    currentEditorDetectedFrom: import("./adapters.ts").EditorDetectionSource | null;
    currentEditorRawValue: string | null;
    currentEditorAdapter: {
        primaryEntryPath: string;
        primaryEntryPresent: boolean;
        installCommand: string;
        verifyCommand: string;
        status: "installed" | "missing" | "manifest-only" | "entry-only";
        id: import("@ai-atomic-framework/integrations-core").IntegrationAdapterId;
        displayName: string;
        adapterVersion: string;
        targetDir: string;
        fileFormat: import("@ai-atomic-framework/integrations-core").IntegrationFileFormat;
        placeholderStyle: import("@ai-atomic-framework/integrations-core").IntegrationPlaceholderStyle;
        manifestPath: string;
        installed: boolean;
    } | null;
    currentEditorAdapterMissing: boolean;
    needsInstallHint: boolean;
    reason: string | null;
    installedAdapters: import("@ai-atomic-framework/integrations-core").IntegrationAdapterId[];
    missingAdapters: import("@ai-atomic-framework/integrations-core").IntegrationAdapterId[];
    adapters: {
        primaryEntryPath: string;
        primaryEntryPresent: boolean;
        installCommand: string;
        verifyCommand: string;
        status: "installed" | "missing" | "manifest-only" | "entry-only";
        id: import("@ai-atomic-framework/integrations-core").IntegrationAdapterId;
        displayName: string;
        adapterVersion: string;
        targetDir: string;
        fileFormat: import("@ai-atomic-framework/integrations-core").IntegrationFileFormat;
        placeholderStyle: import("@ai-atomic-framework/integrations-core").IntegrationPlaceholderStyle;
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
        currentEditorDetectedFrom: import("./adapters.ts").EditorDetectionSource | null;
        currentEditorRawValue: string | null;
        suggestedAction: string | null;
        adapters: {
            id: import("@ai-atomic-framework/integrations-core").IntegrationAdapterId;
            displayName: string;
            status: "installed" | "missing" | "manifest-only" | "entry-only";
            primaryEntryPath: string;
            installCommand: string;
            verifyCommand: string;
        }[];
    };
} | null;
