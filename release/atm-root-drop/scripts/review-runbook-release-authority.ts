#!/usr/bin/env node
/**
 * Reviewer B deliberately treats the runbook completion report as untrusted
 * input.  It never consumes either independent certificate or reviewer A.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semanticTaskCardDigest } from './task-card-contract-digest.ts';
import {
  consumeWaveExitObserverReceiptCandidates,
  digestWaveExitObserverInputsAtCommit,
  digestWaveExitObserverPolicySource,
  loadWaveExitObserverPolicyAtCommit,
  readWaveExitObserverPolicySourceAtCommit
} from '../packages/core/src/evidence/wave-exit-observer-receipt.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const completionPath = 'docs/reports/plan-3x-4x-runbook-completion-evidence.json';
const runbookPath = '../3KLife/docs/ai_atomic_framework/governance-optimization/plan-3x-4x-false-green-correction-complete-closeout-runbook-2026-08-09.md';
const outputPath = 'docs/reports/reviews/plan-3x-4x-runbook-release-review.json';
export const completionReviewProjection = 'completion-report-excluding-certificate-derived-conclusion';

type RecordLike = Record<string, any>;
const ancestryCache = new Map<string, boolean>();

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableDigest(value: unknown): string {
  return sha256(JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
}

function isCertificateDerivedRow(row: RecordLike): boolean {
  return row.wave === 'Wave 10'
    || (row.section === 'Tests, backlog and release'
      && /runner sync queue|remote-reachable|closeback receipt|final certificate/i.test(String(row.requirement ?? '')));
}

/**
 * Reviewer B verifies the runbook's evidence contracts independently of the
 * final certificate's conclusion.  The final certificate separately consumes
 * this review, so digesting that conclusion here would form a self-reference.
 */
export function projectCompletionForRunbookReview(raw: string): string {
  const projected = JSON.parse(raw.replace(/^\uFEFF/, '')) as RecordLike;
  delete projected.generatedAt;
  delete projected.overallVerdict;
  delete projected.unresolvedIds;
  delete projected.unknownIds;
  delete projected.deferredIds;
  delete projected.authority?.targetHead;
  delete projected.authority?.originMain;
  for (const row of [...(Array.isArray(projected.rows) ? projected.rows : []), ...(Array.isArray(projected.waveExits) ? projected.waveExits : [])]) {
    if (!isCertificateDerivedRow(row)) continue;
    // `deferred` is a stable, schema-valid review state.  The reviewer below
    // still validates any underlying evidence but explicitly does not decide
    // whether the certificate-derived conclusion is proven.
    row.status = 'deferred';
    row.reviewStatus = 'certificate-derived';
    delete row.diagnostics;
  }
  return `${JSON.stringify(projected, null, 2)}\n`;
}

function git(args: string[], timeout?: number): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim();
}

function isAncestor(ancestor: string, descendant: string): boolean {
  const key = `${ancestor}:${descendant}`;
  const cached = ancestryCache.get(key);
  if (cached !== undefined) return cached;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root, stdio: 'ignore' });
    ancestryCache.set(key, true);
    return true;
  }
  catch {
    ancestryCache.set(key, false);
    return false;
  }
}

function occurrences(raw: string, pattern: RegExp): string[] {
  return [...raw.matchAll(pattern)].map((match) => match[1]);
}

