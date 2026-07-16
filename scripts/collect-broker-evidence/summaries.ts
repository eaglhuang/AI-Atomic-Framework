import type { BrokerEnvelope, BrokerExperimentRun, BrokerRegistryDocument, BrokerRunSummary, GitBoundaryEvidenceEnvelope, RegistryActiveIntent, TeamRun } from './types.ts';
import { addStringValue, collectObjectStringsByKey, collectTags, firstStringByKey, sanitizeRunId, toCsv, uniq } from './strings.ts';

export function deriveAdmissionStateFromBrokerLane(brokerLane: unknown): string | null {
  const brokerLaneObject = brokerLane && typeof brokerLane === 'object'
    ? brokerLane as Record<string, unknown>
    : null;
  const admission = brokerLaneObject?.admission;
  return firstStringByKey(admission, new Set(['state', 'admissionState']));
}


export function summarizeEnvelopeRecord(run: BrokerEnvelope, runSource: string): BrokerRunSummary | null {
  if (typeof run.runId !== 'string' || !run.runId) {
    return null;
  }

  const records = Array.isArray(run.records) ? run.records : [];
  const identities = new Set<string>();
  const actors = new Set<string>();
  const files = new Set<string>();
  const tasks = new Set<string>();
  const adapters = new Set<string>();
  const lanes = new Set<string>();
  const verdicts = new Set<string>();
  const commits = new Set<string>();
  const tx = new Set<string>();

  const scenarios = new Set<string>();

  for (const record of records) {
    for (const requestIdentity of uniq(record.request_identity)) {
      identities.add(requestIdentity);
      const split = collectTags(requestIdentity);
      split.scenarios.forEach((value) => scenarios.add(value));
      split.tasks.forEach((value) => tasks.add(value));
    }

    for (const actorId of uniq(record.actor_ids)) {
      actors.add(actorId);
    }

    for (const file of uniq(record.request_files)) {
      files.add(file);
    }

    for (const file of uniq(record.applied_files)) {
      files.add(file);
    }

    for (const taskId of uniq(record.task_ids)) {
      tasks.add(taskId);
    }

    if (record.adapter_choice) {
      adapters.add(record.adapter_choice);
    }
    if (record.lane_decision) {
      lanes.add(record.lane_decision);
    }
    if (record.merge_verdict) {
      verdicts.add(record.merge_verdict);
    }
    if (record.commit_sha) {
      commits.add(record.commit_sha);
    }
    for (const transaction of uniq(record.transaction_ids)) {
      tx.add(transaction);
    }
  }

  const evidenceValue = (records[0]?.evidence_path?.trim() ?? runSource).replace(/\\/g, '/');

  return {
    runId: run.runId,
    planId: typeof run.planId === 'string' ? run.planId : 'unknown',
    scenario: [...scenarios].sort().join(',') || 'field',
    tasks: toCsv(tasks),
    actors: toCsv(actors),
    files: toCsv(new Set(files)),
    vendor: [...adapters].length === 1 ? [...adapters][0]! : toCsv(adapters),
    lane: [...lanes].length === 1 ? [...lanes][0]! : toCsv(lanes),
    verdict: [...verdicts].length === 1 ? [...verdicts][0]! : toCsv(verdicts),
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: evidenceValue
  };
}

