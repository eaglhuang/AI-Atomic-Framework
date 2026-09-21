import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { WaveExitObserverExitPolicy } from './wave-exit-observer-receipt.ts';

const COMMIT_SHAPE = /^[0-9a-f]{40}$/;

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** Project compiler-derived metadata and receipt envelopes out of compiler-owned inputs. */
export function digestWaveExitObserverInput(
  exitItemId: string,
  exitPolicy: WaveExitObserverExitPolicy,
  inputPath: string,
  source: string
): string | null {
  if (exitPolicy.inputDigestProjection === 'objective-audit-excluding-certificate-result') {
    try {
      const audit = JSON.parse(source) as Record<string, unknown>;
      const { resultDigest: _derivedCertificateDigest, ...semanticAudit } = audit;
      return digestText(`${inputPath.replace(/\\/g, '/')}\n${JSON.stringify({
        ...semanticAudit,
        resultDigest: '<derived-final-certificate-digest>'
      })}`);
    } catch {
      return null;
    }
  }
  if (exitPolicy.inputDigestProjection === 'objective-audit-excluding-derived-conclusion') {
    try {
      const audit = JSON.parse(source) as Record<string, unknown>;
      // EXIT-07 observes the independently replayed objective rows.  The
      // surrounding certificate conclusion is compiler-owned output: it is
      // expected to change when reviewers, the release surface, or the final
      // certificate are refreshed.  Including that conclusion would make a
      // valid observation invalidate itself after an otherwise unrelated
      // closeout projection.
      const {
        status: _derivedCertificateStatus,
        releasePushProvenance: _derivedReleaseProvenance,
        independentReview: _derivedIndependentReview,
        legacyAuthority: _derivedLegacyAuthority,
        unknownRows: _derivedUnknownRows,
        unresolvedRows: _derivedUnresolvedRows,
        supersession: _derivedSupersession,
        resultDigest: _derivedCertificateDigest,
        ...semanticAudit
      } = audit;
      return digestText(`${inputPath.replace(/\\/g, '/')}\n${JSON.stringify({
        ...semanticAudit,
        certificateConclusion: '<derived-final-certificate-conclusion>'
      })}`);
    } catch {
      return null;
    }
  }
  if (exitPolicy.inputDigestProjection !== 'completion-report-excluding-current-exit') return digestText(source);
  try {
    const report = JSON.parse(source) as Record<string, unknown>;
    if (!Array.isArray(report.waveExits)) return null;
    const waveExits = report.waveExits.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const row = entry as Record<string, unknown>;
      if (row.itemId !== exitItemId) {
        const { evidence: _receiptEnvelope, ...semanticExit } = row;
        return semanticExit;
      }
      const { status, evidence, diagnostics, coverageOwners, validatorContractIds, ...identity } = row;
      return identity;
    });
    const authority = report.authority && typeof report.authority === 'object'
      ? { ...(report.authority as Record<string, unknown>), targetHead: '<compiler-target-head>', originMain: '<compiler-origin-main>' }
      : report.authority;
    const validatorContracts = Array.isArray(report.validatorContracts)
      ? report.validatorContracts.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          const { policyDigest, ...contract } = entry as Record<string, unknown>;
          return contract;
        })
      : report.validatorContracts;
    const projection = {
      ...report,
      generatedAt: '<compiler-projection-time>',
      overallVerdict: '<derived-from-all-exits>',
      authority,
      validatorContracts,
      unresolvedIds: Array.isArray(report.unresolvedIds) ? report.unresolvedIds.filter((id) => id !== exitItemId) : report.unresolvedIds,
      deferredIds: Array.isArray(report.deferredIds) ? report.deferredIds.filter((id) => id !== exitItemId) : report.deferredIds,
      unknownIds: Array.isArray(report.unknownIds) ? report.unknownIds.filter((id) => id !== exitItemId) : report.unknownIds,
      waveExits
    };
    return digestText(`${inputPath.replace(/\\/g, '/')}\n${JSON.stringify(projection)}`);
  } catch {
    return null;
  }
}

/** Compute policy-owned historical input digests without consulting live bytes. */
export function digestWaveExitObserverInputsAtCommit(
  repoRoot: string,
  exitItemId: string,
  exitPolicy: WaveExitObserverExitPolicy,
  commit: string
): Record<string, string> {
  const digests: Record<string, string> = {};
  if (!COMMIT_SHAPE.test(commit)) return digests;
  for (const inputPath of exitPolicy.inputs) {
    try {
      const body = execFileSync('git', ['show', `${commit}:${inputPath.replace(/\\/g, '/')}`], {
        cwd: repoRoot,
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const digest = digestWaveExitObserverInput(exitItemId, exitPolicy, inputPath, Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
      if (digest) digests[inputPath] = digest;
    } catch {
      // An absent sealed input deliberately stays absent for fail-closed validation.
    }
  }
  return digests;
}
