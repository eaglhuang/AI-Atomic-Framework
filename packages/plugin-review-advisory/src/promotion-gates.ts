/**
 * M4 Promotion Safety Gates
 *
 * Deterministic gates that evaluate whether a proposal is safe to promote.
 * These gates operate independently of the semantic advisory provider and
 * always apply before any promotion action.
 *
 * Gates:
 *  1. baseAtomVersionMismatch    – current atom version must match baseAtomVersion
 *  2. staleEvidenceWatermark     – evidence watermark must not be stale
 *  3. targetSurfaceDowngrade     – single-user evidence cannot target atom-spec
 *  4. breakingHumanReview        – breaking proposals must be reviewed by a human
 *  5. missingRedactionReport     – proposals that considered sensitive inputs must attach a redaction report
 */

export type PromotionSafetyGateName =
  | 'baseAtomVersionMismatch'
  | 'staleEvidenceWatermark'
  | 'targetSurfaceDowngrade'
  | 'breakingHumanReview'
  | 'missingRedactionReport';

export interface PromotionSafetyFinding {
  /** Gate that produced this finding. */
  gate: PromotionSafetyGateName;
  /** Whether this gate is blocking promotion. */
  blocked: boolean;
  /** Human-readable explanation. */
  reason: string;
  /** Suggested action to unblock. */
  remediation?: string;
}

export interface PromotionSafetyGateResult {
  /** True when all gates passed. */
  passed: boolean;
  /** Names of gates that blocked promotion. */
  blockedGates: PromotionSafetyGateName[];
  /** Per-gate detail. */
  findings: PromotionSafetyFinding[];
}

/**
 * Runtime context provided by the host or promotion layer.
 * All fields are optional; absent fields are treated as "not applicable" for that gate.
 */
export interface PromotionSafetyContext {
  /**
   * The current live version of the atom being targeted.
   * When provided, gate 1 compares it against proposal.baseAtomVersion.
   */
  currentAtomVersion?: string;
  /**
   * The current live version of the atom map being targeted.
   * When provided, gate 1 variant compares it against proposal.baseMapVersion.
   */
  currentMapVersion?: string;
  /**
   * True when a newer human decision has superseded the position recorded in
   * proposal.baseEvidenceWatermark.
   */
  isEvidenceWatermarkStale?: boolean;
  /**
   * True when all matched evidence was scoped to a single user or a single
   * host-local session (and therefore should not auto-promote to atom-spec).
   */
  evidenceScopeIsUserLocal?: boolean;
  /**
   * Explicitly set to false when the host knows the proposal considered
   * sensitive inputs but has not produced a redaction report.
   * When undefined, the gate falls back to checking proposal.inputs for a
   * 'redaction-report' entry.
   */
  hasRedactionReport?: boolean;
}

/**
 * Minimal proposal shape accepted by checkPromotionSafetyGates.
 * Compatible with the full atm.upgradeProposal JSON structure.
 */
export interface ProposalForSafetyCheck {
  baseAtomVersion?: string;
  baseMapVersion?: string;
  baseEvidenceWatermark?: string;
  targetSurface?: string;
  reversibility?: string;
  inputs?: Array<{ kind: string }>;
}

/**
 * Evaluate all M4 promotion safety gates against a proposal and context.
 *
 * @param proposal  A parsed upgrade proposal (or subset thereof).
 * @param context   Runtime context supplied by the host or promotion layer.
 * @returns         A PromotionSafetyGateResult with per-gate details.
 */
