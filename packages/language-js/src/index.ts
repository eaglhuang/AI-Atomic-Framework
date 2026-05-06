import type { EvidenceRecord } from '@ai-atomic-framework/core';
import type { LanguageAdapter as SdkLanguageAdapter } from '@ai-atomic-framework/plugin-sdk';

export const languageJsPackage = {
  packageName: '@ai-atomic-framework/language-js',
  packageRole: 'javascript-typescript-language-adapter',
  packageVersion: '0.0.0'
} as const;

export interface JavaScriptProjectProfile {
  readonly packageManager: 'npm' | 'pnpm' | 'yarn' | 'unknown';
  readonly testCommand: string | null;
  readonly typecheckCommand: string | null;
  readonly lintCommand: string | null;
}

export interface LanguageAdapterValidationRequest {
  readonly atomId: string;
  readonly entrypoint: string;
  readonly sourceFiles: readonly JavaScriptSourceFile[];
  readonly importPolicy: JavaScriptImportPolicy;
}

export interface JavaScriptSourceFile {
  readonly filePath: string;
  readonly sourceText: string;
}

export interface JavaScriptImportPolicy {
  readonly forbiddenSpecifiers: readonly string[];
  readonly allowedSpecifiers?: readonly string[];
}

export interface JavaScriptImportRecord {
  readonly filePath: string;
  readonly specifier: string;
  readonly statementKind: 'static-import' | 're-export' | 'dynamic-import' | 'require';
  readonly line: number;
}

export interface JavaScriptValidationMessage {
  readonly level: 'info' | 'error';
  readonly code: string;
  readonly text: string;
  readonly filePath?: string;
  readonly line?: number;
}

export interface TestCommandRunnerContract {
  readonly executionMode: 'delegated';
  readonly packageManager: JavaScriptProjectProfile['packageManager'];
  readonly commands: readonly JavaScriptValidationCommand[];
}

export interface JavaScriptValidationCommand {
  readonly commandKind: 'test' | 'typecheck' | 'lint';
  readonly command: string;
  readonly required: boolean;
}

export type LanguageAdapter<Profile, Request, Report> = SdkLanguageAdapter<Profile, Request, Report>;

export interface JavaScriptValidationReport {
  readonly ok: boolean;
  readonly profile: JavaScriptProjectProfile;
  readonly imports: readonly JavaScriptImportRecord[];
  readonly messages: readonly JavaScriptValidationMessage[];
  readonly commandRunnerContract: TestCommandRunnerContract;
  readonly evidence: readonly EvidenceRecord[];
}

export interface JavaScriptLanguageAdapter extends LanguageAdapter<JavaScriptProjectProfile, LanguageAdapterValidationRequest, JavaScriptValidationReport> {
  readonly adapterName: '@ai-atomic-framework/language-js';
  readonly languageIds: readonly ['javascript', 'typescript'];
}

export const defaultJavaScriptImportPolicy: JavaScriptImportPolicy = {
  forbiddenSpecifiers: ['fs', 'node:fs', 'child_process', 'node:child_process']
};

export const languageJsRuntime = {
  entrypoint: './language-js-adapter.mjs',
  supportsImportScan: true,
  supportsEntrypointRules: true,
  supportsDelegatedTestCommands: true,
  resultFormat: 'JavaScriptValidationReport'
} as const;