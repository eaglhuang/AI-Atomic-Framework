import type {
  EvidenceRecord,
  EvidenceSignalKind,
  EvidenceSignalScope
} from '@ai-atomic-framework/core';

export type ConversationTurnIntent =
  | 'correction'
  | 'failure'
  | 'wrong-load'
  | 'preference'
  | 'success'
  | 'rollback-success'
  | 'novel-technique'
  | 'neutral';

export interface ConversationTurn {
  readonly role: 'user' | 'agent' | 'system';
  readonly intent: ConversationTurnIntent;
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly occurredAt?: string;
}

export interface ConversationLog {
  readonly sessionId: string;
  readonly window?: string;
  readonly redacted: true;
  readonly containsSensitiveInput?: boolean;
  readonly redactionReport?: string;
  readonly atomId?: string;
  readonly atomMapId?: string;
  readonly signalScope?: EvidenceSignalScope;
  readonly turns: readonly ConversationTurn[];
  readonly producedBy?: string;
}

export interface ConversationEvidenceExtractionInput {
  readonly logs: readonly ConversationLog[];
  readonly window?: string;
  readonly extractorName?: string;
}

export interface ConversationEvidenceExtractionReport {
  readonly schemaId: 'atm.conversationEvidenceExtractionReport';
  readonly specVersion: '0.1.0';
  readonly extractorName: string;
  readonly window?: string;
  readonly summary: {
    readonly totalLogs: number;
    readonly totalTurns: number;
    readonly emittedEvidence: number;
    readonly skippedSessions: number;
  };
  readonly evidence: readonly EvidenceRecord[];
  readonly skippedSessions: readonly { readonly sessionId: string; readonly reason: string }[];
}

export type ConversationDrivenExtractionErrorCode =
  | 'unredacted-input'
  | 'sensitive-without-redaction-report';

export class ConversationDrivenExtractionError extends Error {
  readonly code: ConversationDrivenExtractionErrorCode;
  readonly sessionId: string;
  constructor(code: ConversationDrivenExtractionErrorCode, sessionId: string, message: string) {
    super(message);
    this.name = 'ConversationDrivenExtractionError';
    this.code = code;
    this.sessionId = sessionId;
  }
}

const intentToSignalKind: Record<ConversationTurnIntent, EvidenceSignalKind | null> = {
  correction: 'user-correction',
  failure: 'recurring-failure',
  'wrong-load': 'loaded-but-wrong',
  preference: 'user-correction',
  success: 'workflow-success',
  'rollback-success': 'rollback-success',
  'novel-technique': 'novel-technique',
  neutral: null
};

type Bucket = {
  intent: ConversationTurnIntent;
  signalKind: EvidenceSignalKind;
  tags: Set<string>;
  confidences: number[];
  timestamps: string[];
  count: number;
  summaries: string[];
};

export const conversationEvidenceExtractorName = 'deterministic-conversation-evidence-extractor';

export function extractEvidenceFromConversations(
  input: ConversationEvidenceExtractionInput
): ConversationEvidenceExtractionReport {
  const extractorName = input.extractorName ?? conversationEvidenceExtractorName;
  const skipped: { sessionId: string; reason: string }[] = [];
  const evidence: EvidenceRecord[] = [];
  let totalTurns = 0;

  for (const log of input.logs) {
    if (log.redacted !== true) {
      throw new ConversationDrivenExtractionError(
        'unredacted-input',
        log.sessionId,
        `conversation log "${log.sessionId}" must be redacted before extraction`
      );
    }
    if (log.containsSensitiveInput === true && !log.redactionReport) {
      throw new ConversationDrivenExtractionError(
        'sensitive-without-redaction-report',
        log.sessionId,
        `conversation log "${log.sessionId}" contains sensitive input but no redactionReport was provided`
      );
    }
    totalTurns += log.turns.length;

    const window = log.window ?? input.window ?? 'unspecified';
    const buckets = new Map<ConversationTurnIntent, Bucket>();

    for (const turn of log.turns) {
      const signalKind = intentToSignalKind[turn.intent];
      if (!signalKind) continue;
      let bucket = buckets.get(turn.intent);
      if (!bucket) {
        bucket = {
          intent: turn.intent,
          signalKind,
          tags: new Set<string>(),
          confidences: [],
          timestamps: [],
          count: 0,
          summaries: []
        };
        buckets.set(turn.intent, bucket);
      }
      bucket.count += 1;
      bucket.confidences.push(typeof turn.confidence === 'number' ? turn.confidence : 0.9);
      if (turn.occurredAt) bucket.timestamps.push(turn.occurredAt);
      for (const tag of turn.tags ?? []) bucket.tags.add(tag);
      bucket.summaries.push(turn.summary);
    }

    if (buckets.size === 0) {
      skipped.push({ sessionId: log.sessionId, reason: 'no-signal-turn' });
      continue;
    }

    const sortedBuckets = [...buckets.values()].sort((a, b) => a.intent.localeCompare(b.intent));

    for (const bucket of sortedBuckets) {
      const sortedTimestamps = [...bucket.timestamps].sort();
      const firstSeenAt = sortedTimestamps[0];
      const lastSeenAt = sortedTimestamps[sortedTimestamps.length - 1];
      const avg = bucket.confidences.reduce((sum, value) => sum + value, 0) / bucket.confidences.length;
      const confidence = Number(avg.toFixed(4));

      let signalScope: EvidenceSignalScope | undefined = log.signalScope;
      let atomId: string | undefined = log.atomId;
      let atomMapId: string | undefined = log.atomMapId;

      // Preference signals are inherently single-user / single-host preferences.
      // Downgrade to host-local at extraction time so they cannot be promoted
      // to atom-spec by a downstream draft bridge.
      if (bucket.intent === 'preference') {
        signalScope = 'host-local';
        atomId = undefined;
        atomMapId = undefined;
      } else if (!signalScope) {
        if (atomId) signalScope = 'atom';
        else if (atomMapId) signalScope = 'atom-map';
      }

      const targetIdForId = atomId ?? atomMapId ?? 'none';
      const evidenceId = `evidence.conv.${log.sessionId}.${bucket.signalKind}.${targetIdForId}`;
      const patternTags = [...bucket.tags].sort();

      const record: EvidenceRecord = {
        evidenceId,
        evidenceKind: 'review',
        signalKind: bucket.signalKind,
        ...(signalScope ? { signalScope } : {}),
        ...(atomId ? { atomId } : {}),
        ...(atomMapId ? { atomMapId } : {}),
        ...(patternTags.length > 0 ? { patternTags } : {}),
        confidence,
        recurrence: {
          window,
          count: bucket.count,
          ...(firstSeenAt ? { firstSeenAt } : {}),
          ...(lastSeenAt ? { lastSeenAt } : {})
        },
        summary: bucket.summaries[0] ?? `conversation-driven signal ${bucket.signalKind}`,
        artifactPaths: log.redactionReport ? [log.redactionReport] : [],
        ...(log.producedBy ? { producedBy: log.producedBy } : {})
      };
      evidence.push(record);
    }
  }

  evidence.sort((a, b) => (a.evidenceId ?? '').localeCompare(b.evidenceId ?? ''));

  return {
    schemaId: 'atm.conversationEvidenceExtractionReport',
    specVersion: '0.1.0',
    extractorName,
    ...(input.window ? { window: input.window } : {}),
    summary: {
      totalLogs: input.logs.length,
      totalTurns,
      emittedEvidence: evidence.length,
      skippedSessions: skipped.length
    },
    evidence,
    skippedSessions: skipped
  };
}
