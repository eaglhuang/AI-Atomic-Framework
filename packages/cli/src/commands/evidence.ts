import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { resolveActorId } from './actor-registry.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.ts';
import {
  generateDiffEvidence,
  mergeDiffEvidenceWithExisting,
  validateDiffEvidence
} from '../../../core/src/evidence/diff-evidence.ts';

export type EvidenceGate = 'close' | 'commit' | 'pr';
type CanonicalEvidenceKind = 'test' | 'artifact' | 'attestation' | 'review' | 'commit' | 'waiver' | 'other';
type EvidenceFreshness = 'fresh' | 'historical-reference' | 'draft';

interface CanonicalEvidenceRecord {
  readonly kind: CanonicalEvidenceKind;
  readonly summary: string;
  readonly producedBy: string | null;
  readonly artifactPaths: readonly string[];
  readonly createdAt: string | null;
  readonly freshness: EvidenceFreshness;
  readonly hasCommandRunProof: boolean;
}

interface EvidenceEnvelope {
  readonly taskId: string;
  readonly updatedAt: string;
  readonly evidence: readonly Record<string, unknown>[];
}

interface CommandRunEvidenceInput {
  readonly command: string;
  readonly cwd?: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly validators?: readonly string[];
  readonly cached?: boolean;
  readonly cacheKey?: string;
  readonly runnerKind?: string;
  readonly sourceCommit?: string;
  readonly runnerVersion?: string;
  readonly generatedAt?: string;
}

export interface EvidenceGateResult {
  readonly ok: boolean;
  readonly gate: EvidenceGate;
  readonly total: number;
  readonly counts: Readonly<Record<CanonicalEvidenceKind, number>>;
  readonly freshCount: number;
  readonly commandRunEvidenceCount: number;
  readonly reopenedRedteamTask: boolean;
  readonly codeOrFrameworkTask: boolean;
  readonly missing: readonly string[];
}

export async function runEvidence(argv: string[]) {
  const action = (argv[0] ?? '').toLowerCase();
  if (action === 'add') {
    return runEvidenceAdd(argv.slice(1));
  }
  if (action === 'git-head-backfill') {
    return runGitHeadEvidenceBackfill(argv.slice(1));
  }
  if (action === 'verify') {
    return runEvidenceVerify(argv.slice(1));
  }
  if (action === 'diff') {
    return runEvidenceDiff(argv.slice(1));
  }
  throw new CliError('ATM_CLI_USAGE', 'evidence supports: add, git-head-backfill, verify, diff', { exitCode: 2 });
}

function runEvidenceDiff(argv: string[]) {
  const cwd = process.cwd();
  let taskId: string | undefined;
  let staged = false;
  let from: string | undefined;
  let to: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--task' || arg === '-t') && argv[i + 1]) {
      taskId = argv[++i];
    } else if (arg === '--staged') {
      staged = true;
    } else if (arg === '--from' && argv[i + 1]) {
      from = argv[++i];
    } else if (arg === '--to' && argv[i + 1]) {
      to = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      outputPath = argv[++i];
    }
  }

  if (!taskId) {
    throw new CliError('ATM_CLI_USAGE', 'evidence diff requires --task <taskId>', { exitCode: 2 });
  }

  const draft = generateDiffEvidence({ taskId, repositoryRoot: cwd, staged, from, to });

  // Merge with existing if output file already has human-written fields
  const resolvedOutput = outputPath ? path.resolve(cwd, outputPath) : null;
  let finalDraft = draft;
  if (resolvedOutput && existsSync(resolvedOutput)) {
    try {
      const existing = JSON.parse(readFileSync(resolvedOutput, 'utf-8'));
      if (existing.evidenceType === 'diff-as-evidence' && existing.taskId === taskId) {
        finalDraft = mergeDiffEvidenceWithExisting(existing, draft);
      }
    } catch {
      // ignore; use fresh draft
    }
  }

  const validation = validateDiffEvidence(finalDraft);
  finalDraft._isValid = validation.valid;

  if (resolvedOutput) {
    mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    writeFileSync(resolvedOutput, JSON.stringify(finalDraft, null, 2) + '\n');
  }

  return makeResult({
    ok: true,
    command: 'evidence',
    cwd,
    messages: [
      message('info', 'ATM_EVIDENCE_DIFF_GENERATED',
        `Diff evidence draft generated for ${taskId}. ${finalDraft._isValid ? 'Ready to submit.' : 'Fill in intent/impact/testCoverage to validate.'}`,
        {
          taskId,
          changedFiles: finalDraft.changedFiles.length,
          linesAdded: finalDraft.linesAdded,
          linesDeleted: finalDraft.linesDeleted,
          affectedAtoms: finalDraft.affectedAtoms.length,
          isValid: finalDraft._isValid,
          validationReasons: validation.reasons,
          writtenTo: resolvedOutput ?? null
        }
      )
    ],
    evidence: { draft: finalDraft }
  });
}