function expectedIds(prefix: string, count: number, width: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(width, '0')}`);
}

function sameIds(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function commandSucceeded(evidence: RecordLike, targetHead: string): string | null {
  if (typeof evidence.command !== 'string' || evidence.command.trim().length === 0) return 'missing-command';
  if (evidence.exitCode !== 0) return 'nonzero-exit';
  if (typeof evidence.outputDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(evidence.outputDigest)) return 'missing-output-digest';
  if (typeof evidence.observedAt !== 'string' || Number.isNaN(Date.parse(evidence.observedAt))) return 'missing-observed-at';
  if (typeof evidence.sourceCommit !== 'string' || !/^[0-9a-f]{7,64}$/i.test(evidence.sourceCommit)) return 'missing-source-commit';
  if (targetHead === 'offline-unverified') return 'offline-no-ancestry';
  if (!isAncestor(evidence.sourceCommit, targetHead)) return 'source-commit-not-ancestor';
  const artifacts = Array.isArray(evidence.artifactPaths) ? evidence.artifactPaths : evidence.artifactPath ? [evidence.artifactPath] : [];
  if (artifacts.length === 0 || artifacts.some((artifact) => typeof artifact !== 'string' || !existsSync(path.resolve(root, artifact)))) return 'artifact-missing';
  return null;
}

export function isValidValidatorContract(contract: RecordLike): boolean {
  const contractId = String(contract?.contractId ?? '');
  const cardPath = typeof contract?.taskCardPath === 'string' ? contract.taskCardPath : '';
  return /^atm\.taskCardValidator\/ATM-GOV-\d+\/[0-9a-f]{64}$/.test(contractId)
    && /^ATM-GOV-\d+$/.test(String(contract?.taskId ?? ''))
    && typeof contract?.command === 'string'
    && /^sha256:[0-9a-f]{64}$/.test(String(contract?.taskCardDigest ?? ''))
    && cardPath.length > 0
    && existsSync(cardPath)
    && semanticTaskCardDigest(readFileSync(cardPath, 'utf8')) === contract.taskCardDigest;
}

function isWaveExitObserverContract(contract: RecordLike): boolean {
  const exitItemId = String(contract?.exitItemId ?? '');
  return contract?.kind === 'wave-exit-observer-receipt'
    && contract?.contractId === `atm.waveExitObserverReceipt/${exitItemId}`
    && /^EXIT-\d{2}$/.test(exitItemId)
    && contract?.evidenceOwner === `wave-exit-observer:${exitItemId}`
    && typeof contract?.command === 'string'
    && /^sha256:[0-9a-f]{64}$/.test(String(contract?.policyDigest ?? ''));
}

function waveExitObserverEvidenceFailure(contract: RecordLike, evidence: RecordLike, targetHead: string): string | null {
  const source = readWaveExitObserverPolicySourceAtCommit(root, targetHead);
  const policy = loadWaveExitObserverPolicyAtCommit(root, targetHead);
  const exitItemId = String(contract.exitItemId ?? '');
  const exit = policy?.exits[exitItemId];
  if (!source || !policy || !exit
    || contract.policyDigest !== digestWaveExitObserverPolicySource(source)
    || contract.command !== exit.command
    || evidence.evidenceOwner !== contract.evidenceOwner
    || evidence.command !== contract.command) return 'wave-receipt-contract-drift';
  const artifacts = Array.isArray(evidence.artifactPaths) ? evidence.artifactPaths : [];
  const receipts: unknown[] = [];
  for (const artifactPath of artifacts) {
    if (typeof artifactPath !== 'string' || !existsSync(path.resolve(root, artifactPath))) return 'wave-receipt-artifact-missing';
    try {
      receipts.push(JSON.parse(readFileSync(path.resolve(root, artifactPath), 'utf8')));
    } catch {
      return 'wave-receipt-artifact-invalid';
    }
  }
  const verdict = consumeWaveExitObserverReceiptCandidates({
    repoRoot: root,
    receipts,
    policy,
    compilationHead: targetHead,
    currentInputDigests: digestWaveExitObserverInputsAtCommit(root, exitItemId, exit, targetHead),
    policyDigestAtCompilationHead: digestWaveExitObserverPolicySource(source),
    isAncestor
  });
  const receipt = verdict.receipt;
  if (!receipt) return `wave-receipt-unproven:${verdict.diagnostics.join(',') || 'missing'}`;
  return receipt.command === evidence.command
    && receipt.stdoutDigest === evidence.outputDigest
    && receipt.observedHead === evidence.sourceCommit
    && receipt.artifactPath === artifacts[0]
    ? null
    : 'wave-receipt-evidence-mismatch';
}

export function inspectCompletion(raw: string, runbookRaw = '', targetHead = ''): RecordLike {
  const findings: string[] = [];
  const rowTokens = occurrences(raw, /"itemId"\s*:\s*"(RB-\d{3})"/g);
  const exitTokens = occurrences(raw, /"itemId"\s*:\s*"(EXIT-\d{2})"/g);
  const rowIds = [...new Set(rowTokens)].sort();
  const exitIds = [...new Set(exitTokens)].sort();
  if (rowTokens.length !== 112 || rowIds.length !== 112) findings.push(`row-count:${rowTokens.length}/${rowIds.length}/112`);
  if (exitTokens.length !== 11 || exitIds.length !== 11) findings.push(`wave-exit-count:${exitTokens.length}/${exitIds.length}/11`);
  try {
    const parsed = JSON.parse(raw);
    const expectedRows = expectedIds('RB', 112, 3);
    const expectedExits = expectedIds('EXIT', 11, 2);
    if (!Array.isArray(parsed.rows) || parsed.rows.length !== 112 || !sameIds(rowIds, expectedRows)) findings.push('rows-array-invalid');
    if (!Array.isArray(parsed.waveExits) || parsed.waveExits.length !== 11 || !sameIds(exitIds, expectedExits)) findings.push('wave-exits-array-invalid');
    if (parsed.expectedItemCount !== 112) findings.push('expected-item-count-invalid');
    const validatorContracts = new Map<string, RecordLike>();
    if (!Array.isArray(parsed.validatorContracts)) findings.push('validator-contract-registry-missing');
    else for (const contract of parsed.validatorContracts) {
      const contractId = String(contract?.contractId ?? '');
      const valid = isValidValidatorContract(contract) || isWaveExitObserverContract(contract);
      if (!valid || validatorContracts.has(contractId)) findings.push(`invalid-validator-contract:${contractId || 'missing'}`);
      else validatorContracts.set(contractId, contract);
    }
    const sourceLines = runbookRaw === '' ? [] : runbookRaw.replace(/^\uFEFF/, '').split(/\r?\n/);
    const allRows = [...(parsed.rows ?? []), ...(parsed.waveExits ?? [])] as RecordLike[];
    const sharedEvidence = new Map<string, RecordLike[]>();
    for (const row of allRows) {
      const certificateDerived = row.reviewStatus === 'certificate-derived';
      if (!['proven', 'unproven', 'unknown', 'deferred'].includes(String(row.status))) findings.push(`invalid-status:${String(row.itemId)}`);
      if (!certificateDerived && row.status !== 'proven') findings.push(`not-proven:${String(row.itemId)}`);
      const sourceLine = sourceLines[row.sourceLine - 1];
      if (runbookRaw !== '' && (typeof sourceLine !== 'string' || !sourceLine.includes(String(row.requirement ?? '')) || sha256(String(row.requirement ?? '')) !== row.requirementDigest)) {
        findings.push(`source-authority-mismatch:${String(row.itemId)}`);
      }
      if (row.status === 'proven' && (!Array.isArray(row.evidence) || row.evidence.length === 0)) findings.push(`proven-without-evidence:${String(row.itemId)}`);
      for (const evidence of Array.isArray(row.evidence) ? row.evidence : []) {
        const contract = validatorContracts.get(String(evidence?.validatorContractId ?? ''));
        const isWaveReceipt = !!contract && isWaveExitObserverContract(contract);
        if (!contract
          || (isWaveReceipt
            ? contract.evidenceOwner !== evidence?.evidenceOwner || contract.command !== evidence?.command
            : contract.taskId !== evidence?.evidenceOwner || contract.command !== evidence?.command)) {
          findings.push(`unregistered-validator-contract:${String(row.itemId)}`);
          continue;
        }
        const failure = !targetHead || !evidence || typeof evidence !== 'object' ? 'invalid-evidence' : commandSucceeded(evidence, targetHead);
        if (failure) findings.push(`evidence-${failure}:${String(row.itemId)}`);
        else if (isWaveReceipt) {
          const receiptFailure = waveExitObserverEvidenceFailure(contract, evidence, targetHead);
          if (receiptFailure) findings.push(`evidence-${receiptFailure}:${String(row.itemId)}`);
          else {
            const key = `${evidence.command}\u0000${evidence.sourceCommit}\u0000${evidence.outputDigest}`;
            sharedEvidence.set(key, [...(sharedEvidence.get(key) ?? []), row]);
          }
        }
        else {
          const key = `${evidence.command}\u0000${evidence.sourceCommit}\u0000${evidence.outputDigest}`;
          sharedEvidence.set(key, [...(sharedEvidence.get(key) ?? []), row]);
        }
      }
    }
    for (const rows of sharedEvidence.values()) if (rows.length > 1 && rows.some((row) => !Array.isArray(row.validatorContractIds) || row.validatorContractIds.length === 0)) {
      findings.push(`unregistered-shared-validator:${rows.map((row) => row.itemId).sort().join(',')}`);
    }
    return { parseable: true, rowTokens, rowIds, exitTokens, exitIds, parsed, findings };
  }
  catch (error) {
    findings.push(`completion-report-json-invalid:${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    return { parseable: false, rowTokens, rowIds, exitTokens, exitIds, findings };
  }
}

