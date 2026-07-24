import { createHash } from 'node:crypto';

/**
 * Capability secrecy helpers for lane sessions.
 *
 * Ordinary reports (status, broker, runner-sync, taskflow, framework-mode,
 * dispatch summaries, worker reports) must never expose a replayable lane
 * session id, claim lease id, ticket key, or handoff token to a non-owner.
 * Callers project those secrets through {@link capabilityFingerprint} so a
 * reader can correlate state and audit trails without gaining the replayable
 * key itself.
 *
 * The fingerprint is a stable, non-invertible digest. It intentionally keeps a
 * human-readable prefix so diagnostics stay legible (`lane`, `ticket`, `lease`)
 * while withholding the underlying capability material.
 */

export type CapabilityFingerprintKind = 'lane' | 'ticket' | 'lease' | 'handoff' | 'capability';

const fingerprintLength = 16;

/** Field names that carry replayable capability material and must be redacted. */
export const replayableCapabilityFields = Object.freeze({
  laneSessionId: 'lane',
  laneId: 'lane',
  leaseId: 'lease',
  claimLeaseId: 'lease',
  ticketKey: 'ticket',
  ticketId: 'ticket',
  handoffToken: 'handoff',
  handoffTokenHash: 'handoff',
  capabilityKey: 'capability',
  nonce: 'capability',
  nonceHash: 'capability'
} satisfies Record<string, CapabilityFingerprintKind>);

export function capabilityFingerprint(value: string | null | undefined, kind: CapabilityFingerprintKind): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const digest = createHash('sha256').update(`${kind}\n${normalized}`).digest('hex').slice(0, fingerprintLength);
  return `${kind}fp:${digest}`;
}

export function laneFingerprint(laneSessionId: string | null | undefined): string | null {
  return capabilityFingerprint(laneSessionId, 'lane');
}

export function ticketFingerprint(ticketKey: string | null | undefined): string | null {
  return capabilityFingerprint(ticketKey, 'ticket');
}

/**
 * Deep-redact any replayable capability keys inside an arbitrary report object.
 * Whitelisted `viewerLaneSessionId`/`viewerLaneSessionIds` may be exempted so an
 * owner still receives its own live lane id (it already holds it). Every other
 * lane id, lease id, ticket key, or token is projected to a fingerprint.
 */
export function redactCapabilityKeys<T>(value: T, options: RedactCapabilityOptions = {}): T {
  const exempt = new Set((options.exemptLaneSessionIds ?? []).map((entry) => entry.trim()).filter(Boolean));
  return redactValue(value, exempt) as T;
}

export interface RedactCapabilityOptions {
  /** Lane session ids the viewer already owns; left un-redacted so owners keep their own key. */
  readonly exemptLaneSessionIds?: readonly string[];
}

function redactValue(value: unknown, exempt: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, exempt));
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      const kind = (replayableCapabilityFields as Record<string, CapabilityFingerprintKind>)[key];
      if (kind && typeof entry === 'string') {
        if (exempt.has(entry.trim())) {
          output[key] = entry;
        } else {
          output[key] = capabilityFingerprint(entry, kind) ?? null;
        }
        continue;
      }
      output[key] = redactValue(entry, exempt);
    }
    return output;
  }
  return value;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
