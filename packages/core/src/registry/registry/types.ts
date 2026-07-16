import type { SemanticFingerprintPortRecord } from '../semantic-fingerprint.ts';

/** Shape expected for a normalized atom spec model passed into registry functions. */
export interface NormalizedModel {
  identity: { atomId: string; logicalName?: string };
  schema: { schemaId: string; specVersion: string };
  source: { specPath: string | null; schemaPath?: string };
  hashLock: Record<string, unknown>;
  governance?: { semanticFingerprint?: unknown };
  ports?: { inputs?: SemanticFingerprintPortRecord[]; outputs?: SemanticFingerprintPortRecord[] };
  execution: {
    language?: { primary?: string | null };
    validation?: { evidenceRequired?: boolean };
    performanceBudget?: Readonly<Record<string, unknown>> | null;
    compatibility: {
      coreVersion: string;
      registryVersion: string;
      pluginApiVersion?: string;
      languageAdapter?: string;
    };
  };
}

export interface RegistryEntryOptions {
  repositoryRoot?: string;
  specPath?: string;
  codePaths?: string | string[];
  testPaths?: string | string[];
  legacyPlanningId?: string | null;
  reportPath?: string | null;
  workbenchPath?: string | null;
  atomVersion?: string | number;
  currentVersion?: string;
  semanticFingerprint?: unknown;
  versions?: VersionRecord[];
  status?: string;
  governance?: { tier?: string };
  governanceTier?: string;
  id?: string;
  logicalName?: string;
  schemaPath?: string;
  owner?: { name?: string; contact?: string };
  lineageLogRef?: string;
  evidenceIndexRef?: string;
  ttl?: number;
  evidence?: string[];
  testReport?: {
    artifacts?: Array<{ artifactKind: string; artifactPath: string }>;
    evidence?: Array<{ artifactPaths?: string[] }>;
  };
}

export interface VersionRecord {
  version?: string;
  specHash?: string;
  codeHash?: string;
  testHash?: string;
  timestamp?: string;
  semanticFingerprint?: unknown;
}

export interface NormalizedVersionRecord {
  version: string;
  specHash: string;
  codeHash: string;
  testHash: string;
  timestamp: string;
  semanticFingerprint?: unknown;
}

export interface RegistryDocumentOptions {
  registryId?: string;
  generatedAt?: string;
  migration?: { strategy?: string; fromVersion?: string | null; notes?: string };
  sharding?: { strategy?: string; partPaths?: string[]; nextRegistryId?: string | null };
}

export interface WriteRegistryArtifactsOptions {
  repositoryRoot?: string;
  registryPath?: string;
  writeCatalog?: boolean;
  specRepositoryRoot?: string;
  catalogPath?: string;
  catalogTitle?: string;
  sourceOfTruthLabel?: string;
}

export interface ValidateRegistryDocumentOptions {
  schemaPath?: string;
  validatorMode?: string;
  validatorReason?: string;
}

export interface EvaluateRegistryEntryDriftOptions {
  repositoryRoot?: string;
}

export interface RegistryEntry {
  selfVerification?: {
    sourcePaths?: { spec?: string; code?: string | string[]; tests?: string[] };
    specHash?: string;
    codeHash?: string;
    testHash?: string;
    legacyPlanningId?: string | null;
  };
}

export interface ValidationIssue {
  code: string;
  keyword: string;
  path: string;
  text: string;
  prompt: string;
}

export type IssueReporter = (pathValue: string, keyword: string, text: string) => void;