function upstream(): { remoteName: string; remoteRef: string; branch: string } {
  const upstreamRef = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const separator = upstreamRef.indexOf('/');
  if (separator <= 0 || separator === upstreamRef.length - 1) throw new Error(`invalid configured upstream: ${upstreamRef}`);
  return {
    remoteName: upstreamRef.slice(0, separator),
    remoteRef: upstreamRef,
    branch: upstreamRef.slice(separator + 1)
  };
}

export function sealedRemotePublishVerdict(targetHead: string, remoteHead: string): 'already-published' | 'not-proven' {
  if (!targetHead || !remoteHead) return 'not-proven';
  if (targetHead === remoteHead) return 'already-published';
  return isAncestor(targetHead, remoteHead) ? 'already-published' : 'not-proven';
}

function observeRemote(targetHead: string, offline = false, sealedRemote?: RecordLike): RecordLike {
  if (offline) return { fetched: false, pushVerdict: 'not-proven', error: 'remote-observation-disabled' };
  if (sealedRemote && typeof sealedRemote.remoteHead === 'string') {
    return sealedRemote;
  }
  try {
    // Freshness must never make the review wait indefinitely. A timeout is a
    // failed observation, not evidence that the remote is reachable.
    const configuredUpstream = upstream();
    git(['fetch', configuredUpstream.remoteName, configuredUpstream.branch], 5_000);
    const remoteHead = git(['rev-parse', configuredUpstream.remoteRef]);
    const aheadBehind = git(['rev-list', '--left-right', '--count', `${configuredUpstream.remoteRef}...${targetHead}`]).split(/\s+/).map(Number);
    const localContainsRemote = isAncestor(remoteHead, targetHead);
    const remoteContainsLocal = isAncestor(targetHead, remoteHead);
    return {
      fetched: true,
      configuredUpstream,
      localHead: targetHead,
      remoteHead,
      behind: aheadBehind[0],
      ahead: aheadBehind[1],
      localContainsRemote,
      remoteContainsLocal,
      pushVerdict: sealedRemotePublishVerdict(targetHead, remoteHead)
    };
  }
  catch (error) {
    return { fetched: false, pushVerdict: 'not-proven', error: error instanceof Error ? error.message : String(error) };
  }
}

