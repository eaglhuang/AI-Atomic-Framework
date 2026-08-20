import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

export interface FinalCertificateObservation {
  readonly proven: boolean;
  readonly diagnostics: string[];
}

export function summarizeFinalCertificate(certificate: unknown): FinalCertificateObservation {
  try {
    if (certificate === null || typeof certificate !== 'object') return { proven: false, diagnostics: ['final-certificate-unreadable'] };
    const record = certificate as Record<string, unknown>;
    const pending = JSON.stringify(record).includes('pending-self-digest');
    const diagnostics = Array.isArray(record.diagnostics) ? record.diagnostics : ['final-certificate-diagnostics-invalid'];
    const proven = record.status === 'proven'
      && record.overallVerdict === 'complete'
      && record.releaseAuthorized === true
      && diagnostics.length === 0
      && !pending;
    return { proven, diagnostics: proven ? [] : ['final-certificate-not-proven'] };
  } catch {
    return { proven: false, diagnostics: ['final-certificate-unreadable'] };
  }
}

export function observeSealedFinalCertificate(targetHead: string, certificatePath: string): FinalCertificateObservation {
  if (!/^[0-9a-f]{40}$/i.test(targetHead)) return { proven: false, diagnostics: ['final-certificate-target-invalid'] };
  try {
    const repoPath = relative(resolve('.'), resolve(certificatePath)).replace(/\\/g, '/');
    const source = execFileSync('git', ['show', `${targetHead}:${repoPath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return summarizeFinalCertificate(JSON.parse(source));
  } catch {
    return { proven: false, diagnostics: ['final-certificate-missing'] };
  }
}
