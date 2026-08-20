import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID = 'atm.waveExitObserverReceipt.v1' as const;
export const WAVE_EXIT_OBSERVER_POLICY_SCHEMA_ID = 'atm.waveExitObserverPolicy.v1' as const;
export const WAVE_EXIT_OBSERVER_POLICY_PATH = 'schemas/evidence/wave-exit-observer-policy.json';
export const WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_PATH = 'schemas/evidence/wave-exit-observer-receipt.schema.json';
export const CANONICAL_WAVE_EXIT_RECEIPT_DIR = 'docs/reports/wave-exit-observer-receipts';

const DIGEST_SHAPE = /^sha256:[a-f0-9]{64}$/;
const COMMIT_SHAPE = /^[0-9a-f]{40}$/;
const EXIT_ID_SHAPE = /^EXIT-[0-9]{2}$/;

export type WaveExitObserverDiagnostic =
  | 'missing-field'
  | 'schema-mismatch'
  | 'unapproved-command'
  | 'compiler-command-forbidden'
  | 'observer-basis-actor-conflict'
  | 'declared-basis-actor-mismatch'
  | 'observer-role-mismatch'
  | 'target-head-unreachable'
  | 'receipt-stale'
  | 'historical-policy-invalid'
  | 'input-digest-drift'
  | 'basis-actor-unresolved'
  | 'wave-mismatch'
  | 'exit-unmapped'
  | 'nonzero-exit'
  | 'artifact-path-mismatch'
  | 'independence-verdict-invalid';

export interface WaveExitObserverInputDigest {
  readonly path: string;
  readonly digest: string;
}

export interface WaveExitObserverReceipt {
  readonly schemaId: typeof WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID;
  readonly schemaVersion: string;
  readonly exitItemId: string;
  readonly wave: string;
  readonly observerActor: string;
  readonly observerRole: string;
  readonly declaredBasisActor: string;
  readonly independenceVerdict: 'independent';
  readonly command: string;
  readonly exitCode: number;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly observedAt: string;
  readonly observedHead: string;
  readonly policyDigest: string;
  readonly inputDigests: readonly WaveExitObserverInputDigest[];
  readonly artifactPath: string;
}

export interface WaveExitObserverRole {
  readonly kind: 'basis' | 'observer' | 'not-observer';
  readonly executor?: string;
}

export interface WaveExitObserverExitPolicy {
  readonly wave: string;
  readonly observerRole: string;
  readonly command: string;
  readonly commandPath: string;
  readonly inputs: readonly string[];
  readonly sideEffects: string;
  readonly forbiddenFlags: readonly string[];
}

export type WaveExitBasisActorResolution = 'active-claim-holder' | 'unique-evidence-actor';

export interface WaveExitObserverPolicyDigestSpec {
  readonly encoding: 'utf8';
  readonly newline: 'lf';
  readonly source: 'git-show';
  readonly path: typeof WAVE_EXIT_OBSERVER_POLICY_PATH;
}

export interface WaveExitObserverPolicy {
  readonly schemaId: typeof WAVE_EXIT_OBSERVER_POLICY_SCHEMA_ID;
  readonly specVersion: string;
  readonly canonicalReceiptDir: string;
  readonly compilerCommandPath: string;
  readonly basisProducerRole: string;
  readonly basisEvidenceOwners: readonly string[];
  readonly basisActorResolution: WaveExitBasisActorResolution;
  readonly policyDigest: WaveExitObserverPolicyDigestSpec;
  readonly roles: Readonly<Record<string, WaveExitObserverRole>>;
  readonly exits: Readonly<Record<string, WaveExitObserverExitPolicy>>;
}

export interface DerivedBasisIdentity {
  readonly actorIds: readonly string[];
  readonly producerRole: string;
}

export interface ConsumeWaveExitObserverReceiptInput {
  readonly receipt: unknown;
  readonly policy: WaveExitObserverPolicy;
  readonly compilationHead: string;
  readonly derivedBasis: DerivedBasisIdentity;
  readonly currentInputDigests: Readonly<Record<string, string>>;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly policyDigestAtCompilationHead: string;
  readonly readPolicySourceAtCommit: (commit: string) => string | null;
}

