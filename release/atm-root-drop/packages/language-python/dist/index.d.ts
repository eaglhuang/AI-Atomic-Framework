import type { EvidenceRecord } from '@ai-atomic-framework/core';
import type { LanguageAdapter as SdkLanguageAdapter } from '@ai-atomic-framework/plugin-sdk';
export declare const pythonLanguageAdapterPackage: {
    readonly packageName: "@ai-atomic-framework/language-python";
    readonly packageRole: "python-language-adapter";
    readonly packageVersion: "0.0.0";
};
export declare const languagePythonPackage: {
    readonly packageName: "@ai-atomic-framework/language-python";
    readonly packageRole: "python-language-adapter";
    readonly packageVersion: "0.0.0";
};
export type PythonPackageManager = 'pip' | 'poetry' | 'pipenv' | 'uv' | 'hatch' | 'unknown';
export interface PythonProjectProfile {
    readonly packageManager: PythonPackageManager;
    readonly hasPyprojectToml: boolean;
    readonly hasRequirementsTxt: boolean;
    readonly hasSetupPy: boolean;
    readonly hasSetupCfg: boolean;
    readonly hasPipfile: boolean;
    readonly hasPoetryLock: boolean;
    readonly testCommand: string | null;
    readonly typecheckCommand: string | null;
    readonly lintCommand: string | null;
    readonly declaredScripts: readonly string[];
}
export interface PythonSourceFile {
    readonly filePath: string;
    readonly sourceText: string;
}
export interface PythonImportPolicy {
    readonly forbiddenSpecifiers: readonly string[];
    readonly allowedSpecifiers?: readonly string[];
}
export interface PythonImportRecord {
    readonly filePath: string;
    readonly specifier: string;
    readonly statementKind: 'import' | 'from-import';
    readonly line: number;
}
export type PythonEntrypointKind = 'script-main' | 'package-main' | 'pipeline-script' | 'declared-script';
export interface PythonEntrypointRecord {
    readonly filePath: string;
    readonly kind: PythonEntrypointKind;
    readonly line: number;
    readonly symbol?: string;
}
export interface PythonAtomizePlanRequest {
    readonly atomId: string;
    readonly entrypoint: string;
    readonly sourceFiles: readonly PythonSourceFile[];
    readonly importPolicy?: PythonImportPolicy;
}
export interface PythonAtomizePlanStep {
    readonly stepKind: 'extract-unit' | 'wire-host-shim' | 'evidence-required';
    readonly description: string;
    readonly filePath?: string;
    readonly line?: number;
}
export interface PythonAtomizePlan {
    readonly atomId: string;
    readonly executionMode: 'dry-run';
    readonly entrypoint: string;
    readonly entrypointKind: PythonEntrypointKind | 'unknown';
    readonly steps: readonly PythonAtomizePlanStep[];
    readonly mutates: readonly string[];
    readonly evidenceRequired: readonly string[];
    readonly messages: readonly PythonLanguageAdapterMessage[];
}
export interface PythonLanguageAdapterMessage {
    readonly level: 'info' | 'warning' | 'error';
    readonly code: string;
    readonly text: string;
    readonly filePath?: string;
    readonly line?: number;
}
export interface PythonLanguageAdapterValidationRequest {
    readonly atomId: string;
    readonly entrypoint: string;
    readonly sourceFiles: readonly PythonSourceFile[];
    readonly importPolicy?: PythonImportPolicy;
}
export interface PythonLanguageAdapterValidationReport {
    readonly ok: boolean;
    readonly profile: PythonProjectProfile;
    readonly imports: readonly PythonImportRecord[];
    readonly entrypoints: readonly PythonEntrypointRecord[];
    readonly messages: readonly PythonLanguageAdapterMessage[];
    readonly commandRunnerContract: PythonCommandRunnerContract;
    readonly evidence: readonly EvidenceRecord[];
}
export interface PythonCommandRunnerContract {
    readonly executionMode: 'delegated';
    readonly packageManager: PythonPackageManager;
    readonly commands: readonly PythonValidationCommand[];
}
export interface PythonValidationCommand {
    readonly commandKind: 'test' | 'typecheck' | 'lint';
    readonly command: string;
    readonly required: boolean;
}
export type LanguageAdapter<Profile, Request, Report> = SdkLanguageAdapter<Profile, Request, Report>;
export interface PythonLanguageAdapter extends LanguageAdapter<PythonProjectProfile, PythonLanguageAdapterValidationRequest, PythonLanguageAdapterValidationReport> {
    readonly adapterName: '@ai-atomic-framework/language-python';
    readonly languageIds: readonly ['python'];
    readonly supportsAtomizeDryRun: true;
    readonly supportsInfectDryRun: true;
}
export declare const defaultPythonImportPolicy: PythonImportPolicy;
export declare const pythonLanguageRuntime: {
    readonly entrypoint: "./language-python-adapter.ts";
    readonly supportsEntrypointRules: true;
    readonly supportsImportScan: true;
    readonly supportsDelegatedTestCommands: true;
    readonly supportsAtomizeDryRun: true;
    readonly supportsInfectDryRun: true;
    readonly resultFormat: "PythonLanguageAdapterValidationReport";
};
export { createPythonLanguageAdapter, createPythonAtomizationPlanningAdapter, detectPythonProjectProfile, discoverPythonAtomCandidates, planPythonAtomizeFromCandidate, scanPythonImports, scanPythonEntrypoints, planPythonAtomize, validatePythonComputeAtom, createPythonCommandRunnerContract } from './language-python-adapter.ts';
