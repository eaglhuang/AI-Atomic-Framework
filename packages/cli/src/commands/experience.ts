import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BehaviorRegistry } from '../../../plugin-sdk/src/behavior-registry.ts';
import {
  type ExperienceHumanReviewProposalSnapshot,
  type SkillCandidate,
  registerExperienceLoopBehaviors
} from '../../../plugin-experience-loop/src/index.ts';
import { createReviewAdvisoryReport } from '../../../plugin-review-advisory/src/index.ts';
import {
  createHumanReviewQueueDocument,
  createHumanReviewQueueRecord,
  loadHumanReviewQueueDocument,
  renderHumanReviewQueueMarkdown,
  validateHumanReviewQueueDocument,
  writeHumanReviewQueueDocument
} from '../../../plugin-human-review/src/index.ts';
import { CliError, makeResult, message, readJsonFile, relativePathFrom } from './shared.ts';

export async function runExperience(argv: string[]) {
  const { action, options } = parseExperienceOptions(argv);
  if (action !== 'extract') {
    throw new CliError('ATM_CLI_USAGE', `experience supports action extract, got ${action || '<missing>'}`, { exitCode: 2 });
  }

  const inputPath = path.resolve(options.cwd, options.inputPath);
  const rawInput = readJsonFile(inputPath, 'ATM_EXPERIENCE_INPUT_NOT_FOUND');
  const input = normalizeExtractionInput(rawInput, options.fromTask);
  const registry = new BehaviorRegistry();
  registerExperienceLoopBehaviors(registry);
  const behaviorOutput = await registry.executeGuarded({ repositoryRoot: options.cwd }, {
    entryType: 'atom',
    atomId: 'ATM-EXP-0001',
    action: 'experience.extract-skill',
    requestedBy: options.requestedBy,
    payload: input as unknown as Record<string, unknown>
  });
  const behaviorDetails = (behaviorOutput.evidence[0]?.details ?? {}) as Record<string, unknown>;
  const candidate = behaviorDetails.skillCandidate as SkillCandidate | undefined;
  const proposalSnapshot = behaviorDetails.proposalSnapshot as ExperienceHumanReviewProposalSnapshot | undefined;
  if (!candidate || !proposalSnapshot) {
    throw new CliError('ATM_EXPERIENCE_BEHAVIOR_INVALID', 'Experience behavior did not emit a skill candidate and proposal snapshot.', {
      details: { issues: behaviorOutput.issues }
    });
  }
  const report = {
    ok: behaviorOutput.ok,
    candidate,
    threshold: behaviorDetails.threshold,
    messages: behaviorOutput.issues.length > 0 ? behaviorOutput.issues : ['Skill candidate crossed the extraction threshold.']
  };
  const advisoryReport = createExperienceAdvisoryReport(candidate, proposalSnapshot, behaviorOutput.ok, inputPath, options.cwd);
  const outputPath = options.outputPath ? path.resolve(options.cwd, options.outputPath) : null;
  const advisoryOutputPath = options.advisoryOutputPath ? path.resolve(options.cwd, options.advisoryOutputPath) : null;
  const queueResult = options.queuePath
    ? enqueueExperienceProposal(options.cwd, options.queuePath, options.projectionPath, proposalSnapshot)
    : null;

  if (outputPath) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  }
  if (advisoryOutputPath) {
    mkdirSync(path.dirname(advisoryOutputPath), { recursive: true });
    writeFileSync(advisoryOutputPath, `${JSON.stringify(advisoryReport, null, 2)}\n`, 'utf8');
  }

  return makeResult({
    ok: true,
    command: 'experience',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_EXPERIENCE_EXTRACT_OK', 'Experience extraction completed.', {
        crossedThreshold: report.ok,
        threshold: report.threshold,
        confidence: candidate.confidence
      })
    ],
    evidence: {
      action,
      inputPath: relativePathFrom(options.cwd, inputPath),
      outputPath: outputPath ? relativePathFrom(options.cwd, outputPath) : null,
      advisoryOutputPath: advisoryOutputPath ? relativePathFrom(options.cwd, advisoryOutputPath) : null,
      queue: queueResult,
      behaviorOutput,
      advisoryReport,
      report
    }
  });
}

function parseExperienceOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    fromTask: '',
    inputPath: '',
    outputPath: '',
    advisoryOutputPath: '',
    queuePath: '',
    projectionPath: '',
    requestedBy: process.env.AGENT_IDENTITY || 'atm-cli'
  };
  let action = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--from-task') {
      options.fromTask = requireOptionValue(argv, index, '--from-task');
      index += 1;
      continue;
    }
    if (arg === '--input') {
      options.inputPath = requireOptionValue(argv, index, '--input');
      index += 1;
      continue;
    }
    if (arg === '--out') {
      options.outputPath = requireOptionValue(argv, index, '--out');
      index += 1;
      continue;
    }
    if (arg === '--advisory-out') {
      options.advisoryOutputPath = requireOptionValue(argv, index, '--advisory-out');
      index += 1;
      continue;
    }
    if (arg === '--queue') {
      options.queuePath = requireOptionValue(argv, index, '--queue');
      index += 1;
      continue;
    }
    if (arg === '--projection') {
      options.projectionPath = requireOptionValue(argv, index, '--projection');
      index += 1;
      continue;
    }
    if (arg === '--by') {
      options.requestedBy = requireOptionValue(argv, index, '--by');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `experience does not support option ${arg}`, { exitCode: 2 });
    }
    if (!action) {
      action = arg;
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `experience received unexpected argument ${arg}`, { exitCode: 2 });
  }

  if (!options.inputPath) {
    throw new CliError('ATM_CLI_USAGE', 'experience extract requires --input <path>', { exitCode: 2 });
  }

  return {
    action,
    options: {
      ...options,
      cwd: path.resolve(options.cwd)
    }
  };
}