export interface WaveExitObserverVerdict {
  readonly ok: boolean;
  readonly status: 'proven' | 'unproven';
  readonly diagnostics: readonly WaveExitObserverDiagnostic[];
  readonly receipt: WaveExitObserverReceipt | null;
  readonly canonicalArtifactPath: string | null;
}

export interface ConsumeWaveExitObserverReceiptCandidatesInput {
  readonly repoRoot: string;
  readonly receipts: readonly unknown[];
  readonly policy: WaveExitObserverPolicy;
  readonly compilationHead: string;
  readonly currentInputDigests: Readonly<Record<string, string>>;
  readonly policyDigestAtCompilationHead: string;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly basisActors?: readonly string[];
  readonly readPolicySourceAtCommit?: (commit: string) => string | null;
}

export interface WaveExitObserverCandidatesVerdict {
  readonly receipt: WaveExitObserverReceipt | null;
  readonly diagnostics: readonly (WaveExitObserverDiagnostic | 'receipt-ambiguity')[];
}

const REQUIRED_RECEIPT_FIELDS = [
  'schemaId',
  'schemaVersion',
  'exitItemId',
  'wave',
  'observerActor',
  'observerRole',
  'declaredBasisActor',
  'independenceVerdict',
  'command',
  'exitCode',
  'stdoutDigest',
  'stderrDigest',
  'observedAt',
  'observedHead',
  'policyDigest',
  'inputDigests',
  'artifactPath'
] as const;

