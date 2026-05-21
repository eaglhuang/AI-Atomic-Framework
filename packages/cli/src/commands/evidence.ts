import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

interface CanonicalEvidenceRecord {
  readonly kind: CanonicalEvidenceKind;
  readonly summary: string;
  readonly producedBy: string | null;
  readonly artifactPaths: readonly string[];
  readonly createdAt: string | null;
}

interface EvidenceEnvelope {
  readonly taskId: string;
  readonly updatedAt: string;
  readonly evidence: readonly Record<string, unknown>[];
}

export interface EvidenceGateResult {
  readonly ok: boolean;
  readonly gate: EvidenceGate;
  readonly total: number;
  readonly counts: Readonly<Record<CanonicalEvidenceKind, number>>;
  readonly missing: readonly string[];
}

export async function runEvidence(argv: string[]) {
  const action = (argv[0] ?? '').toLowerCase();
  if (action === 'add') {
    return runEvidenceAdd(argv.slice(1));
  }
  if (action === 'verify') {
    return runEvidenceVerify(argv.slice(1));
  }
  if (action === 'diff') {
    return runEvidenceDiff(argv.slice(1));
  }
  throw new CliError('ATM_CLI_USAGE', 'evidence supports: add, verify, diff', { exitCode: 2 });
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
  const verificationCount = counts.test + counts.artifact + counts.attestation + counts.commit;
  const missing: string[] = [];
  if (input.gate === 'close') {
    if (nonWaiver <= 0) {
      missing.push('at-least-one-non-waiver-evidence');
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
  const evidenceRecord: Record<string, unknown> = {
    evidenceKind: kind === 'waiver' ? 'waiver' : 'validation',
    evidenceType: kind,
    summary: options.summary ?? `${kind} evidence for ${options.taskId}.`,
    artifactPaths: options.artifacts,
    producedBy: actorId,
    createdAt: nowIso,
    details: {
      actorId,
      kind
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
      evidencePath: relativePathFrom(options.cwd, evidencePath),
      evidenceCount: nextEvidence.length
    }
  });
}

function runEvidenceVerify(argv: string[]) {
  const options = parseEvidenceVerifyOptions(argv);
  const result = verifyTaskEvidence({
    cwd: options.cwd,
    taskId: options.taskId,
    gate: options.gate
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
      missing: result.missing,
      evidencePath: relativePathFrom(options.cwd, evidencePathForTask(options.cwd, options.taskId))
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
    artifacts: [] as string[]
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
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim(),
    kind: options.kind.trim().toLowerCase()
  };
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
  const kind = normalizeEvidenceKind(evidenceType || detailKind || evidenceKind);
  return {
    kind,
    summary: typeof value.summary === 'string' ? value.summary : '',
    producedBy: typeof value.producedBy === 'string' ? value.producedBy : null,
    artifactPaths: Array.isArray(value.artifactPaths)
      ? value.artifactPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => normalizeRelativePath(entry))
      : [],
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null
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

function evidencePathForTask(cwd: string, taskId: string) {
  return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
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