export function summarizeExperimentRun(run: BrokerExperimentRun): BrokerRunSummary | null {
  if (typeof run.runId !== 'string' || !run.runId) {
    return null;
  }

  const mutations = Array.isArray(run.mutationEvidence) ? run.mutationEvidence : [];
  const identities = new Set<string>();
  const actors = new Set<string>();
  const files = new Set<string>();
  const tasks = new Set<string>();
  const vendors = new Set<string>();
  const lanes = new Set<string>();
  const verdicts = new Set<string>();
  const commits = new Set<string>();
  const tx = new Set<string>();
  const scenarios = new Set<string>();

  for (const mutation of mutations) {
    if (mutation.requestId) {
      identities.add(mutation.requestId);
      const split = collectTags(mutation.requestId);
      split.scenarios.forEach((value) => scenarios.add(value));
      split.tasks.forEach((value) => tasks.add(value));
    }
    if (mutation.actorId) {
      actors.add(mutation.actorId);
    }
    if (mutation.filePath) {
      files.add(mutation.filePath);
    }
    if (mutation.adapterId) {
      vendors.add(mutation.adapterId);
    }
    if (mutation.mergeDecision) {
      lanes.add(mutation.mergeDecision);
    }
    if (mutation.verdict) {
      verdicts.add(mutation.verdict);
    }
    if (mutation.baseHash) {
      commits.add(mutation.baseHash);
    }
    if (mutation.resultHash) {
      commits.add(mutation.resultHash);
    }
    if (mutation.transactionId) {
      tx.add(mutation.transactionId);
    }
  }

  const evidenceValue = typeof run.runEvidencePath === 'string'
    ? run.runEvidencePath
    : `.atm/history/evidence/broker-runs/${run.runId}.json`;

  return {
    runId: run.runId,
    planId: run.plan?.planId ?? 'unknown',
    scenario: [...scenarios].sort().join(',') || 'field',
    tasks: toCsv(tasks),
    actors: toCsv(actors),
    files: toCsv(new Set(files)),
    vendor: [...vendors].length === 1 ? [...vendors][0]! : toCsv(vendors),
    lane: [...lanes].length === 1 ? [...lanes][0]! : toCsv(lanes),
    verdict: [...verdicts].length === 1 ? [...verdicts][0]! : toCsv(verdicts),
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: evidenceValue
  };
}

export function isBrokerEnvelope(value: unknown): value is BrokerEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as BrokerEnvelope;
  return maybe.schemaId === 'atm.brokerOperationRunRecordEnvelope.v1'
    || typeof maybe.records !== 'undefined'
    || typeof maybe.runId === 'string';
}

export function isBrokerExperimentRun(value: unknown): value is BrokerExperimentRun {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as BrokerExperimentRun;
  return typeof maybe.runEvidencePath === 'string'
    || (typeof maybe.runId === 'string' && Array.isArray(maybe.mutationEvidence));
}

export function isTeamRun(value: unknown): value is TeamRun {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as TeamRun;
  return maybe.schemaId === 'atm.teamRun.v1' && typeof maybe.teamRunId === 'string';
}

export function isBrokerRegistry(value: unknown): value is BrokerRegistryDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as BrokerRegistryDocument;
  return maybe.schemaId === 'atm.writeBrokerRegistry.v1' && Array.isArray(maybe.activeIntents);
}

export function isGitBoundaryEvidenceEnvelope(value: unknown): value is GitBoundaryEvidenceEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as GitBoundaryEvidenceEnvelope;
  return maybe.schemaId === 'atm.gitBoundaryEvidenceEnvelope.v1';
}

export function summarizeGitBoundaryEvidence(run: GitBoundaryEvidenceEnvelope, runSource: string): BrokerRunSummary | null {
  if (typeof run.actorId !== 'string' || typeof run.remoteRef !== 'string') {
    return null;
  }
  const taskId = typeof run.taskId === 'string' && run.taskId.trim() ? run.taskId.trim() : 'n/a';
  const localHead = typeof run.localHead === 'string' && run.localHead.trim() ? run.localHead.trim() : 'n/a';
  const remoteHead = typeof run.remoteHead === 'string' && run.remoteHead.trim() ? run.remoteHead.trim() : 'n/a';
  const identities = [localHead, remoteHead].filter((entry) => entry !== 'n/a').join(',');
  return {
    runId: `git-boundary-${sanitizeRunId(run.remoteRef)}-${localHead.slice(0, 12) || 'unknown'}`,
    planId: taskId,
    scenario: typeof run.branch === 'string' && run.branch.trim() ? run.branch.trim() : 'field',
    tasks: taskId,
    actors: [run.actorId, typeof run.remoteVirtualActorId === 'string' ? run.remoteVirtualActorId : ''].filter(Boolean).join(','),
    files: toCsv(new Set(Array.isArray(run.targetFiles) ? run.targetFiles.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [])),
    vendor: 'git-boundary-admission',
    lane: typeof run.lane === 'string' && run.lane.trim() ? run.lane.trim() : 'n/a',
    verdict: [run.outcome, run.verdict].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).join(':') || 'n/a',
    commits: toCsv(new Set([typeof run.baseCommit === 'string' ? run.baseCommit : '', localHead, remoteHead].filter(Boolean))),
    transactions: typeof run.recommendation === 'string' && run.recommendation.trim() ? run.recommendation.trim() : 'n/a',
    identities: identities || 'n/a',
    evidence: runSource.replace(/\\/g, '/')
  };
}