export function compileReview(offline = false, sealedTargetHead?: string, sealedRemote?: RecordLike, projectionArtifactPath = projectionPathForOutput(outputPath)): RecordLike {
  const completionAbsolute = path.join(root, completionPath);
  const runbookAbsolute = path.resolve(root, runbookPath);
  if (!existsSync(completionAbsolute)) throw new Error(`missing completion evidence: ${completionPath}`);
  if (!existsSync(runbookAbsolute)) throw new Error(`missing runbook: ${runbookPath}`);
  const raw = readFileSync(completionAbsolute, 'utf8').replace(/^\uFEFF/, '');
  const projectedCompletion = projectCompletionForRunbookReview(raw);
  // Offline mode exists only for deterministic local regression tests. It
  // intentionally has no Git ancestry or remote-release authority.
  const targetHead = offline ? 'offline-unverified' : sealedTargetHead ?? git(['rev-parse', 'HEAD']);
  if (!offline && !/^[0-9a-f]{7,64}$/i.test(targetHead)) throw new Error('sealed review target must be a Git commit SHA');
  if (!offline && !isAncestor(targetHead, git(['rev-parse', 'HEAD']))) throw new Error('sealed review target is not an ancestor of the current HEAD');
  const inspected = inspectCompletion(projectedCompletion, readFileSync(runbookAbsolute, 'utf8'), targetHead);
  const remote = observeRemote(targetHead, offline, sealedRemote);
  const headAfterRemote = targetHead;
  const findings = [...inspected.findings];
  if (!inspected.parseable) findings.push('completion-report-unparseable');
  if (remote.pushVerdict !== 'already-published') findings.push('remote-release-not-proven');
  // Validation replays a sealed remote observation.  Its live ancestry check
  // happens below, after serialization; recording a new remote head here
  // would mutate the projection whenever any later governance commit lands.
  if (!offline && remote.fetched && sealedRemote === undefined) {
    try {
      const remoteHeadAfterReview = git(['ls-remote', remote.configuredUpstream.remoteName, `refs/heads/${remote.configuredUpstream.branch}`], 5_000).split(/\s+/)[0];
      remote.remoteHeadAfterReview = remoteHeadAfterReview || null;
      if (!remoteHeadAfterReview || remoteHeadAfterReview !== remote.remoteHead) findings.push('remote-moved-during-review');
    }
    catch (error) {
      remote.remoteHeadAfterReview = null;
      remote.remoteObservationAfterReviewError = error instanceof Error ? error.message : String(error);
      findings.push('remote-final-observation-not-proven');
    }
  }
  const generatedAt = offline ? '1970-01-01T00:00:00.000Z' : git(['show', '-s', '--format=%cI', targetHead]);
  const unsigned = {
    schemaId: 'atm.fourPlanIndependentReleaseReview.v1', specVersion: '0.1.0', reviewerId: 'reviewer-b-runbook-release-authority',
    reviewerRole: 'independent-runbook-wave-and-live-remote-reviewer', generatedAt, targetHead, headAfterRemote,
    inputDigests: [{ path: projectionArtifactPath, digest: sha256(projectedCompletion), projection: completionReviewProjection, sourcePath: completionPath }, { path: runbookPath, digest: sha256(readFileSync(runbookAbsolute)) }],
    completion: { parseable: inspected.parseable, rowTokenCount: inspected.rowTokens.length, uniqueRowCount: inspected.rowIds.length,
      waveExitTokenCount: inspected.exitTokens.length, uniqueWaveExitCount: inspected.exitIds.length, findings: inspected.findings },
    remote, findings: [...new Set(findings)].sort(), verdict: findings.length === 0 ? 'proven' : 'not-proven',
    nonClaims: ['does-not-read-independent-certificate', 'does-not-read-reviewer-a-output', 'does-not-assess-final-certificate-derived-state', 'does-not-authorize-release']
  };
  return { ...unsigned, reviewDigest: stableDigest(unsigned) };
}

