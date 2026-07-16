import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrokerEnvelope, BrokerExperimentRun, BrokerRunSummary, RunSource, TaskArtifactSummary, TeamRun } from './types.ts';
import { addStringValue, collectObjectStringsByKey, collectTags, collectTagsFromExperiment, deriveAdmissionStateFromBrokerLane, firstStringByKey, toCsv, uniq } from './summary-utils.ts';

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

  const missingFields = new Set<string>();

  for (const record of records) {
    const requestIdentities = uniq(record.request_identity);
    if (requestIdentities.size > 0) {
      for (const requestIdentity of requestIdentities) {
        identities.add(requestIdentity);
        const split = collectTags(requestIdentity);
        split.scenarios.forEach((value) => scenarios.add(value));
        split.tasks.forEach((value) => tasks.add(value));
      }
    } else {
      missingFields.add('request_identity');
    }

    const actorIds = uniq(record.actor_ids);
    if (actorIds.size > 0) {
      for (const actorId of actorIds) {
        actors.add(actorId);
      }
    } else {
      missingFields.add('actor_ids');
    }

    const requestFiles = uniq(record.request_files);
    for (const file of requestFiles) {
      files.add(file);
    }

    const appliedFiles = uniq(record.applied_files);
    for (const file of appliedFiles) {
      files.add(file);
    }

    if (requestFiles.size === 0 && appliedFiles.size === 0) {
      missingFields.add('request_files');
    }

    const taskIds = uniq(record.task_ids);
    for (const taskId of taskIds) {
      tasks.add(taskId);
    }

    const adapterChoice = (record.adapter_choice ?? '').trim();
    if (adapterChoice) {
      adapters.add(adapterChoice);
    } else {
      missingFields.add('adapter_choice');
    }

    const laneDecision = (record.lane_decision ?? '').trim();
    if (laneDecision) {
      lanes.add(laneDecision);
    } else {
      missingFields.add('lane_decision');
    }

    const mergeVerdict = (record.merge_verdict ?? '').trim();
    if (mergeVerdict) {
      verdicts.add(mergeVerdict);
    } else {
      missingFields.add('merge_verdict');
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
    files: toCsv(files),
    vendor: [...adapters].length === 1 ? [...adapters][0]! : toCsv(adapters),
    lane: [...lanes].length === 1 ? [...lanes][0]! : toCsv(lanes),
    verdict: [...verdicts].length === 1 ? [...verdicts][0]! : toCsv(verdicts),
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: evidenceValue,
    requiredFields: [...missingFields]
  };
}