export function verifyTaskEvidence(input: {
  cwd: string;
  taskId: string;
  gate: EvidenceGate;
  taskDocument?: Record<string, unknown> | null;
  taskDeclaredFiles?: readonly string[];
  frameworkTask?: boolean;
}): EvidenceGateResult {
  const bundle = readEvidenceBundle(input.cwd, input.taskId);
  const canonical = bundle.evidence.map((entry) => canonicalizeEvidenceRecord(entry));
  const counts: Record<CanonicalEvidenceKind, number> = {
    test: 0,
    artifact: 0,
    attestation: 0,
    review: 0,
    commit: 0,
    waiver: 0,
    other: 0
  };
  for (const record of canonical) {
    counts[record.kind] += 1;
  }

  const nonWaiver = canonical.filter((record) => record.kind !== 'waiver').length;
  const freshCount = canonical.filter((record) => record.freshness === 'fresh').length;
  const commandRunEvidenceCount = canonical.filter((record) => record.hasCommandRunProof).length;
  const verificationCount = counts.test + counts.artifact + counts.attestation + counts.commit;
  const reopenedRedteamTask = detectReopenedOrRedteamTask(input.taskDocument);
  const codeOrFrameworkTask = Boolean(input.frameworkTask) || detectCodeOrFrameworkTask(input.taskDocument, input.taskDeclaredFiles ?? []);
  const missing: string[] = [];
  if (input.gate === 'close') {
    if (nonWaiver <= 0) {
      missing.push('at-least-one-non-waiver-evidence');
    }
    if (reopenedRedteamTask && freshCount <= 0) {
      missing.push('fresh-evidence-required');
    }
    if (codeOrFrameworkTask && counts.artifact === nonWaiver) {
      missing.push('artifact-only-evidence-not-allowed');
    }
    if (codeOrFrameworkTask && (counts.test + counts.commit + counts.attestation + commandRunEvidenceCount) <= 0) {
      missing.push('code-or-framework-runnable-evidence');
    }
  } else if (input.gate === 'commit') {
    if (nonWaiver <= 0) {
      missing.push('at-least-one-non-waiver-evidence');
    }
    if (verificationCount <= 0) {
      missing.push('commit-or-verification-evidence');
    }
  } else {
    if (counts.review <= 0) {
      missing.push('review-evidence');
    }
    if (verificationCount <= 0) {
      missing.push('verification-evidence');
    }
  }

  return {
    ok: missing.length === 0,
    gate: input.gate,
    total: canonical.length,
    counts,
    freshCount,
    commandRunEvidenceCount,
    reopenedRedteamTask,
    codeOrFrameworkTask,
    missing
  };
}

