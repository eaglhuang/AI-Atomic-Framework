import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  canonicalWaveExitReceiptPath,
  consumeWaveExitObserverReceipt,
  digestText,
  digestWaveExitObserverPolicySource,
  WAVE_EXIT_OBSERVER_POLICY_PATH,
  WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID,
  type DerivedBasisIdentity,
  type WaveExitObserverDiagnostic,
  type WaveExitObserverPolicy,
  type WaveExitObserverReceipt
} from './wave-exit-observer-receipt.ts';

export const WAVE_EXIT_OBSERVER_WRITE_COMMAND = 'evidence wave-exit-observer';

const EXIT_ID_SHAPE = /^EXIT-[0-9]{2}$/;
const COMMIT_SHAPE = /^[0-9a-f]{40}$/;

const FORBIDDEN_SURFACES = [
  'docs/reports/plan-3x-4x-independent-certificate.json',
  'docs/reports/plan-3x-4x-runbook-completion-evidence.json',
  'docs/reports/plan-3x-4x-release-closeback.json',
  'docs/reports/plan-3x-4x-charter-current-verdict.json'
] as const;

export type WaveExitObserverWriteCode =
  | 'ATM_WAVE_EXIT_OBSERVER_EXIT_UNMAPPED'
  | 'ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND'
  | 'ATM_WAVE_EXIT_OBSERVER_ROLE_MISMATCH'
  | 'ATM_WAVE_EXIT_OBSERVER_ACTOR_CONFLICT'
  | 'ATM_WAVE_EXIT_OBSERVER_DIGEST_DRIFT'
  | 'ATM_WAVE_EXIT_OBSERVER_HEAD_UNREACHABLE'
  | 'ATM_WAVE_EXIT_OBSERVER_RECEIPT_EXISTS'
  | 'ATM_WAVE_EXIT_OBSERVER_PATH_TRAVERSAL'
  | 'ATM_WAVE_EXIT_OBSERVER_FORBIDDEN_SURFACE'
  | 'ATM_WAVE_EXIT_OBSERVER_CALLER_OVERRIDE'
  | 'ATM_WAVE_EXIT_OBSERVER_FORBIDDEN_FLAG'
  | 'ATM_WAVE_EXIT_OBSERVER_CONSUME_UNPROVEN'
  | 'ATM_WAVE_EXIT_OBSERVER_NONZERO_EXIT'
  | 'ATM_WAVE_EXIT_OBSERVER_BASIS_UNRESOLVED';

export class WaveExitObserverWriteError extends Error {
  readonly code: WaveExitObserverWriteCode;
  readonly diagnostics: readonly WaveExitObserverDiagnostic[];
  readonly details: Record<string, unknown>;

  constructor(
    code: WaveExitObserverWriteCode,
    message: string,
    options: { diagnostics?: readonly WaveExitObserverDiagnostic[]; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = 'WaveExitObserverWriteError';
    this.code = code;
    this.diagnostics = options.diagnostics ?? [];
    this.details = options.details ?? {};
  }
}

export interface ObservedCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WriteWaveExitObserverReceiptInput {
  readonly repoRoot: string;
  readonly exitItemId: string;
  readonly observerActor: string;
  readonly observerRole: string;
  readonly claimedCommand?: string | null;
  readonly claimedArtifactPath?: string | null;
  readonly claimedBasisActor?: string | null;
  readonly claimedInputDigests?: Readonly<Record<string, string>> | null;
  readonly extraFlags?: readonly string[];
  readonly policy: WaveExitObserverPolicy;
  readonly observedHead: string;
  readonly observedAt: string;
  readonly derivedBasis: DerivedBasisIdentity;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly readObservedInput: (relativePath: string) => string | null;
  readonly executeApprovedCommand: (command: string) => ObservedCommandResult;
  readonly receiptExists?: (absolutePath: string) => boolean;
  readonly readExistingReceipt?: (absolutePath: string) => unknown | null;
  readonly createExclusiveFile?: (absolutePath: string, contents: string) => void;
}

export interface WriteWaveExitObserverReceiptResult {
  readonly ok: true;
  readonly receipt: WaveExitObserverReceipt;
  readonly artifactPath: string;
  readonly absolutePath: string;
}

export function deriveBasisActorsFromEvidenceOwners(
  repoRoot: string,
  owners: readonly string[]
): string[] {
  const actors: string[] = [];
  for (const owner of owners) {
    const evidencePath = resolve(repoRoot, '.atm', 'history', 'evidence', `${owner}.json`);
    if (!existsSync(evidencePath)) continue;
    try {
      const record = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
        evidence?: Array<{ producedBy?: unknown; details?: { actorId?: unknown } }>;
      };
      for (const entry of record.evidence ?? []) {
        const actor = entry.details?.actorId ?? entry.producedBy;
        if (typeof actor === 'string' && actor.trim()) actors.push(actor.trim());
      }
    } catch {
      continue;
    }
  }
  return [...new Set(actors)];
}