export function summarizeExperimentRun(run: BrokerExperimentRun, runSource: string): BrokerRunSummary | null {
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
  const missingFields = new Set<string>();

  for (const mutation of mutations) {
    if (mutation.requestId) {
      identities.add(mutation.requestId);
      const split = collectTagsFromExperiment(mutation.requestId);
      split.scenarios.forEach((value) => scenarios.add(value));
      split.tasks.forEach((value) => tasks.add(value));
    } else {
      missingFields.add('request_identity');
    }

    if (mutation.actorId) {
      actors.add(mutation.actorId);
    } else {
      missingFields.add('actor_ids');
    }

    if (mutation.filePath) {
      files.add(mutation.filePath);
    }

    if (mutation.filePath === undefined) {
      missingFields.add('request_files');
    }

    if (mutation.adapterId) {
      vendors.add(mutation.adapterId);
    } else {
      missingFields.add('adapter_choice');
    }

    if (mutation.mergeDecision) {
      lanes.add(mutation.mergeDecision);
    } else {
      missingFields.add('lane_decision');
    }

    if (mutation.verdict) {
      verdicts.add(mutation.verdict);
    } else {
      missingFields.add('merge_verdict');
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

  const evidenceValue = typeof run.runEvidencePath === 'string' ? run.runEvidencePath : runSource;

  return {
    runId: run.runId,
    planId: run.plan?.planId ?? 'unknown',
    scenario: [...scenarios].sort().join(',') || 'field',
    tasks: toCsv(tasks),
    actors: toCsv(actors),
    files: toCsv(files),
    vendor: [...vendors].length === 1 ? [...vendors][0]! : toCsv(vendors),
    lane: [...lanes].length === 1 ? [...lanes][0]! : toCsv(lanes),
    verdict: [...verdicts].length === 1 ? [...verdicts][0]! : toCsv(verdicts),
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: evidenceValue,
    requiredFields: [...missingFields]
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

export function parseRunFile(filePath: string, runSource: RunSource): BrokerRunSummary | null {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (isBrokerEnvelope(raw)) {
    return summarizeEnvelopeRecord(raw, runSource.filePath);
  }
  if (isBrokerExperimentRun(raw)) {
    return summarizeExperimentRun(raw, runSource.filePath);
  }
  return null;
}

export function isTeamRun(value: unknown): value is TeamRun {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybe = value as TeamRun;
  return maybe.schemaId === 'atm.teamRun.v1' && typeof maybe.teamRunId === 'string';
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
    files: toCsv(files),
    vendor: 'team-broker-lane',
    lane,
    verdict,
    commits: toCsv(commits),
    transactions: toCsv(tx),
    identities: toCsv(identities),
    evidence: runSource.replace(/\\/g, '/'),
    requiredFields: []
  };
}

export function readRunSummaries(runDir: string): BrokerRunSummary[] {
  if (!existsSync(runDir)) {
    return [];
  }
  const runEntries = readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(runDir, entry.name))
    .sort();

  const rows: BrokerRunSummary[] = [];
  const seen = new Set<string>();

  for (const filePath of runEntries) {
    try {
      const summary = parseRunFile(filePath, { filePath });
      if (!summary || seen.has(summary.runId)) {
        continue;
      }
      seen.add(summary.runId);
      rows.push(summary);
    } catch {
      // skip invalid run file
    }
  }

  return rows;
}

export function readTeamRunSummaries(teamRunDirs: readonly string[]): BrokerRunSummary[] {
  const rows: BrokerRunSummary[] = [];
  const seen = new Set<string>();
  for (const teamRunDir of teamRunDirs) {
    if (!existsSync(teamRunDir)) {
      continue;
    }
    const entries = listActiveTeamRunFiles(teamRunDir);
    for (const filePath of entries) {
      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
        if (!isTeamRun(raw)) {
          continue;
        }
        const summary = summarizeTeamRun(raw, filePath);
        if (!summary || seen.has(summary.runId)) {
          continue;
        }
        seen.add(summary.runId);
        rows.push(summary);
      } catch {
        // skip invalid team run file
      }
    }
  }
  return rows;
}

export function listActiveTeamRunFiles(teamRunDir: string): string[] {
  if (!existsSync(teamRunDir)) {
    return [];
  }
  return readdirSync(teamRunDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(teamRunDir, entry.name))
    .sort();
}

export function collectTaskArtifacts(atmRoot: string, taskIds: string[], teamRunDirs: readonly string[]): TaskArtifactSummary[] {
  const closureSet = new Set<string>();
  const normalizedTaskIds = taskIds
    .filter((taskId) => taskId.startsWith('TASK-'))
    .sort((left, right) => left.localeCompare(right));

  if (normalizedTaskIds.length === 0) {
    return [];
  }

  const evidenceDir = path.join(atmRoot, '.atm', 'history', 'evidence');
  if (existsSync(evidenceDir)) {
    for (const fileName of readdirSync(evidenceDir)) {
      if (!fileName.endsWith('.closure-packet.json')) {
        continue;
      }
      const task = fileName.replace(/\.closure-packet\.json$/, '');
      if (task.startsWith('TASK-')) {
        closureSet.add(task);
      }
    }
  }

  const teamRunsByTask: Record<string, string[]> = {};
  const candidateTeamRunDirs = teamRunDirs.length > 0 ? teamRunDirs : [path.join(atmRoot, '.atm', 'runtime', 'team-runs')];
  for (const teamRunDir of candidateTeamRunDirs) {
    if (!existsSync(teamRunDir)) {
      continue;
    }
    for (const filePath of listActiveTeamRunFiles(teamRunDir)) {
      try {
        const run = JSON.parse(readFileSync(filePath, 'utf8')) as { taskId?: unknown };
        const taskId = typeof run.taskId === 'string' ? run.taskId : null;
        if (!taskId || !taskId.startsWith('TASK-')) {
          continue;
        }
        teamRunsByTask[taskId] ??= [];
        teamRunsByTask[taskId].push(filePath.replace(/\\/g, '/'));
      } catch {
        // ignore malformed team run file
      }
    }
  }

  return normalizedTaskIds.map((taskId) => ({
    taskId,
    closurePacket: closureSet.has(taskId) ? `.atm/history/evidence/${taskId}.closure-packet.json` : 'n/a',
    teamRuns: (teamRunsByTask[taskId] ?? ['n/a']).join(';')
  }));
}


