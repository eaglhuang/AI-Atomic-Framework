import type { EvidenceRecord } from '@ai-atomic-framework/core';

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

export interface JavaScriptValidationReport {
  readonly profile: JavaScriptProjectProfile;
  readonly evidence: readonly EvidenceRecord[];
}