export function exclusiveAtomicCreate(dest: string, contents: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_RECEIPT_EXISTS',
      `Canonical wave-exit observer receipt already exists: ${dest}`,
      { details: { dest } }
    );
  }
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  try {
    copyFileSync(tmp, dest, constants.COPYFILE_EXCL);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new WaveExitObserverWriteError(
        'ATM_WAVE_EXIT_OBSERVER_RECEIPT_EXISTS',
        `Canonical wave-exit observer receipt already exists: ${dest}`,
        { details: { dest } }
      );
    }
    throw error;
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function writeWaveExitObserverReceipt(
  input: WriteWaveExitObserverReceiptInput
): WriteWaveExitObserverReceiptResult {
  rejectCallerOverrides(input);
  if (!EXIT_ID_SHAPE.test(input.exitItemId)) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_EXIT_UNMAPPED',
      `Exit item ${input.exitItemId} is not a sealed EXIT id.`,
      { diagnostics: ['exit-unmapped'], details: { exitItemId: input.exitItemId } }
    );
  }
  const exitPolicy = input.policy.exits[input.exitItemId];
  if (!exitPolicy) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_EXIT_UNMAPPED',
      `Exit item ${input.exitItemId} is not mapped in the sealed observer policy.`,
      { diagnostics: ['exit-unmapped'], details: { exitItemId: input.exitItemId } }
    );
  }
  rejectForbiddenFlags(exitPolicy.forbiddenFlags, input.extraFlags ?? []);
  if (input.claimedCommand && input.claimedCommand !== exitPolicy.command) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND',
      'Observer command overrides are forbidden; the sealed policy owns the command.',
      { diagnostics: ['unapproved-command'], details: { claimedCommand: input.claimedCommand, sealedCommand: exitPolicy.command } }
    );
  }
  if (input.observerRole !== exitPolicy.observerRole || input.policy.roles[input.observerRole]?.kind !== 'observer') {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_ROLE_MISMATCH',
      `Observer role ${input.observerRole} is not authorized for ${input.exitItemId}.`,
      { diagnostics: ['observer-role-mismatch'], details: { observerRole: input.observerRole, requiredRole: exitPolicy.observerRole } }
    );
  }
  if (!COMMIT_SHAPE.test(input.observedHead) || !input.isAncestor(input.observedHead, input.observedHead)) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_HEAD_UNREACHABLE',
      `observedHead ${input.observedHead} is not a reachable repository HEAD.`,
      { diagnostics: ['target-head-unreachable'], details: { observedHead: input.observedHead } }
    );
  }

  const exists = input.receiptExists ?? ((path) => existsSync(path));
  const readExisting = input.readExistingReceipt ?? ((path: string) => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  });
  const baseArtifact = canonicalWaveExitReceiptPath(input.policy, input.exitItemId);
  const baseAbsolutePath = resolve(input.repoRoot, baseArtifact);
  const baseExists = exists(baseAbsolutePath);
  const baseReceipt = baseExists ? readExisting(baseAbsolutePath) as { observedHead?: unknown } | null : null;
  if (baseExists && (!baseReceipt || baseReceipt.observedHead === input.observedHead)) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_RECEIPT_EXISTS',
      `Canonical wave-exit observer receipt already exists: ${baseArtifact}`,
      { details: { artifactPath: baseArtifact } }
    );
  }
  const relativeArtifact = baseExists
    ? canonicalWaveExitReceiptPath(input.policy, input.exitItemId, input.observedHead)
    : baseArtifact;
  assertSafeCanonicalPath(input.repoRoot, input.policy, relativeArtifact, input.exitItemId);
  if (input.claimedArtifactPath && normalizeRel(input.claimedArtifactPath) !== relativeArtifact) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_PATH_TRAVERSAL',
      'Caller-supplied artifact paths are forbidden.',
      { diagnostics: ['artifact-path-mismatch'], details: { claimedArtifactPath: input.claimedArtifactPath, canonicalPath: relativeArtifact } }
    );
  }

  const absolutePath = resolve(input.repoRoot, relativeArtifact);
  if (exists(absolutePath)) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_RECEIPT_EXISTS',
      `Canonical wave-exit observer receipt already exists: ${relativeArtifact}`,
      { details: { artifactPath: relativeArtifact } }
    );
  }

  const derived = input.derivedBasis;
  const uniqueBasis = [...new Set(derived.actorIds.filter(Boolean))];
  if (uniqueBasis.length !== 1) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_BASIS_UNRESOLVED',
      'Basis producer actor could not be derived from evidence.',
      { diagnostics: ['basis-actor-unresolved'], details: { actorIds: derived.actorIds } }
    );
  }
  const derivedBasisActor = uniqueBasis[0]!;
  if (input.claimedBasisActor && input.claimedBasisActor !== derivedBasisActor) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_CALLER_OVERRIDE',
      'Self-filled basis actor does not match derived evidence identity.',
      { diagnostics: ['declared-basis-actor-mismatch'], details: { claimedBasisActor: input.claimedBasisActor, derivedBasisActor } }
    );
  }
  if (input.observerActor === derivedBasisActor) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_ACTOR_CONFLICT',
      'Observer actor is not independent of the derived basis producer.',
      { diagnostics: ['observer-basis-actor-conflict'], details: { observerActor: input.observerActor, derivedBasisActor } }
    );
  }

  const currentInputDigests: Record<string, string> = {};
  for (const inputPath of exitPolicy.inputs) {
    const body = input.readObservedInput(inputPath);
    if (body == null) {
      throw new WaveExitObserverWriteError(
        'ATM_WAVE_EXIT_OBSERVER_DIGEST_DRIFT',
        `Observed input ${inputPath} is missing at HEAD.`,
        { diagnostics: ['input-digest-drift'], details: { path: inputPath } }
      );
    }
    currentInputDigests[inputPath] = digestText(body);
  }
  const policySource = input.readObservedInput(WAVE_EXIT_OBSERVER_POLICY_PATH);
  if (policySource == null) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_DIGEST_DRIFT',
      `Observed policy ${WAVE_EXIT_OBSERVER_POLICY_PATH} is missing at HEAD.`,
      { diagnostics: ['receipt-stale'], details: { path: WAVE_EXIT_OBSERVER_POLICY_PATH } }
    );
  }
  const policyDigest = digestWaveExitObserverPolicySource(policySource);
  if (input.claimedInputDigests) {
    for (const [path, digest] of Object.entries(input.claimedInputDigests)) {
      if (currentInputDigests[path] !== digest) {
        throw new WaveExitObserverWriteError(
          'ATM_WAVE_EXIT_OBSERVER_DIGEST_DRIFT',
          'Caller-supplied input digests do not match observed HEAD bytes.',
          { diagnostics: ['input-digest-drift'], details: { path, claimed: digest, observed: currentInputDigests[path] } }
        );
      }
    }
  }

  const executed = input.executeApprovedCommand(exitPolicy.command);
  if (executed.exitCode !== 0) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_NONZERO_EXIT',
      `Sealed observer command exited ${executed.exitCode}.`,
      { diagnostics: ['nonzero-exit'], details: { exitCode: executed.exitCode, command: exitPolicy.command } }
    );
  }

  const receipt: WaveExitObserverReceipt = {
    schemaId: WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID,
    schemaVersion: input.policy.specVersion,
    exitItemId: input.exitItemId,
    wave: exitPolicy.wave,
    observerActor: input.observerActor,
    observerRole: input.observerRole,
    declaredBasisActor: derivedBasisActor,
    independenceVerdict: 'independent',
    command: exitPolicy.command,
    exitCode: executed.exitCode,
    stdoutDigest: digestText(executed.stdout),
    stderrDigest: digestText(executed.stderr),
    observedAt: input.observedAt,
    observedHead: input.observedHead,
    policyDigest,
    inputDigests: exitPolicy.inputs.map((path) => ({ path, digest: currentInputDigests[path]! })),
    artifactPath: relativeArtifact
  };

  const verdict = consumeWaveExitObserverReceipt({
    receipt,
    policy: input.policy,
    compilationHead: input.observedHead,
    derivedBasis: derived,
    currentInputDigests,
    isAncestor: input.isAncestor,
    policyDigestAtCompilationHead: policyDigest,
    readPolicySourceAtCommit: () => policySource
  });
  if (!verdict.ok) {
    throw writeErrorFromDiagnostics(verdict.diagnostics, {
      exitItemId: input.exitItemId,
      artifactPath: relativeArtifact
    });
  }

  const create = input.createExclusiveFile ?? exclusiveAtomicCreate;
  create(absolutePath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    ok: true,
    receipt,
    artifactPath: relativeArtifact,
    absolutePath
  };
}

