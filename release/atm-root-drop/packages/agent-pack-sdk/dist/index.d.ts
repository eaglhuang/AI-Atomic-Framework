export * from './install-manifest.ts';
export { ExperimentalApiError, experimentalApiSchemaVersion, invokeExperimentalApi, listExperimentalApis } from './experimental/index.ts';
export type { ExperimentalApiDescriptor, ExperimentalApiId, ExperimentalApiInvocationInput, ExperimentalApiInvocationResult } from './experimental/index.ts';
/** A single file managed by an agent pack. */
export interface TargetFile {
    /** Destination path relative to host repo root. */
    path: string;
    /** Template content; supports {{VAR}} substitution via RenderContext.vars. */
    template: string;
    /** When true, an existing file with non-template content blocks install. */
    protected: boolean;
}
/** Declarative descriptor for an agent pack. */
export interface AgentPack {
    /** Unique pack identifier, for example: "claude-code". */
    packId: string;
    /** Human-readable display name. */
    name: string;
    /** Semver version string, for example: "0.1.0". */
    version: string;
    /** Agent environment this pack targets, for example: "claude-code" | "copilot". */
    agentTarget: string;
    /** Files this pack manages in the host repo. */
    targetFiles: TargetFile[];
    /** Source hash of this pack definition for freshness tracking. */
    sourceHash?: string;
}
/** Contextual values injected when rendering a pack's target files. */
export interface RenderContext {
    /** Host repository root path. */
    cwd: string;
    /** Optional variable substitutions applied to TargetFile templates. */
    vars?: Record<string, string>;
}
/** Machine-readable record written after a successful pack install. */
export interface RenderedManifest {
    packId: string;
    version: string;
    installedAt: string;
    renderedFiles: Array<{
        path: string;
        contentHash: string;
    }>;
    sourceHash: string;
}
/**
 * Render a pack's target files against the given context and return a
 * RenderedManifest describing each file's content hash.
 *
 * Pure function — does not write to disk.
 */
export declare function renderManifest(pack: AgentPack, context: RenderContext): RenderedManifest;
/**
 * Hash an array of file content strings and return a single aggregate SHA-256
 * hex digest.
 *
 * Pure function — does not read from disk.
 */
export declare function hashFiles(contents: string[]): string;