export function checkPromotionSafetyGates(
  proposal: ProposalForSafetyCheck,
  context: PromotionSafetyContext
): PromotionSafetyGateResult {
  const findings: PromotionSafetyFinding[] = [];

  // ── Gate 1: baseAtomVersion mismatch ──────────────────────────────────────
  const atomVersionMismatch =
    typeof proposal.baseAtomVersion === 'string' &&
    typeof context.currentAtomVersion === 'string' &&
    proposal.baseAtomVersion !== context.currentAtomVersion;

  const mapVersionMismatch =
    typeof proposal.baseMapVersion === 'string' &&
    typeof context.currentMapVersion === 'string' &&
    proposal.baseMapVersion !== context.currentMapVersion;

  if (atomVersionMismatch || mapVersionMismatch) {
    const expected = atomVersionMismatch ? proposal.baseAtomVersion : proposal.baseMapVersion;
    const current = atomVersionMismatch ? context.currentAtomVersion : context.currentMapVersion;
    findings.push({
      gate: 'baseAtomVersionMismatch',
      blocked: true,
      reason: `Base version ${expected} does not match current registry version ${current}. The target has evolved since this proposal was drafted.`,
      remediation: 'Rebase the proposal against the current registry version and re-run evidence scan before promoting.'
    });
  } else {
    findings.push({
      gate: 'baseAtomVersionMismatch',
      blocked: false,
      reason: 'Base version matches current registry version or version check is not applicable.'
    });
  }

  // ── Gate 2: stale evidence watermark ──────────────────────────────────────
  if (context.isEvidenceWatermarkStale === true && typeof proposal.baseEvidenceWatermark === 'string') {
    findings.push({
      gate: 'staleEvidenceWatermark',
      blocked: true,
      reason: `Evidence watermark "${proposal.baseEvidenceWatermark}" is stale; a newer human decision has superseded this evidence stream position.`,
      remediation: 'Re-scan evidence from the current watermark position and produce a fresh draft before promoting.'
    });
  } else {
    findings.push({
      gate: 'staleEvidenceWatermark',
      blocked: false,
      reason: 'Evidence watermark is current or watermark check is not applicable.'
    });
  }

  // ── Gate 3: target surface downgrade (single-user preference) ─────────────
  if (proposal.targetSurface === 'atom-spec' && context.evidenceScopeIsUserLocal === true) {
    findings.push({
      gate: 'targetSurfaceDowngrade',
      blocked: true,
      reason: 'Proposal references only single-user or host-local evidence. Promoting single-user preferences to atom-spec is not allowed.',
      remediation: 'Downgrade targetSurface to host-local-overlay, or collect cross-user evidence before requesting atom-spec promotion.'
    });
  } else {
    findings.push({
      gate: 'targetSurfaceDowngrade',
      blocked: false,
      reason: 'targetSurface is appropriate for the evidence scope, or the gate is not applicable.'
    });
  }

  // ── Gate 4: breaking reversibility must route to human review ─────────────
  if (proposal.reversibility === 'breaking') {
    findings.push({
      gate: 'breakingHumanReview',
      blocked: true,
      reason: 'reversibility is "breaking"; breaking proposals must receive explicit human review before promotion.',
      remediation: 'Obtain explicit human approval via the review queue before promoting this proposal.'
    });
  } else {
    findings.push({
      gate: 'breakingHumanReview',
      blocked: false,
      reason: 'reversibility is rollback-safe or not set; breaking human-review gate does not apply.'
    });
  }

  // ── Gate 5: missing redaction report ──────────────────────────────────────
  const hasRedactionInput =
    Array.isArray(proposal.inputs) &&
    proposal.inputs.some((inp) => inp.kind === 'redaction-report');

  const redactionBlocked =
    context.hasRedactionReport === false && !hasRedactionInput;

  if (redactionBlocked) {
    findings.push({
      gate: 'missingRedactionReport',
      blocked: true,
      reason: 'Proposal considered sensitive inputs but no redaction report is attached.',
      remediation: 'Produce a redaction report, remove all sensitive data from inputs, and attach the report before promoting.'
    });
  } else {
    findings.push({
      gate: 'missingRedactionReport',
      blocked: false,
      reason: 'Redaction report requirement is satisfied or not applicable to this proposal.'
    });
  }

  const blockedGates = findings
    .filter((f) => f.blocked)
    .map((f) => f.gate);

  return {
    passed: blockedGates.length === 0,
    blockedGates,
    findings
  };
}