function outputPathFromArgs(): string {
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex < 0) return outputPath;
  const value = process.argv[outputIndex + 1];
  if (!value || value.startsWith('--')) throw new Error('--output requires a path');
  return value;
}

function projectionPathForOutput(reportPath: string): string {
  return reportPath.endsWith('.json')
    ? reportPath.slice(0, -'.json'.length) + '.input.json'
    : `${reportPath}.input.json`;
}

function sealedRemoteFromProjection(absoluteOutput: string): RecordLike | undefined {
  if (!existsSync(absoluteOutput)) throw new Error('runbook release authority review is missing; rerun with --mode write');
  const prior = JSON.parse(readFileSync(absoluteOutput, 'utf8')) as RecordLike;
  return prior.remote && typeof prior.remote === 'object' ? prior.remote : undefined;
}

function assertSealedRemoteStillOnPublishedHistory(report: RecordLike): void {
  const liveRemote = git(['ls-remote', String(report.remote?.configuredUpstream?.remoteName ?? 'origin'), `refs/heads/${String(report.remote?.configuredUpstream?.branch ?? 'main')}`], 5_000).split(/\s+/)[0];
  if (!liveRemote) throw new Error('unable to observe live remote for sealed review replay');
  if (sealedRemotePublishVerdict(String(report.targetHead), liveRemote) !== 'already-published') {
    throw new Error('sealed review target is not an ancestor of the live remote');
  }
  const sealedRemoteHead = String(report.remote?.remoteHead ?? '');
  if (sealedRemoteHead && sealedRemotePublishVerdict(sealedRemoteHead, liveRemote) !== 'already-published') {
    throw new Error('live remote diverged from the sealed remote observation');
  }
}

