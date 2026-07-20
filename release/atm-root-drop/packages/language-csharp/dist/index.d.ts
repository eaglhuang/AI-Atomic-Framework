import type { EvidenceRecord } from '@ai-atomic-framework/core';
import type { LanguageAdapter as SdkLanguageAdapter, LanguageAdapterManifest as SdkLanguageAdapterManifest, LanguageAdapterStaticCheckPlan as SdkLanguageAdapterStaticCheckPlan } from '@ai-atomic-framework/plugin-sdk';
export declare const csharpLanguageAdapterPackage: {
    readonly packageName: "@ai-atomic-framework/language-csharp";
    readonly packageRole: "csharp-language-adapter";
    readonly packageVersion: "0.0.0";
};
export type CSharpPackageManager = 'dotnet' | 'unknown';
export interface CSharpProjectProfile {
    readonly packageManager: CSharpPackageManager;
    readonly hasSolutionFile: boolean;
    readonly hasProjectFile: boolean;
    readonly testCommand: string | null;
    readonly typecheckCommand: string | null;
    readonly lintCommand: string | null;
}
export interface CSharpSourceFile {
    readonly filePath: string;
    readonly sourceText: string;
}
export interface CSharpImportPolicy {
    readonly forbiddenSpecifiers: readonly string[];
    readonly allowedSpecifiers?: readonly string[];
}
export interface CSharpImportRecord {
    readonly filePath: string;
    readonly specifier: string;
    readonly statementKind: 'using' | 'global-using';
    readonly line: number;
}
export interface CSharpEntrypointRecord {
    readonly filePath: string;
    readonly kind: 'static-main';
    readonly line: number;
    readonly symbol: 'Main';
}
export interface CSharpLanguageAdapterValidationRequest {
    readonly atomId: string;
    readonly entrypoint: string;
    readonly sourceFiles: readonly CSharpSourceFile[];
    readonly importPolicy?: CSharpImportPolicy;
}
export interface CSharpLanguageAdapterMessage {
    readonly level: 'info' | 'warning' | 'error';
    readonly code: string;
    readonly text: string;
    readonly filePath?: string;
    readonly line?: number;
}
export interface CSharpValidationCommand {
    readonly commandKind: 'test' | 'typecheck' | 'lint';
    readonly command: string;
    readonly required: boolean;
}
export interface CSharpCommandRunnerContract {
    readonly executionMode: 'delegated';
    readonly packageManager: CSharpPackageManager;
    readonly commands: readonly CSharpValidationCommand[];
}
export interface CSharpLanguageAdapterValidationReport {
    readonly ok: boolean;
    readonly profile: CSharpProjectProfile;
    readonly imports: readonly CSharpImportRecord[];
    readonly entrypoints: readonly CSharpEntrypointRecord[];
    readonly messages: readonly CSharpLanguageAdapterMessage[];
    readonly commandRunnerContract: CSharpCommandRunnerContract;
    readonly evidence: readonly EvidenceRecord[];
}
export type LanguageAdapter<Profile, Request, Report> = SdkLanguageAdapter<Profile, Request, Report>;
export type CSharpLanguageAdapterManifest = SdkLanguageAdapterManifest;
export type CSharpStaticCheckPlan = SdkLanguageAdapterStaticCheckPlan;
export interface CSharpLanguageAdapter extends LanguageAdapter<CSharpProjectProfile, CSharpLanguageAdapterValidationRequest, CSharpLanguageAdapterValidationReport> {
    readonly adapterName: '@ai-atomic-framework/language-csharp';
    readonly languageIds: readonly ['csharp'];
    readonly manifest: CSharpLanguageAdapterManifest;
    scanImports(sourceFile: CSharpSourceFile): readonly CSharpImportRecord[];
    scanEntrypoints(sourceFile: CSharpSourceFile): readonly CSharpEntrypointRecord[];
    createCommandRunnerContract(profile: CSharpProjectProfile): CSharpCommandRunnerContract;
    getFastStaticCheck(profile: CSharpProjectProfile): CSharpStaticCheckPlan;
    getDefaultStaticCheck(profile: CSharpProjectProfile): CSharpStaticCheckPlan;
    getAllStaticCheck(profile: CSharpProjectProfile): CSharpStaticCheckPlan;
}
export declare const defaultCSharpImportPolicy: CSharpImportPolicy;
export declare const csharpLanguageRuntime: {
    readonly entrypoint: "./language-csharp-adapter.ts";
    readonly supportsEntrypointRules: true;
    readonly supportsImportScan: true;
    readonly supportsDelegatedTestCommands: true;
    readonly resultFormat: "CSharpLanguageAdapterValidationReport";
};
export { createAllCSharpStaticCheck, createCSharpCommandRunnerContract, createCSharpLanguageAdapter, createDefaultCSharpStaticCheck, createFastCSharpStaticCheck, defaultCSharpLanguageAdapterManifest, detectCSharpProjectProfile, scanCSharpEntrypoints, scanCSharpImports, validateCSharpComputeAtom } from './language-csharp-adapter.ts';