export function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function normalizeWaveExitObserverPolicySource(source: string): string {
  return source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

export function digestWaveExitObserverPolicySource(source: string): string {
  return digestText(normalizeWaveExitObserverPolicySource(source));
}

export function readWaveExitObserverPolicySource(repoRoot = '.'): string {
  return readFileSync(join(repoRoot, WAVE_EXIT_OBSERVER_POLICY_PATH), 'utf8');
}

/** Compact JSON.stringify(policy) is not the sealed digest. Observers must hash git-show bytes. */
export function digestWaveExitObserverPolicy(
  policy: WaveExitObserverPolicy,
  source = readWaveExitObserverPolicySource()
): string {
  if (policy.schemaId !== WAVE_EXIT_OBSERVER_POLICY_SCHEMA_ID) {
    throw new Error('wave-exit observer policy schema mismatch');
  }
  return digestWaveExitObserverPolicySource(source);
}

export function loadWaveExitObserverPolicy(repoRoot = '.'): WaveExitObserverPolicy {
  const raw = parseWaveExitObserverPolicySource(readWaveExitObserverPolicySource(repoRoot));
  if (!raw) throw new Error('wave-exit observer policy is malformed');
  return raw;
}

function parseWaveExitObserverPolicySource(source: string): WaveExitObserverPolicy | null {
  let raw: WaveExitObserverPolicy;
  try {
    raw = JSON.parse(normalizeWaveExitObserverPolicySource(source)) as WaveExitObserverPolicy;
  } catch {
    return null;
  }
  if (raw.schemaId !== WAVE_EXIT_OBSERVER_POLICY_SCHEMA_ID) {
    return null;
  }
  if (!isNonEmptyString(raw.specVersion) || !isNonEmptyString(raw.canonicalReceiptDir)
    || !isNonEmptyString(raw.compilerCommandPath) || !isNonEmptyString(raw.basisProducerRole)
    || !Array.isArray(raw.basisEvidenceOwners) || raw.basisEvidenceOwners.length === 0
    || raw.basisEvidenceOwners.some((owner) => !isNonEmptyString(owner))) {
    return null;
  }
  if (raw.basisActorResolution !== 'active-claim-holder' && raw.basisActorResolution !== 'unique-evidence-actor') {
    return null;
  }
  if (raw.policyDigest?.source !== 'git-show' || raw.policyDigest?.newline !== 'lf' || raw.policyDigest?.path !== WAVE_EXIT_OBSERVER_POLICY_PATH) {
    return null;
  }
  if (!raw.roles || typeof raw.roles !== 'object' || !raw.exits || typeof raw.exits !== 'object') return null;
  if (Object.values(raw.roles).some((role) => !role || !['basis', 'observer', 'not-observer'].includes(role.kind))) return null;
  if (Object.values(raw.exits).some((exit) => !exit || !isNonEmptyString(exit.wave)
    || !isNonEmptyString(exit.observerRole) || !isNonEmptyString(exit.command)
    || !isNonEmptyString(exit.commandPath) || !isNonEmptyString(exit.sideEffects)
    || !Array.isArray(exit.inputs) || exit.inputs.some((value) => !isNonEmptyString(value))
    || !Array.isArray(exit.forbiddenFlags) || exit.forbiddenFlags.some((value) => !isNonEmptyString(value)))) return null;
  return raw;
}

export function readWaveExitObserverPolicySourceAtCommit(repoRoot: string, commit: string): string | null {
  if (!COMMIT_SHAPE.test(commit)) return null;
  try {
    return execFileSync('git', ['show', `${commit}:${WAVE_EXIT_OBSERVER_POLICY_PATH}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
}

export function readClaimHolderActor(repoRoot: string, taskId: string): string | null {
  const taskPath = join(repoRoot, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return null;
  try {
    const record = JSON.parse(readFileSync(taskPath, 'utf8')) as { claim?: { actorId?: unknown } };
    return isNonEmptyString(record.claim?.actorId) ? record.claim.actorId.trim() : null;
  } catch {
    return null;
  }
}

export function readEvidenceProducerActors(repoRoot: string, taskId: string): string[] {
  const evidencePath = join(repoRoot, '.atm', 'history', 'evidence', `${taskId}.json`);
  if (!existsSync(evidencePath)) return [];
  try {
    const record = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      evidence?: Array<{ producedBy?: unknown; details?: { actorId?: unknown } }>;
    };
    const actors: string[] = [];
    for (const entry of record.evidence ?? []) {
      const actor = entry.details?.actorId ?? entry.producedBy;
      if (isNonEmptyString(actor)) actors.push(actor.trim());
    }
    return [...new Set(actors)];
  } catch {
    return [];
  }
}

/**
 * A receipt is an observation of a particular repository state.  Resolving a
 * basis actor against the current ledger would let a later handoff invalidate
 * an otherwise immutable observation, so receipt consumers read the task
 * authority snapshot from the observed commit instead.
 */
export function readClaimHolderActorAtCommit(repoRoot: string, taskId: string, commit: string): string | null {
  if (!COMMIT_SHAPE.test(commit)) return null;
  try {
    const body = execFileSync('git', ['show', `${commit}:.atm/history/tasks/${taskId}.json`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const record = JSON.parse(body) as { claim?: { actorId?: unknown; state?: unknown } };
    return record.claim?.state === 'active' && isNonEmptyString(record.claim.actorId)
      ? record.claim.actorId.trim()
      : null;
  } catch {
    return null;
  }
}

export function resolveWaveExitBasisProducer(input: {
  readonly repoRoot: string;
  readonly policy: WaveExitObserverPolicy;
  /** The immutable observation commit when consuming a historical receipt. */
  readonly basisCommit?: string;
  readonly readClaimHolder?: (taskId: string) => string | null;
  readonly readClaimHolderAtCommit?: (taskId: string, commit: string) => string | null;
  readonly readEvidenceActors?: (taskId: string) => readonly string[];
}): DerivedBasisIdentity {
  const owners = input.policy.basisEvidenceOwners;
  const readClaim = input.readClaimHolder ?? ((taskId: string) => readClaimHolderActor(input.repoRoot, taskId));
  const readClaimAtCommit = input.readClaimHolderAtCommit
    ?? ((taskId: string, commit: string) => readClaimHolderActorAtCommit(input.repoRoot, taskId, commit));
  const readEvidence = input.readEvidenceActors ?? ((taskId: string) => readEvidenceProducerActors(input.repoRoot, taskId));
  if (input.policy.basisActorResolution === 'active-claim-holder') {
    const actors = owners.map((owner) => input.basisCommit
      ? readClaimAtCommit(owner, input.basisCommit)
      : readClaim(owner)).filter((actor): actor is string => isNonEmptyString(actor));
    return { actorIds: [...new Set(actors)], producerRole: input.policy.basisProducerRole };
  }
  const actors = owners.flatMap((owner) => [...readEvidence(owner)]);
  return deriveBasisIdentityFromEvidence({
    producerActors: actors,
    producerRole: input.policy.basisProducerRole
  });
}

export function canonicalWaveExitReceiptPath(policy: WaveExitObserverPolicy, exitItemId: string, observedHead?: string): string {
  const basePath = `${policy.canonicalReceiptDir.replace(/\\/g, '/')}/${exitItemId}.json`;
  return observedHead && COMMIT_SHAPE.test(observedHead)
    ? `${basePath.slice(0, -'.json'.length)}/${observedHead}.json`
    : basePath;
}

export function deriveBasisIdentityFromEvidence(input: {
  readonly producerActors: readonly string[];
  readonly producerRole: string;
}): DerivedBasisIdentity {
  const actorIds = [...new Set(input.producerActors.map((actor) => actor.trim()).filter(Boolean))].sort();
  return { actorIds, producerRole: input.producerRole };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readReceipt(value: unknown): { receipt: Partial<WaveExitObserverReceipt> | null; missing: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { receipt: null, missing: true };
  const record = value as Record<string, unknown>;
  const missing = REQUIRED_RECEIPT_FIELDS.some((field) => record[field] === undefined || record[field] === null);
  return { receipt: record as Partial<WaveExitObserverReceipt>, missing };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameExitContract(left: WaveExitObserverExitPolicy | undefined, right: WaveExitObserverExitPolicy | undefined): boolean {
  return !!left && !!right
    && left.wave === right.wave
    && left.command === right.command
    && left.commandPath === right.commandPath
    && left.sideEffects === right.sideEffects
    && sameArray(left.inputs, right.inputs)
    && sameArray(left.forbiddenFlags, right.forbiddenFlags)
    && left.observerRole === right.observerRole;
}

function sameBasisSettings(left: WaveExitObserverPolicy, right: WaveExitObserverPolicy): boolean {
  return left.canonicalReceiptDir === right.canonicalReceiptDir
    && left.compilerCommandPath === right.compilerCommandPath
    && left.basisProducerRole === right.basisProducerRole
    && left.basisActorResolution === right.basisActorResolution
    && sameArray(left.basisEvidenceOwners, right.basisEvidenceOwners);
}

export function consumeWaveExitObserverReceipt(input: ConsumeWaveExitObserverReceiptInput): WaveExitObserverVerdict {
  const diagnostics = new Set<WaveExitObserverDiagnostic>();
  const { policy, compilationHead, derivedBasis, currentInputDigests, isAncestor, policyDigestAtCompilationHead } = input;
  const parsed = readReceipt(input.receipt);
  if (!parsed.receipt || parsed.missing) {
    return {
      ok: false,
      status: 'unproven',
      diagnostics: ['missing-field'],
      receipt: null,
      canonicalArtifactPath: null
    };
  }
  const receipt = parsed.receipt;
  const observedPolicySource = isNonEmptyString(receipt.observedHead)
    ? input.readPolicySourceAtCommit(receipt.observedHead)
    : null;
  const observedPolicy = observedPolicySource ? parseWaveExitObserverPolicySource(observedPolicySource) : null;
  if (!observedPolicy) diagnostics.add('historical-policy-invalid');
  const observedPolicyDigest = observedPolicySource ? digestWaveExitObserverPolicySource(observedPolicySource) : null;
  if (observedPolicyDigest && receipt.policyDigest !== observedPolicyDigest) diagnostics.add('receipt-stale');
  if (receipt.schemaId !== WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID || !isNonEmptyString(receipt.schemaVersion)) {
    diagnostics.add('schema-mismatch');
  }
  if (!isNonEmptyString(receipt.exitItemId) || !EXIT_ID_SHAPE.test(receipt.exitItemId)) diagnostics.add('missing-field');
  const exitPolicy = isNonEmptyString(receipt.exitItemId) ? policy.exits[receipt.exitItemId] : undefined;
  if (!exitPolicy) diagnostics.add('exit-unmapped');
  const canonicalPath = exitPolicy && isNonEmptyString(receipt.exitItemId)
    ? canonicalWaveExitReceiptPath(policy, receipt.exitItemId)
    : null;
  const successorCanonicalPath = exitPolicy && isNonEmptyString(receipt.exitItemId) && isNonEmptyString(receipt.observedHead)
    ? canonicalWaveExitReceiptPath(policy, receipt.exitItemId, receipt.observedHead)
    : null;
  if (!isNonEmptyString(receipt.wave) || (exitPolicy && receipt.wave !== exitPolicy.wave)) diagnostics.add('wave-mismatch');
  if (!isNonEmptyString(receipt.observerActor) || !isNonEmptyString(receipt.observerRole) || !isNonEmptyString(receipt.declaredBasisActor)) {
    diagnostics.add('missing-field');
  }
  if (receipt.independenceVerdict !== 'independent') diagnostics.add('independence-verdict-invalid');
  if (!isNonEmptyString(receipt.command)) diagnostics.add('missing-field');
  if (typeof receipt.exitCode !== 'number' || !Number.isInteger(receipt.exitCode)) diagnostics.add('missing-field');
  else if (receipt.exitCode !== 0) diagnostics.add('nonzero-exit');
  if (!isNonEmptyString(receipt.stdoutDigest) || !DIGEST_SHAPE.test(receipt.stdoutDigest)) diagnostics.add('missing-field');
  if (!isNonEmptyString(receipt.stderrDigest) || !DIGEST_SHAPE.test(receipt.stderrDigest)) diagnostics.add('missing-field');
  if (!isNonEmptyString(receipt.observedAt) || Number.isNaN(Date.parse(receipt.observedAt))) diagnostics.add('missing-field');
  if (!isNonEmptyString(receipt.observedHead) || !COMMIT_SHAPE.test(receipt.observedHead)) diagnostics.add('missing-field');
  if (!COMMIT_SHAPE.test(compilationHead)) diagnostics.add('target-head-unreachable');
  if (!isNonEmptyString(receipt.policyDigest) || !DIGEST_SHAPE.test(receipt.policyDigest)) diagnostics.add('missing-field');
  if (!Array.isArray(receipt.inputDigests)) diagnostics.add('missing-field');
  if (!isNonEmptyString(receipt.artifactPath)) diagnostics.add('missing-field');

  if (isNonEmptyString(receipt.command) && isNonEmptyString(policy.compilerCommandPath) && receipt.command.includes(policy.compilerCommandPath)) {
    diagnostics.add('compiler-command-forbidden');
    diagnostics.add('unapproved-command');
  }
  if (exitPolicy && isNonEmptyString(receipt.command) && receipt.command !== exitPolicy.command) {
    diagnostics.add('unapproved-command');
  }
  if (exitPolicy && isNonEmptyString(receipt.observerRole) && receipt.observerRole !== exitPolicy.observerRole) {
    diagnostics.add('observer-role-mismatch');
  }
  const observerKind = isNonEmptyString(receipt.observerRole) ? policy.roles[receipt.observerRole]?.kind : undefined;
  if (observerKind !== 'observer') diagnostics.add('observer-role-mismatch');

  const uniqueBasisActors = [...new Set(derivedBasis.actorIds.filter(Boolean))];
  if (uniqueBasisActors.length !== 1) diagnostics.add('basis-actor-unresolved');
  const derivedBasisActor = uniqueBasisActors[0];
  if (derivedBasis.producerRole !== policy.basisProducerRole) diagnostics.add('observer-role-mismatch');
  if (derivedBasisActor && isNonEmptyString(receipt.declaredBasisActor) && receipt.declaredBasisActor !== derivedBasisActor) {
    diagnostics.add('declared-basis-actor-mismatch');
  }
  if (derivedBasisActor && isNonEmptyString(receipt.observerActor) && receipt.observerActor === derivedBasisActor) {
    diagnostics.add('observer-basis-actor-conflict');
  }

  if (isNonEmptyString(receipt.observedHead) && COMMIT_SHAPE.test(receipt.observedHead) && COMMIT_SHAPE.test(compilationHead)) {
    // Ancestry is required; equality is a valid ancestor and must not be demanded or rejected.
    if (!isAncestor(receipt.observedHead, compilationHead)) diagnostics.add('target-head-unreachable');
  }
  const policyEvolvedWithoutContractChange = observedPolicy
    && observedPolicyDigest !== policyDigestAtCompilationHead
    && sameExitContract(observedPolicy.exits[receipt.exitItemId ?? ''], exitPolicy)
    && sameBasisSettings(observedPolicy, policy);
  if (isNonEmptyString(receipt.policyDigest) && receipt.policyDigest !== policyDigestAtCompilationHead && !policyEvolvedWithoutContractChange) {
    diagnostics.add('receipt-stale');
  }
  if (canonicalPath && isNonEmptyString(receipt.artifactPath)
    && receipt.artifactPath.replace(/\\/g, '/') !== canonicalPath
    && receipt.artifactPath.replace(/\\/g, '/') !== successorCanonicalPath) {
    diagnostics.add('artifact-path-mismatch');
  }

  if (exitPolicy && Array.isArray(receipt.inputDigests)) {
    const observed = new Map(
      receipt.inputDigests
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => [String(entry.path ?? '').replace(/\\/g, '/'), String(entry.digest ?? '')])
    );
    for (const path of exitPolicy.inputs) {
      const expected = currentInputDigests[path];
      const got = observed.get(path);
      if (!expected || !got || got !== expected || !DIGEST_SHAPE.test(got)) diagnostics.add('input-digest-drift');
    }
    for (const path of observed.keys()) {
      if (!exitPolicy.inputs.includes(path)) diagnostics.add('input-digest-drift');
    }
  }

  const uniqueDiagnostics = [...diagnostics];
  const ok = uniqueDiagnostics.length === 0 && parsed.receipt.schemaId === WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID;
  return {
    ok,
    status: ok ? 'proven' : 'unproven',
    diagnostics: uniqueDiagnostics,
    receipt: ok ? parsed.receipt as WaveExitObserverReceipt : null,
    canonicalArtifactPath: canonicalPath
  };
}

/** Resolve every immutable receipt for one EXIT and accept exactly one valid candidate. */
export function consumeWaveExitObserverReceiptCandidates(
  input: ConsumeWaveExitObserverReceiptCandidatesInput
): WaveExitObserverCandidatesVerdict {
  const verdicts = input.receipts.map((receipt) => {
    const observedHead = receipt && typeof receipt === 'object' && !Array.isArray(receipt)
      ? (receipt as { observedHead?: unknown }).observedHead
      : undefined;
    const derivedBasis = input.basisActors
      ? { actorIds: input.basisActors, producerRole: input.policy.basisProducerRole }
      : resolveWaveExitBasisProducer({
          repoRoot: input.repoRoot,
          policy: input.policy,
          basisCommit: typeof observedHead === 'string' && COMMIT_SHAPE.test(observedHead) ? observedHead : undefined
        });
    return consumeWaveExitObserverReceipt({
      receipt,
      policy: input.policy,
      compilationHead: input.compilationHead,
      derivedBasis,
      currentInputDigests: input.currentInputDigests,
      isAncestor: input.isAncestor,
      policyDigestAtCompilationHead: input.policyDigestAtCompilationHead,
      readPolicySourceAtCommit: input.readPolicySourceAtCommit
        ?? ((commit) => readWaveExitObserverPolicySourceAtCommit(input.repoRoot, commit))
    });
  });
  const valid = verdicts.filter((verdict) => verdict.ok && verdict.receipt);
  return {
    receipt: valid.length === 1 ? valid[0]!.receipt : null,
    diagnostics: valid.length > 1
      ? ['receipt-ambiguity']
      : verdicts.flatMap((verdict) => verdict.diagnostics)
  };
}

export function readCanonicalWaveExitReceipt(repoRoot: string, policy: WaveExitObserverPolicy, exitItemId: string): unknown | null {
  const relativePath = canonicalWaveExitReceiptPath(policy, exitItemId);
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return null;
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

/**
 * A receipt never overwrites an earlier observation.  When an input changes,
 * a successor is stored under the EXIT id and observed commit; consumers
 * evaluate every immutable candidate and accept only a unique valid one.
 */
export function readWaveExitReceiptCandidates(repoRoot: string, policy: WaveExitObserverPolicy, exitItemId: string): unknown[] {
  const basePath = canonicalWaveExitReceiptPath(policy, exitItemId);
  const candidates = [basePath];
  const successorDir = join(repoRoot, basePath.slice(0, -'.json'.length));
  if (existsSync(successorDir)) {
    for (const entry of readdirSync(successorDir).filter((name) => /^[0-9a-f]{40}\.json$/.test(name)).sort()) {
      candidates.push(`${basePath.slice(0, -'.json'.length)}/${entry}`);
    }
  }
  return candidates.flatMap((relativePath) => {
    const absolutePath = join(repoRoot, relativePath);
    if (!existsSync(absolutePath)) return [];
    try {
      return [JSON.parse(readFileSync(absolutePath, 'utf8'))];
    } catch {
      return [{}];
    }
  });
}
