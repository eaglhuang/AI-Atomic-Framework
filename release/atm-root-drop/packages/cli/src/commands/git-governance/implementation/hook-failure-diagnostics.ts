import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  summarizePreCommitFailureEnvelope,
  type PreCommitFailureEnvelope
} from '../../hook/pre-commit/failure-envelope.ts';

export interface HookFailureDiagnosticReference {
  readonly reportPath: string;
  readonly reportSha256: string;
}

export interface HookFailureDiagnosticReport {
  readonly summary: string;
  readonly reference: HookFailureDiagnosticReference;
}

export function createHookFailureDiagnosticReport(input: {
  readonly cwd: string;
  readonly commitAttemptStatusPath: string;
  readonly stdout: string;
  readonly stderr: string;
}): HookFailureDiagnosticReport | null {
  const failureEnvelope = findFailureEnvelope(input.stdout) ?? findFailureEnvelope(input.stderr);
  if (!failureEnvelope) return null;
  const summary = summarizePreCommitFailureEnvelope(failureEnvelope);
  const reportPath = `${input.commitAttemptStatusPath}.hook-failure.json`;
  const bytes = `${JSON.stringify({
    schemaId: 'atm.governedHookFailureDiagnostic.v1',
    failureEnvelope,
    summary
  }, null, 2)}\n`;
  const absolutePath = path.join(input.cwd, reportPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, bytes, 'utf8');
  return {
    summary,
    reference: {
      reportPath,
      reportSha256: `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`
    }
  };
}

export function summarizeHookFailure(input: { readonly stdout: string; readonly stderr: string }): string | null {
  const failureEnvelope = findFailureEnvelope(input.stdout) ?? findFailureEnvelope(input.stderr);
  return failureEnvelope ? summarizePreCommitFailureEnvelope(failureEnvelope) : null;
}

function findFailureEnvelope(text: string): PreCommitFailureEnvelope | null {
  if (!text.trim()) return null;
  try {
    return findFailureEnvelopeInValue(JSON.parse(text));
  } catch {
    return null;
  }
}

function findFailureEnvelopeInValue(value: unknown): PreCommitFailureEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.schemaId === 'atm.validatorFailureEnvelope.v1' && record.ok === false) {
    return record as unknown as PreCommitFailureEnvelope;
  }
  if (record.failureEnvelope) {
    const explicit = findFailureEnvelopeInValue(record.failureEnvelope);
    if (explicit) return explicit;
  }
  for (const child of Object.values(record)) {
    const found = findFailureEnvelopeInValue(child);
    if (found) return found;
  }
  return null;
}