function runEvidenceAdd(argv: string[]) {
  const options = parseEvidenceAddOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'evidence add requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const evidencePath = evidencePathForTask(options.cwd, options.taskId);
  const bundle = readEvidenceBundle(options.cwd, options.taskId);
  const nowIso = new Date().toISOString();
  const kind = normalizeEvidenceKind(options.kind);
  const commandRuns = normalizeEvidenceCommandRuns({
    cwd: options.cwd,
    inlineRun: options.commandRun,
    fileRuns: options.commandRuns,
    runnerKind: options.runnerKind,
    sourceCommit: options.sourceCommit
  });
  const validationPasses = uniqueStrings([
    ...options.validators,
    ...commandRuns.flatMap((run) => Array.isArray(run.validators) ? run.validators : [])
  ]);
  const failedValidationRuns = commandRuns.filter((run) => run.exitCode !== 0 && (
    validationPasses.length > 0 || (Array.isArray(run.validators) && run.validators.length > 0)
  ));
  if (failedValidationRuns.length > 0) {
    throw new CliError(
      'ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND',
      'evidence add refused to record validationPasses from commandRuns with non-zero exitCode.',
      {
        exitCode: 2,
        details: {
          taskId: options.taskId,
          failedCommands: failedValidationRuns.map((run) => ({
            command: run.command,
            exitCode: run.exitCode,
            validators: run.validators ?? []
          })),
          remediation: 'Record failed commands as failure diagnostics, or rerun the validator successfully before adding validation pass evidence.'
        }
      }
    );
  }
  const commandRunCache = commandRuns.length > 0
    ? {
      schemaId: 'atm.commandRunCache.v1',
      cacheKey: hashJson({
        taskId: options.taskId,
        commandRuns: commandRuns.map((run) => ({
          command: run.command,
          cwd: run.cwd ?? '.',
          exitCode: run.exitCode,
          stdoutSha256: run.stdoutSha256,
          stderrSha256: run.stderrSha256,
          runnerKind: run.runnerKind ?? null,
          sourceCommit: run.sourceCommit ?? null
        }))
      }),
      reusedRunCount: commandRuns.filter((run) => run.cached === true).length,
      runCount: commandRuns.length,
      sourcePath: options.commandRunsPath ? normalizeRelativePath(relativePathFrom(options.cwd, options.commandRunsPath)) : null
    }
    : null;
  const evidenceRecord: Record<string, unknown> = {
    evidenceKind: kind === 'waiver' ? 'waiver' : 'validation',
    evidenceType: kind,
    summary: options.summary ?? `${kind} evidence for ${options.taskId}.`,
    artifactPaths: options.artifacts,
    evidenceFreshness: options.freshness,
    producedBy: actorId,
    createdAt: nowIso,
    details: {
      actorId,
      kind,
      freshness: options.freshness,
      ...(validationPasses.length > 0 ? { validationPasses } : {}),
      ...(commandRuns.length > 0 ? { commandRuns } : {}),
      ...(commandRunCache ? { commandRunCache } : {})
    }
  };
  const nextEvidence = [...bundle.evidence, evidenceRecord];
  const envelope: EvidenceEnvelope = {
    taskId: options.taskId,
    updatedAt: nowIso,
    evidence: nextEvidence
  };
  writeEvidenceEnvelope(evidencePath, envelope);
  return makeResult({
    ok: true,
    command: 'evidence',
    cwd: options.cwd,
    messages: [message('info', 'ATM_EVIDENCE_ADDED', `Added ${kind} evidence for ${options.taskId}.`, {
      taskId: options.taskId,
      actorId,
      kind
    })],
    evidence: {
      action: 'add',
      taskId: options.taskId,
      actorId,
      kind,
      freshness: options.freshness,
      evidencePath: relativePathFrom(options.cwd, evidencePath),
      evidenceCount: nextEvidence.length,
      commandRunCount: commandRuns.length,
      commandRunCache
    }
  });
}

function runEvidenceVerify(argv: string[]) {
  const options = parseEvidenceVerifyOptions(argv);
  const taskDocument = readTaskDocument(options.cwd, options.taskId);
  const result = verifyTaskEvidence({
    cwd: options.cwd,
    taskId: options.taskId,
    gate: options.gate,
    taskDocument,
    taskDeclaredFiles: extractTaskDeclaredFiles(taskDocument),
    frameworkTask: false
  });
  return makeResult({
    ok: result.ok,
    command: 'evidence',
    cwd: options.cwd,
    messages: [result.ok
      ? message('info', 'ATM_EVIDENCE_VERIFY_OK', `Evidence gate ${result.gate} passed for ${options.taskId}.`, {
        taskId: options.taskId,
        gate: result.gate
      })
      : message('error', 'ATM_EVIDENCE_VERIFY_FAILED', `Evidence gate ${result.gate} failed for ${options.taskId}.`, {
        taskId: options.taskId,
        gate: result.gate,
        missing: result.missing
      })],
    evidence: {
      action: 'verify',
      taskId: options.taskId,
    gate: result.gate,
    total: result.total,
    counts: result.counts,
    freshCount: result.freshCount,
    commandRunEvidenceCount: result.commandRunEvidenceCount,
    reopenedRedteamTask: result.reopenedRedteamTask,
    codeOrFrameworkTask: result.codeOrFrameworkTask,
    missing: result.missing,
    evidencePath: relativePathFrom(options.cwd, evidencePathForTask(options.cwd, options.taskId))
  }
  });
}