export function summarizeTeamRun(run: TeamRun, runSource: string): BrokerRunSummary | null {
  if (typeof run.teamRunId !== 'string' || !run.teamRunId) {
    return null;
  }

  const brokerLane = run.brokerLane;
  const brokerLaneObject = brokerLane && typeof brokerLane === 'object'
    ? brokerLane as Record<string, unknown>
    : null;
  const rearbitration = brokerLaneObject?.rearbitration && typeof brokerLaneObject.rearbitration === 'object'
    ? brokerLaneObject.rearbitration as Record<string, unknown>
    : null;
  const writeIntent = brokerLaneObject?.writeIntent;
  const writeTransaction = brokerLaneObject?.writeTransaction;
  const decision = (rearbitration?.effectiveDecision && typeof rearbitration.effectiveDecision === 'object'
    ? rearbitration.effectiveDecision
    : brokerLaneObject?.decision) as Record<string, unknown> | undefined;
  const identities = new Set<string>();
  const actors = new Set<string>();
  const files = new Set<string>();
  const tasks = new Set<string>();
  const commits = new Set<string>();
  const tx = new Set<string>();
  const scenarios = new Set<string>();

  addStringValue(tasks, run.taskId);
  addStringValue(actors, run.actorId);
  addStringValue(identities, run.planId);

  collectObjectStringsByKey(writeIntent, new Set(['request_identity', 'requestIdentity', 'requestId', 'planId']), identities);
  collectObjectStringsByKey(writeIntent, new Set(['taskId', 'task_ids', 'taskIds']), tasks);
  collectObjectStringsByKey(writeIntent, new Set(['actorId', 'actor_ids', 'actorIds']), actors);
  collectObjectStringsByKey(writeIntent, new Set([
    'file',
    'filePath',
    'files',
    'request_files',
    'requestFiles',
    'applied_files',
    'appliedFiles',
    'readSet',
    'writeSet',
    'scopePaths',
    'sharedFiles',
    'targetFiles'
  ]), files);
  collectObjectStringsByKey(writeIntent, new Set(['baseCommit', 'baseHead', 'baseHash', 'commit', 'commit_sha']), commits);
  collectObjectStringsByKey(decision, new Set(['intentId', 'transactionId', 'transaction_ids', 'transactionIds', 'writeTransactionId']), tx);
  collectObjectStringsByKey(writeTransaction, new Set(['intentId', 'transactionId', 'transaction_ids', 'transactionIds', 'writeTransactionId']), tx);

  for (const identity of identities) {
    const split = collectTags(identity);
    split.scenarios.forEach((value) => scenarios.add(value));
    split.tasks.forEach((value) => tasks.add(value));
  }

  const admissionState = deriveAdmissionStateFromBrokerLane(brokerLane);
  const rawLane = firstStringByKey(rearbitration ?? decision ?? brokerLane, new Set(['effectiveChosenLane', 'chosenLane', 'lane', 'lane_decision'])) ?? 'team-broker-lane';
  const rawVerdict = firstStringByKey(decision ?? brokerLane, new Set(['verdict', 'merge_verdict'])) ?? 'recorded';
  const lane = admissionState && admissionState !== 'not-required'
    ? `${rawLane}:${admissionState}`
    : rawLane;
  const verdict = admissionState && admissionState !== 'not-required'
    ? `${rawVerdict}:${admissionState}`
    : rawVerdict;

  return {
    runId: run.teamRunId,
    planId: run.taskId ?? run.planId ?? 'unknown',
    scenario: [...scenarios].sort().join(',') || 'field',
    tasks: toCsv(tasks),
    actors: toCsv(actors),
    files: toCsv(new Set(files)),
    vendor: 'team-broker-lane',
    lane,
    verdict,
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: runSource.replace(/\\/g, '/')
  };
}

