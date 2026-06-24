import type { GitAdmissionResult } from '../git/admission.ts';
export interface GitBoundaryConflictKeyRecord {
    readonly side: 'local' | 'remote';
    readonly filePath: string;
    readonly scope: string;
    readonly key: string;
}
export interface GitBoundaryEvidenceEnvelope {
    readonly schemaId: 'atm.gitBoundaryEvidenceEnvelope.v1';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly actorId: string;
    readonly remoteVirtualActorId: string;
    readonly taskId: string | null;
    readonly branch: string;
    readonly remote: string;
    readonly remoteRef: string;
    readonly baseCommit: string;
    readonly localHead: string;
    readonly remoteHead: string;
    readonly targetFiles: readonly string[];
    readonly conflictKeys: readonly GitBoundaryConflictKeyRecord[];
    readonly conflictingFiles: readonly string[];
    readonly lane: string | null;
    readonly verdict: string | null;
    readonly outcome: GitAdmissionResult['outcome'];
    readonly recommendation: string;
    readonly diagnostics: readonly string[];
    readonly artifactPaths: readonly string[];
}
export declare function buildGitBoundaryEvidenceEnvelope(input: {
    readonly actorId: string;
    readonly taskId: string | null;
    readonly result: GitAdmissionResult;
    readonly generatedAt?: string;
}): GitBoundaryEvidenceEnvelope;