function runGitHeadEvidenceBackfill(argv: string[]) {
  const options = parseGitHeadBackfillOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'evidence git-head-backfill requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const head = runGitScalar(options.cwd, ['rev-parse', '--verify', 'HEAD']);
  if (!head) {
    throw new CliError('ATM_GIT_HEAD_MISSING', 'evidence git-head-backfill requires an existing HEAD commit.', { exitCode: 2 });
  }
  const treeSha = readGovernedCommitTreeWithoutEvidence(options.cwd, head) ?? runGitScalar(options.cwd, ['rev-parse', `${head}^{tree}`]);
  if (!treeSha) {
    throw new CliError('ATM_GIT_TREE_MISSING', 'ATM could not resolve the HEAD tree for git-head evidence backfill.', { exitCode: 2 });
  }
  const nowIso = new Date().toISOString();
  const evidenceAbsolute = path.join(options.cwd, '.atm', 'history', 'evidence', 'git-head.json');
  const payload = {
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'commit',
        summary: options.summary ?? 'Git HEAD is covered by ATM git-head backfill evidence.',
        artifactPaths: [],
        createdAt: nowIso,
        producedBy: actorId,
        evidenceFreshness: 'fresh',
        commandRuns: [],
        details: {
          actorId,
          kind: 'commit',
          freshness: 'fresh',
          git: {
            commitSha: head,
            treeSha,
            parentCommitShas: [head],
            stagedPathCount: 1,
            evidencePath: normalizeRelativePath(relativePathFrom(options.cwd, evidenceAbsolute)),
            generatedAt: nowIso
          },
          backfill: {
            mode: 'head-commit-evidence',
            coveredCommitSha: head,
            reason: options.reason ?? 'Backfill git-head evidence for an existing HEAD commit.'
          }
        }
      }
    ]
  };
  mkdirSync(path.dirname(evidenceAbsolute), { recursive: true });
  writeFileSync(evidenceAbsolute, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const addResult = runGitCommand(options.cwd, ['add', '--', normalizeRelativePath(relativePathFrom(options.cwd, evidenceAbsolute))]);
  if (!addResult.ok) {
    throw new CliError('ATM_GIT_ADD_FAILED', 'ATM wrote git-head backfill evidence but could not stage it.', {
      exitCode: 1,
      details: {
        stderr: addResult.stderr || addResult.stdout
      }
    });
  }
  return makeResult({
    ok: true,
    command: 'evidence',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_GIT_HEAD_EVIDENCE_BACKFILLED', 'ATM wrote git-head evidence for the current HEAD. Commit the staged evidence file as the next commit.', {
        actorId,
        commitSha: head,
        treeSha,
        evidencePath: normalizeRelativePath(relativePathFrom(options.cwd, evidenceAbsolute))
      })
    ],
    evidence: {
      action: 'git-head-backfill',
      actorId,
      commitSha: head,
      treeSha,
      evidencePath: normalizeRelativePath(relativePathFrom(options.cwd, evidenceAbsolute))
    }
  });
}

function parseEvidenceAddOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    kind: '',
    summary: null as string | null,
    artifacts: [] as string[],
    freshness: 'fresh' as EvidenceFreshness,
    validators: [] as string[],
    commandRun: null as null | CommandRunEvidenceInput,
    commandRuns: [] as CommandRunEvidenceInput[],
    commandRunsPath: null as string | null,
    commandRunsInputPath: null as string | null,
    runnerKind: null as string | null,
    sourceCommit: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--kind') {
      options.kind = requireValue(argv, index, '--kind');
      index += 1;
      continue;
    }
    if (arg === '--summary') {
      options.summary = requireValue(argv, index, '--summary');
      index += 1;
      continue;
    }
    if (arg === '--artifacts') {
      options.artifacts = requireValue(argv, index, '--artifacts').split(',').map((entry) => normalizeRelativePath(entry)).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--freshness') {
      options.freshness = normalizeEvidenceFreshness(requireValue(argv, index, '--freshness'));
      index += 1;
      continue;
    }
    if (arg === '--validators') {
      options.validators = requireValue(argv, index, '--validators').split(',').map((entry) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--command') {
      const command = requireValue(argv, index, '--command');
      const exitCode = parseIntegerFlag(argv, '--exit-code');
      const stdoutSha256 = readOptionalFlag(argv, '--stdout-sha256');
      const stderrSha256 = readOptionalFlag(argv, '--stderr-sha256');
      if (exitCode === null || !isSha256(stdoutSha256) || !isSha256(stderrSha256)) {
        throw new CliError('ATM_CLI_USAGE', 'evidence add --command also requires --exit-code, --stdout-sha256, and --stderr-sha256.', { exitCode: 2 });
      }
      options.commandRun = {
        command,
        exitCode,
        stdoutSha256,
        stderrSha256
      };
      index += 1;
      continue;
    }
    if (arg === '--command-runs') {
      options.commandRunsInputPath = requireValue(argv, index, '--command-runs');
      index += 1;
      continue;
    }
    if (arg === '--runner-kind') {
      options.runnerKind = normalizeRunnerKind(requireValue(argv, index, '--runner-kind'));
      index += 1;
      continue;
    }
    if (arg === '--source-commit') {
      options.sourceCommit = requireValue(argv, index, '--source-commit').trim();
      index += 1;
      continue;
    }
    if (arg === '--exit-code' || arg === '--stdout-sha256' || arg === '--stderr-sha256') {
      requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `evidence add does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'evidence add requires --task <work-item-id>.', { exitCode: 2 });
  }
  if (!options.kind) {
    throw new CliError('ATM_CLI_USAGE', 'evidence add requires --kind <test|artifact|attestation|review|commit|waiver>.', { exitCode: 2 });
  }
  const cwd = path.resolve(options.cwd);
  const commandRunsPath = options.commandRunsInputPath ? path.resolve(cwd, options.commandRunsInputPath) : null;
  return {
    ...options,
    cwd,
    taskId: options.taskId.trim(),
    kind: options.kind.trim().toLowerCase(),
    commandRunsPath,
    commandRuns: commandRunsPath ? readCommandRunsInputFile(commandRunsPath) : []
  };
}

function parseGitHeadBackfillOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    actorId: null as string | null,
    summary: null as string | null,
    reason: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--summary') {
      options.summary = requireValue(argv, index, '--summary');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `evidence git-head-backfill does not support option ${arg}`, { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd)
  };
}

function readCommandRunsInputFile(filePath: string): CommandRunEvidenceInput[] {
  if (!existsSync(filePath)) {
    throw new CliError('ATM_COMMAND_RUNS_FILE_MISSING', `Command runs file not found: ${filePath}`, { exitCode: 2 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new CliError('ATM_COMMAND_RUNS_FILE_INVALID_JSON', `Command runs file is not valid JSON: ${filePath}`, {
      exitCode: 2,
      details: { error: error instanceof Error ? error.message : String(error) }
    });
  }
  const records = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.commandRuns)
      ? parsed.commandRuns
      : isRecord(parsed) && Array.isArray(parsed.runs)
        ? parsed.runs
        : [];
  if (records.length === 0) {
    throw new CliError('ATM_COMMAND_RUNS_FILE_EMPTY', 'Command runs file must be an array or contain commandRuns[].', { exitCode: 2 });
  }
  return records.map((record, index) => normalizeCommandRunInput(record, `commandRuns/${index}`));
}

function normalizeEvidenceCommandRuns(input: {
  readonly cwd: string;
  readonly inlineRun: CommandRunEvidenceInput | null;
  readonly fileRuns: readonly CommandRunEvidenceInput[];
  readonly runnerKind: string | null;
  readonly sourceCommit: string | null;
}): readonly CommandRunEvidenceInput[] {
  const sourceCommit = input.sourceCommit ?? readCurrentCommit(input.cwd);
  return uniqueCommandRuns([
    ...(input.inlineRun ? [input.inlineRun] : []),
    ...input.fileRuns
  ].map((run) => {
    const runnerKind = normalizeRunnerKind(run.runnerKind ?? input.runnerKind ?? inferRunnerKindFromCommand(run.command));
    return {
      ...run,
      cwd: run.cwd ?? '.',
      runnerKind,
      sourceCommit: run.sourceCommit ?? (runnerKind === 'dev-source' ? sourceCommit ?? undefined : undefined),
      cacheKey: run.cacheKey ?? computeCommandRunCacheKey({
        command: run.command,
        cwd: run.cwd ?? '.',
        exitCode: run.exitCode,
        stdoutSha256: run.stdoutSha256,
        stderrSha256: run.stderrSha256,
        runnerKind,
        sourceCommit: run.sourceCommit ?? (runnerKind === 'dev-source' ? sourceCommit ?? undefined : undefined)
      }),
      cached: run.cached === true,
      generatedAt: run.generatedAt ?? new Date().toISOString()
    };
  }));
}

function normalizeCommandRunInput(value: unknown, label: string): CommandRunEvidenceInput {
  if (!isRecord(value)) {
    throw new CliError('ATM_COMMAND_RUN_INVALID', `Command run ${label} must be an object.`, { exitCode: 2 });
  }
  const command = typeof value.command === 'string' ? value.command.trim() : '';
  const exitCode = typeof value.exitCode === 'number'
    ? value.exitCode
    : typeof value.exitCode === 'string'
      ? Number.parseInt(value.exitCode, 10)
      : Number.NaN;
  const stdoutSha256 = typeof value.stdoutSha256 === 'string'
    ? value.stdoutSha256.trim()
    : typeof value.stdoutHash === 'string'
      ? value.stdoutHash.trim()
      : '';
  const stderrSha256 = typeof value.stderrSha256 === 'string'
    ? value.stderrSha256.trim()
    : typeof value.stderrHash === 'string'
      ? value.stderrHash.trim()
      : '';
  if (!command || !Number.isFinite(exitCode) || !isSha256(stdoutSha256) || !isSha256(stderrSha256)) {
    throw new CliError('ATM_COMMAND_RUN_INVALID', `Command run ${label} requires command, exitCode, stdoutSha256, and stderrSha256.`, {
      exitCode: 2,
      details: { label }
    });
  }
  return {
    command,
    cwd: typeof value.cwd === 'string' && value.cwd.trim() ? normalizeRelativePath(value.cwd) : undefined,
    exitCode,
    stdoutSha256,
    stderrSha256,
    validators: Array.isArray(value.validators) ? value.validators.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim()) : undefined,
    cached: value.cached === true,
    cacheKey: typeof value.cacheKey === 'string' && value.cacheKey.trim() ? value.cacheKey.trim() : undefined,
    runnerKind: typeof value.runnerKind === 'string' && value.runnerKind.trim() ? normalizeRunnerKind(value.runnerKind) : undefined,
    sourceCommit: typeof value.sourceCommit === 'string' && value.sourceCommit.trim() ? value.sourceCommit.trim() : undefined,
    runnerVersion: typeof value.runnerVersion === 'string' && value.runnerVersion.trim() ? value.runnerVersion.trim() : undefined,
    generatedAt: typeof value.generatedAt === 'string' && value.generatedAt.trim() ? value.generatedAt.trim() : undefined
  };
}

function normalizeRunnerKind(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'dev' || normalized === 'source' || normalized === 'dev-source' || normalized === 'atm.dev.mjs') return 'dev-source';
  if (normalized === 'frozen' || normalized === 'release' || normalized === 'stable' || normalized === 'atm.mjs') return 'frozen-runner';
  if (normalized === 'external' || normalized === 'host') return 'external';
  return 'unknown';
}

function inferRunnerKindFromCommand(command: string) {
  if (/\batm\.dev\.mjs\b/.test(command)) return 'dev-source';
  if (/\batm\.mjs\b/.test(command)) return 'frozen-runner';
  return 'unknown';
}

function uniqueCommandRuns(runs: readonly CommandRunEvidenceInput[]) {
  const seen = new Set<string>();
  const output: CommandRunEvidenceInput[] = [];
  for (const run of runs) {
    const key = `${run.command}|${run.cwd ?? '.'}|${run.exitCode}|${run.stdoutSha256}|${run.stderrSha256}|${run.runnerKind ?? ''}|${run.sourceCommit ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(run);
  }
  return output;
}

function computeCommandRunCacheKey(run: {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly runnerKind?: string;
  readonly sourceCommit?: string;
}) {
  return hashJson({
    schemaId: 'atm.commandRunCacheKey.v1',
    command: run.command,
    cwd: run.cwd,
    exitCode: run.exitCode,
    stdoutSha256: run.stdoutSha256,
    stderrSha256: run.stderrSha256,
    runnerKind: run.runnerKind ?? null,
    sourceCommit: run.sourceCommit ?? null
  });
}

function hashJson(value: unknown) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function readCurrentCommit(cwd: string) {
  return runGitScalar(cwd, ['rev-parse', '--verify', 'HEAD']) ?? undefined;
}

function parseEvidenceVerifyOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    gate: 'close' as EvidenceGate
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--gate') {
      const gate = requireValue(argv, index, '--gate').trim().toLowerCase();
      if (gate !== 'close' && gate !== 'commit' && gate !== 'pr') {
        throw new CliError('ATM_CLI_USAGE', 'evidence verify --gate supports only: close, commit, pr.', { exitCode: 2 });
      }
      options.gate = gate;
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `evidence verify does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'evidence verify requires --task <work-item-id>.', { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim()
  };
}

function readParentCommitShas(cwd: string, commitSha: string) {
  const result = runGitCommand(cwd, ['rev-list', '--parents', '-n', '1', commitSha]);
  if (!result.ok) return [];
  return result.stdout.trim().split(/\s+/).slice(1).filter(Boolean);
}

function runGitScalar(cwd: string, args: string[]) {
  const result = runGitCommand(cwd, args);
  return result.ok ? result.stdout.trim() : null;
}

function runGitCommand(cwd: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    encoding: 'utf8'
  });
  return {
    ok: !result.error && result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: [result.stderr ?? '', result.error?.message ?? ''].filter(Boolean).join('\n')
  };
}

function readGovernedCommitTreeWithoutEvidence(cwd: string, commitSha: string) {
  const tempDir = mkdirTempDir();
  const tempIndex = path.join(tempDir, 'index');
  try {
    const readTree = runGitCommand(cwd, ['read-tree', commitSha], {
      GIT_INDEX_FILE: tempIndex
    });
    if (!readTree.ok) return null;
    runGitCommand(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', '.atm/history/evidence/git-head.json'], {
      GIT_INDEX_FILE: tempIndex
    });
    const writeTree = runGitCommand(cwd, ['write-tree'], {
      GIT_INDEX_FILE: tempIndex
    });
    return writeTree.ok ? writeTree.stdout.trim() : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function mkdirTempDir() {
  return path.resolve(mkdtempSync(path.join(os.tmpdir(), 'atm-evidence-backfill-')));
}

function readEvidenceBundle(cwd: string, taskId: string): { evidence: readonly Record<string, unknown>[] } {
  const evidencePath = evidencePathForTask(cwd, taskId);
  if (!existsSync(evidencePath)) {
    return { evidence: [] };
  }
  const parsed = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
  if (Array.isArray(parsed)) {
    return { evidence: parsed.filter(isRecord) };
  }
  if (isRecord(parsed)) {
    if (Array.isArray(parsed.evidence)) {
      return {
        evidence: parsed.evidence.filter(isRecord)
      };
    }
    return { evidence: [parsed] };
  }
  return { evidence: [] };
}

function writeEvidenceEnvelope(evidencePath: string, envelope: EvidenceEnvelope) {
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
}

function canonicalizeEvidenceRecord(value: Record<string, unknown>): CanonicalEvidenceRecord {
  const evidenceType = typeof value.evidenceType === 'string' ? value.evidenceType : '';
  const evidenceKind = typeof value.evidenceKind === 'string' ? value.evidenceKind : '';
  const detailKind = isRecord(value.details) && typeof value.details.kind === 'string' ? value.details.kind : '';
  const detailFreshness = isRecord(value.details) && typeof value.details.freshness === 'string' ? value.details.freshness : '';
  const topFreshness = typeof value.evidenceFreshness === 'string'
    ? value.evidenceFreshness
    : typeof value.freshness === 'string'
      ? value.freshness
      : '';
  const kind = normalizeEvidenceKind(evidenceType || detailKind || evidenceKind);
  return {
    kind,
    summary: typeof value.summary === 'string' ? value.summary : '',
    producedBy: typeof value.producedBy === 'string' ? value.producedBy : null,
    artifactPaths: Array.isArray(value.artifactPaths)
      ? value.artifactPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => normalizeRelativePath(entry))
      : [],
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
    freshness: normalizeEvidenceFreshness(topFreshness || detailFreshness),
    hasCommandRunProof: hasCommandRunProof(value)
  };
}

function normalizeEvidenceKind(value: string): CanonicalEvidenceKind {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'test' || normalized === 'validation') return 'test';
  if (normalized === 'artifact') return 'artifact';
  if (normalized === 'attestation') return 'attestation';
  if (normalized === 'review') return 'review';
  if (normalized === 'commit') return 'commit';
  if (normalized === 'waiver') return 'waiver';
  return 'other';
}

function normalizeEvidenceFreshness(value: string): EvidenceFreshness {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'historical-reference' || normalized === 'historical_reference' || normalized === 'reference-only') {
    return 'historical-reference';
  }
  if (normalized === 'draft') return 'draft';
  return 'fresh';
}

function evidencePathForTask(cwd: string, taskId: string) {
  return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
}

function taskPathForEvidence(cwd: string, taskId: string) {
  return path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `evidence requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readTaskDocument(cwd: string, taskId: string) {
  const taskPath = taskPathForEvidence(cwd, taskId);
  if (!existsSync(taskPath)) return null;
  return JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
}

function extractTaskDeclaredFiles(taskDocument: Record<string, unknown> | null) {
  if (!taskDocument) return [];
  const files = new Set<string>();
  for (const key of ['scope', 'files', 'changedFiles', 'criticalChangedFiles', 'guardPaths', 'targetFiles']) {
    collectTaskFileValues(taskDocument[key], files);
  }
  const source = taskDocument.source;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const sourceRecord = source as Record<string, unknown>;
    collectTaskFileValues(sourceRecord.path, files);
    collectTaskFileValues(sourceRecord.planPath, files);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function collectTaskFileValues(value: unknown, files: Set<string>) {
  if (typeof value === 'string') {
    const normalized = normalizeRelativePath(value);
    if (normalized) files.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTaskFileValues(entry, files);
    }
  }
}

function detectReopenedOrRedteamTask(taskDocument: Record<string, unknown> | null | undefined) {
  if (!taskDocument) return false;
  for (const field of ['audit_status', 'auditStatus', 'notes', 'summary', 'description']) {
    const text = typeof taskDocument[field] === 'string' ? taskDocument[field] : '';
    if (/(reopened|clean[_ -]?redo|redteam|invalid completion claim|historical draft evidence|draft evidence)/i.test(text)) {
      return true;
    }
  }
  return false;
}

function detectCodeOrFrameworkTask(taskDocument: Record<string, unknown> | null | undefined, declaredFiles: readonly string[]) {
  if (!taskDocument) return declaredFiles.some(isCodeLikePath);
  const closureAuthority = typeof taskDocument.closureAuthority === 'string'
    ? taskDocument.closureAuthority
    : typeof taskDocument.closure_authority === 'string'
      ? taskDocument.closure_authority
      : '';
  const targetRepo = typeof taskDocument.targetRepo === 'string'
    ? taskDocument.targetRepo
    : typeof taskDocument.target_repo === 'string'
      ? taskDocument.target_repo
      : '';
  if (closureAuthority.trim().toLowerCase() === 'target_repo' || targetRepo.trim().length > 0) {
    return true;
  }
  const source = taskDocument.source && typeof taskDocument.source === 'object' && !Array.isArray(taskDocument.source)
    ? taskDocument.source as Record<string, unknown>
    : {};
  if (typeof source.planPath === 'string' && source.planPath.trim().length > 0) {
    return true;
  }
  if (declaredFiles.some(isCodeLikePath)) return true;
  const notes = typeof taskDocument.notes === 'string' ? taskDocument.notes : '';
  return isCodeLikePath(notes);
}

function isCodeLikePath(value: string) {
  return /(^|[/\s])(packages|scripts|schemas|specs|templates|integrations|examples|tests)\//i.test(value)
    || /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|cs|cpp|c|h|json|ya?ml|sh|ps1)\b/i.test(value);
}

function hasCommandRunProof(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.commandRuns)) {
    return candidate.commandRuns.some((entry) => isCommandRunProof(entry));
  }
  if (isRecord(candidate.details) && Array.isArray(candidate.details.commandRuns)) {
    return candidate.details.commandRuns.some((entry) => isCommandRunProof(entry));
  }
  return false;
}

function isCommandRunProof(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.command === 'string'
    && typeof candidate.exitCode === 'number'
    && isSha256(candidate.stdoutSha256)
    && isSha256(candidate.stderrSha256);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value.trim());
}

function readOptionalFlag(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  if (index < 0 || index + 1 >= argv.length) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value.trim() : null;
}

function parseIntegerFlag(argv: string[], flag: string) {
  const raw = readOptionalFlag(argv, flag);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}