function normalizeExtractionInput(rawInput: unknown, fromTaskOverride: string) {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new CliError('ATM_EXPERIENCE_INPUT_INVALID', 'Experience input must be a JSON object.');
  }
  const inputRecord = rawInput as Record<string, unknown>;
  const sourceTaskId = fromTaskOverride || String(inputRecord.sourceTaskId ?? inputRecord.taskId ?? '').trim();
  if (!sourceTaskId) {
    throw new CliError('ATM_EXPERIENCE_INPUT_INVALID', 'Experience input requires sourceTaskId or --from-task.');
  }
  const evidence = Array.isArray(inputRecord.evidence) ? inputRecord.evidence : [];
  return {
    sourceTaskId,
    evidence: evidence as unknown[],
    contextSummary: typeof inputRecord.contextSummary === 'string' || typeof inputRecord.contextSummary === 'object'
      ? inputRecord.contextSummary as string | Record<string, unknown>
      : undefined,
    diffSummary: typeof inputRecord.diffSummary === 'string' ? inputRecord.diffSummary : undefined,
    proposedName: typeof inputRecord.proposedName === 'string' ? inputRecord.proposedName : undefined,
    proposedApplyTo: Array.isArray(inputRecord.proposedApplyTo) ? inputRecord.proposedApplyTo.map((entry) => String(entry)) : undefined
  };
}

function createExperienceAdvisoryReport(
  candidate: SkillCandidate,
  proposalSnapshot: ExperienceHumanReviewProposalSnapshot,
  crossedThreshold: boolean,
  inputPath: string,
  cwd: string
) {
  return createReviewAdvisoryReport({
    reportId: `experience-advisory.${candidate.id}`,
    status: 'warn',
    provider: {
      mode: 'stub',
      providerId: 'experience-loop-policy',
      providerVersion: '0.1.0',
      transport: 'inproc'
    },
    target: {
      kind: 'proposal',
      id: proposalSnapshot.proposalId,
      sourcePaths: [relativePathFrom(cwd, inputPath)]
    },
    findings: [
      {
        id: `finding.experience.${candidate.id}`,
        severity: crossedThreshold ? 'medium' : 'high',
        trigger: 'policy-coverage-gap',
        scope: 'proposal',
        action: 'request-human-review',
        routeHint: 'human-review.required',
        message: crossedThreshold
          ? 'Experience-loop candidate crossed the extraction threshold and must enter human review before promotion.'
          : 'Experience-loop candidate stayed below threshold and requires human review before any promotion attempt.',
        evidenceRefs: [...candidate.evidenceRefs],
        metadata: {
          proposalId: proposalSnapshot.proposalId,
          confidence: candidate.confidence,
          patternTags: candidate.patternTags
        }
      }
    ]
  });
}

function enqueueExperienceProposal(
  cwd: string,
  queuePathInput: string,
  projectionPathInput: string,
  proposalSnapshot: ExperienceHumanReviewProposalSnapshot
) {
  const queuePath = path.resolve(cwd, queuePathInput);
  const projectionPath = path.resolve(cwd, projectionPathInput || queuePathInput.replace(/\.json$/i, '.md'));
  const existingDocument = loadHumanReviewQueueDocument(queuePath);
  const nextRecord = createHumanReviewQueueRecord(proposalSnapshot as unknown as Record<string, unknown>);
  const priorEntries = existingDocument?.entries ?? [];
  const nextDocument = createHumanReviewQueueDocument([
    ...priorEntries.filter((entry) => entry.proposalId !== nextRecord.proposalId),
    nextRecord
  ]);
  const validation = validateHumanReviewQueueDocument(nextDocument);
  if (!validation.ok) {
    throw new CliError('ATM_EXPERIENCE_QUEUE_INVALID', 'Generated experience review queue record is invalid.', {
      details: { issues: validation.issues }
    });
  }
  writeHumanReviewQueueDocument(queuePath, nextDocument);
  mkdirSync(path.dirname(projectionPath), { recursive: true });
  writeFileSync(projectionPath, renderHumanReviewQueueMarkdown(nextDocument), 'utf8');
  return {
    queuePath: relativePathFrom(cwd, queuePath),
    projectionPath: relativePathFrom(cwd, projectionPath),
    proposalId: nextRecord.proposalId,
    status: nextRecord.status
  };
}

function requireOptionValue(argv: string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `experience requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
