import type { EvidenceRecord } from '@ai-atomic-framework/core';
import type { AtomLifecycleModeValue } from './lifecycle';

export interface LanguageSourceFile {
  readonly filePath: string;
  readonly sourceText: string;
  readonly languageId: string;
}

export interface LanguageProjectProfile {
  readonly languageIds: readonly string[];
  readonly packageManager?: string;
  readonly commands?: Readonly<Record<string, string>>;
}

export interface LanguageAdapterValidationRequest {
  readonly atomId: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly entrypoint: string;
  readonly sourceFiles: readonly LanguageSourceFile[];
  readonly policy?: Readonly<Record<string, unknown>>;
}

export interface LanguageAdapterMessage {
  readonly level: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly text: string;
  readonly filePath?: string;
  readonly line?: number;
}

export interface LanguageAdapterReport {
  readonly ok: boolean;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly messages: readonly LanguageAdapterMessage[];
  readonly evidence: readonly EvidenceRecord[];
}

export interface LanguageAdapter<Profile = LanguageProjectProfile, Request = LanguageAdapterValidationRequest, Report = LanguageAdapterReport> {
  readonly adapterName: string;
  readonly languageIds: readonly string[];
  detectProjectProfile(repositoryRoot: string): Promise<Profile> | Profile;
  validateComputeAtom(request: Request): Promise<Report> | Report;
}