function rejectCallerOverrides(input: WriteWaveExitObserverReceiptInput): void {
  const extra = input.extraFlags ?? [];
  const forbiddenCallerFlags = [
    '--command',
    '--artifact-path',
    '--output',
    '--output-path',
    '--basis-actor',
    '--stdout-sha256',
    '--stderr-sha256',
    '--exit-code'
  ];
  const hit = extra.find((flag) => forbiddenCallerFlags.includes(flag));
  if (hit === '--command' || input.claimedCommand) {
    if (hit === '--command' || (input.claimedCommand && input.claimedCommand.length > 0)) {
      const exitPolicy = input.policy.exits[input.exitItemId];
      if (!exitPolicy || input.claimedCommand !== exitPolicy.command || hit === '--command') {
        throw new WaveExitObserverWriteError(
          'ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND',
          'Caller-supplied observer commands are forbidden.',
          { diagnostics: ['unapproved-command'], details: { flag: hit ?? '--command' } }
        );
      }
    }
  }
  if (hit && hit !== '--command') {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_CALLER_OVERRIDE',
      `Caller override ${hit} is forbidden for the official receipt writer.`,
      { details: { flag: hit } }
    );
  }
}

function rejectForbiddenFlags(forbidden: readonly string[], extra: readonly string[]): void {
  for (const flag of forbidden) {
    const token = flag.split(/\s+/)[0] ?? flag;
    if (extra.includes(flag) || extra.includes(token)) {
      throw new WaveExitObserverWriteError(
        'ATM_WAVE_EXIT_OBSERVER_FORBIDDEN_FLAG',
        `Flag ${flag} is forbidden for this sealed EXIT command.`,
        { diagnostics: ['unapproved-command'], details: { flag } }
      );
    }
  }
}