function sealedTargetHeadFromProjection(absoluteOutput: string): string | undefined {
  if (!existsSync(absoluteOutput)) throw new Error('runbook release authority review is missing; rerun with --mode write');
  const prior = JSON.parse(readFileSync(absoluteOutput, 'utf8')) as RecordLike;
  if (typeof prior.targetHead !== 'string') throw new Error('runbook release authority review lacks a sealed targetHead; rerun with --mode write');
  return prior.targetHead;
}

function main(): void {
  const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';
  if (mode !== 'validate' && mode !== 'write') throw new Error(`unknown --mode ${String(mode)}; expected validate or write`);
  const absoluteOutput = path.resolve(root, outputPathFromArgs());
  const absoluteProjection = path.resolve(root, projectionPathForOutput(outputPathFromArgs()));
  const projectionArtifactPath = path.relative(root, absoluteProjection).replaceAll('\\', '/');
  const offline = process.argv.includes('--offline');
  // The evidence commit that stores this report is necessarily newer than its
  // target. Validation therefore replays the sealed target, while still
  // rejecting any change to the declared input digests or remote snapshot.
  const report = compileReview(
    offline,
    mode === 'validate' ? sealedTargetHeadFromProjection(absoluteOutput) : undefined,
    mode === 'validate' ? sealedRemoteFromProjection(absoluteOutput) : undefined,
    projectionArtifactPath
  );
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const projection = projectCompletionForRunbookReview(readFileSync(path.join(root, completionPath), 'utf8'));
  if (mode === 'write') {
    mkdirSync(path.dirname(absoluteOutput), { recursive: true });
    writeFileSync(absoluteProjection, projection, 'utf8');
    writeFileSync(absoluteOutput, serialized, 'utf8');
  }
  else if (!existsSync(absoluteOutput) || !existsSync(absoluteProjection)
    || readFileSync(absoluteOutput, 'utf8') !== serialized
    || readFileSync(absoluteProjection, 'utf8') !== projection) throw new Error('runbook release authority review is stale; rerun with --mode write');
  if (!offline && mode === 'validate') assertSealedRemoteStillOnPublishedHistory(report);
  console.log(`[review-runbook-release-authority] ${report.verdict} findings=${report.findings.length} digest=${report.reviewDigest}`);
}

if (process.argv[1]?.endsWith('review-runbook-release-authority.ts')) main();
