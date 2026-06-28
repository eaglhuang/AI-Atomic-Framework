import type { BrokerDecision, BrokerDecisionFailureReason, ConflictDetail } from './types.ts';

function extractQuotedValue(detail: string): string | null {
  const match = /'([^']+)'/.exec(detail);
  return match?.[1] ?? null;
}

function classifyBlockingLayer(conflict: ConflictDetail | undefined): BrokerDecisionFailureReason['blockingLayer'] {
  if (!conflict) {
    return 'none';
  }
  if (conflict.kind === 'generator' || conflict.kind === 'projection' || conflict.kind === 'validator' || conflict.kind === 'registry' || conflict.kind === 'artifact') {
    return 'shared-surface';
  }
  if (conflict.kind === 'cid') {
    return 'cid';
  }
  if (conflict.kind === 'file-range') {
    return 'file-range';
  }
  if (conflict.kind === 'lease') {
    return 'lease';
  }
  return 'none';
}

function inferConflictKey(conflict: ConflictDetail | undefined): string | null {
  if (!conflict) {
    return null;
  }
  if (conflict.kind === 'file-range') {
    const filePath = extractQuotedValue(conflict.detail);
    if (filePath) {
      return `file:${filePath}`;
    }
  }
  return conflict.detail;
}

function inferSharedSurface(conflict: ConflictDetail | undefined): string | null {
  if (!conflict) {
    return null;
  }
  const layer = classifyBlockingLayer(conflict);
  return layer === 'shared-surface' ? extractQuotedValue(conflict.detail) : null;
}

function inferConflictingCid(conflict: ConflictDetail | undefined): string | null {
  if (!conflict || classifyBlockingLayer(conflict) !== 'cid') {
    return null;
  }
  return extractQuotedValue(conflict.detail);
}

function inferPreservedIntentId(conflict: ConflictDetail | undefined): string | null {
  if (!conflict) {
    return null;
  }
  const taskMatch = /task '([^']+)'/.exec(conflict.detail) ?? /task "([^"]+)"/.exec(conflict.detail);
  return taskMatch ? `active:${taskMatch[1]}` : null;
}

export function buildBrokerDecisionFailureReason(decision: BrokerDecision): BrokerDecisionFailureReason | undefined {
  if (decision.verdict === 'parallel-safe') {
    return undefined;
  }

  const primaryConflict = decision.conflicts[0];
  const blockingLayer = classifyBlockingLayer(primaryConflict);
  let recommendedRoute: BrokerDecisionFailureReason['recommendedRoute'] = 'serialize';
  if (decision.verdict === 'needs-physical-split') {
    recommendedRoute = 'compose';
  } else if (decision.verdict === 'blocked-active-lease') {
    recommendedRoute = blockingLayer === 'lease' ? 'takeover' : 'rearbitrate';
  }

  return {
    verdict: decision.verdict,
    blockingLayer,
    conflictingCid: inferConflictingCid(primaryConflict),
    conflictKey: inferConflictKey(primaryConflict),
    sharedSurface: inferSharedSurface(primaryConflict),
    preservedIntentId: inferPreservedIntentId(primaryConflict),
    patchEnvelope: decision.applyMethod === 'patch-apply' ? 'patch-apply-envelope' : null,
    recommendedRoute,
    validatorTranscript: null
  };
}