function assertSafeCanonicalPath(
  repoRoot: string,
  policy: WaveExitObserverPolicy,
  relativeArtifact: string,
  exitItemId: string
): void {
  const dir = normalizeRel(policy.canonicalReceiptDir);
  if (!dir || isAbsolute(dir) || dir.split('/').includes('..')) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_PATH_TRAVERSAL',
      'Sealed canonical receipt directory is unsafe.',
      { diagnostics: ['artifact-path-mismatch'], details: { canonicalReceiptDir: policy.canonicalReceiptDir } }
    );
  }
  const normalizedArtifact = normalizeRel(relativeArtifact);
  const baseArtifact = `${dir}/${exitItemId}.json`;
  const successorPattern = new RegExp(`^${escapeRegExp(`${dir}/${exitItemId}/`)}[0-9a-f]{40}\\.json$`);
  if (normalizedArtifact !== baseArtifact && !successorPattern.test(normalizedArtifact)) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_PATH_TRAVERSAL',
      'Canonical receipt path does not match the sealed EXIT id.',
      { diagnostics: ['artifact-path-mismatch'], details: { relativeArtifact, baseArtifact } }
    );
  }
  const root = resolve(repoRoot);
  const dest = resolve(root, relativeArtifact);
  const canonicalDir = resolve(root, dir);
  if (!isPathInside(root, dest) || !isPathInside(canonicalDir, dest)) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_PATH_TRAVERSAL',
      'Canonical receipt path escapes the sealed receipt directory.',
      { diagnostics: ['artifact-path-mismatch'], details: { dest, canonicalDir } }
    );
  }
  const destRel = normalizeRel(relative(root, dest));
  if (FORBIDDEN_SURFACES.includes(destRel as (typeof FORBIDDEN_SURFACES)[number])) {
    throw new WaveExitObserverWriteError(
      'ATM_WAVE_EXIT_OBSERVER_FORBIDDEN_SURFACE',
      'Writer must not mutate certificate, completion evidence, or release verdict files.',
      { details: { destRel } }
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPathInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate === resolvedRoot) return false;
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  return resolvedCandidate.startsWith(prefix);
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function writeErrorFromDiagnostics(
  diagnostics: readonly WaveExitObserverDiagnostic[],
  details: Record<string, unknown>
): WaveExitObserverWriteError {
  if (diagnostics.includes('observer-basis-actor-conflict')) {
    return new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_ACTOR_CONFLICT', 'Observer actor conflicts with derived basis.', { diagnostics, details });
  }
  if (diagnostics.includes('observer-role-mismatch') || diagnostics.includes('declared-basis-actor-mismatch')) {
    return new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_ROLE_MISMATCH', 'Observer role or declared basis failed closed.', { diagnostics, details });
  }
  if (diagnostics.includes('unapproved-command') || diagnostics.includes('compiler-command-forbidden')) {
    return new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND', 'Command is not sealed for this EXIT.', { diagnostics, details });
  }
  if (diagnostics.includes('input-digest-drift') || diagnostics.includes('receipt-stale')) {
    return new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_DIGEST_DRIFT', 'Policy or input digest failed closed.', { diagnostics, details });
  }
  if (diagnostics.includes('target-head-unreachable')) {
    return new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_HEAD_UNREACHABLE', 'observedHead is unreachable from the current HEAD.', { diagnostics, details });
  }
  if (diagnostics.includes('nonzero-exit')) {
    return new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_NONZERO_EXIT', 'Sealed observer command exited non-zero.', { diagnostics, details });
  }
  if (diagnostics.includes('exit-unmapped')) {
    return new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_EXIT_UNMAPPED', 'EXIT is not mapped in sealed policy.', { diagnostics, details });
  }
  return new WaveExitObserverWriteError('ATM_WAVE_EXIT_OBSERVER_CONSUME_UNPROVEN', 'Receipt failed consumer validation before write.', { diagnostics, details });
}
