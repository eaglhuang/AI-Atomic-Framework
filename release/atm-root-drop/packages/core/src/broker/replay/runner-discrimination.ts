import { createHash } from 'node:crypto';
import { sha256Digest } from '../census/index.ts';

export type RunnerRole = 'historical' | 'current';
export type RunnerProbeVerdict = 'red' | 'green' | 'unavailable';
export type RedGreenDiscriminationVerdict = 'red-green' | 'inconclusive';

export interface SealedRunnerIdentity {
  readonly schemaId: 'atm.sealedRunnerIdentity.v1';
  readonly role: RunnerRole;
  readonly entrypoint: string;
  readonly digest: string;
  readonly commitSha: string | null;
  readonly available: boolean;
}

export interface DiscriminationScenarioSeal {
  readonly schemaId: 'atm.runnerDiscriminationScenario.v1';
  readonly specVersion: '0.1.0';
  readonly scenarioId: string;
  readonly probeArgv: readonly string[];
  readonly assertionDigest: string;
  readonly thresholdDigest: string;
  readonly coverageDigest: string;
  readonly workloadDigest: string;
  /** Digest over scenario fields only — never includes runner digests. */
  readonly scenarioDigest: string;
}

export interface DiscriminationScenarioInput {
  readonly scenarioId: string;
  readonly probeArgv: readonly string[];
  readonly assertion: unknown;
  readonly thresholds: unknown;
  readonly coverage: unknown;
  readonly workload: unknown;
}

export interface RunnerProbeReceipt {
  readonly schemaId: 'atm.runnerProbeReceipt.v1';
  readonly role: RunnerRole;
  readonly runner: SealedRunnerIdentity;
  readonly scenarioDigest: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly executed: boolean;
  /** Counters derived from command output / event-state diffs only. */
  readonly counters: Readonly<Record<string, number>>;
  readonly verdict: RunnerProbeVerdict;
  readonly reason: string;
}

export interface RedGreenDiscriminationSummary {
  readonly schemaId: 'atm.runnerRedGreenDiscriminationSummary.v1';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly scenario: DiscriminationScenarioSeal;
  readonly historical: RunnerProbeReceipt;
  readonly current: RunnerProbeReceipt;
  readonly discrimination: RedGreenDiscriminationVerdict;
  readonly reason: string;
  readonly digest: string;
}

export function sealRunnerIdentity(input: {
  readonly role: RunnerRole;
  readonly entrypoint: string;
  readonly contentDigest: string;
  readonly commitSha?: string | null;
  readonly available: boolean;
}): SealedRunnerIdentity {
  if (!/^sha256:[a-f0-9]{64}$/.test(input.contentDigest)) {
    throw new Error('runner contentDigest must be sha256:<64-hex>');
  }
  return {
    schemaId: 'atm.sealedRunnerIdentity.v1',
    role: input.role,
    entrypoint: input.entrypoint,
    digest: input.contentDigest,
    commitSha: input.commitSha ?? null,
    available: input.available
  };
}

export function digestRunnerContent(content: string | Uint8Array): string {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

export function sealDiscriminationScenario(input: DiscriminationScenarioInput): DiscriminationScenarioSeal {
  const assertionDigest = sha256Digest(input.assertion);
  const thresholdDigest = sha256Digest(input.thresholds);
  const coverageDigest = sha256Digest(input.coverage);
  const workloadDigest = sha256Digest(input.workload);
  const withoutDigest = {
    schemaId: 'atm.runnerDiscriminationScenario.v1' as const,
    specVersion: '0.1.0' as const,
    scenarioId: input.scenarioId,
    probeArgv: [...input.probeArgv],
    assertionDigest,
    thresholdDigest,
    coverageDigest,
    workloadDigest
  };
  return {
    ...withoutDigest,
    scenarioDigest: sha256Digest(withoutDigest)
  };
}

/**
 * Derive failure/success counters from probe command output and optional
 * event/state diffs. Fixture-declared failureShapes are intentionally ignored.
 */
export function deriveProbeCounters(input: {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly eventStateDiff?: Readonly<Record<string, number>>;
}): Readonly<Record<string, number>> {
  const counters: Record<string, number> = {
    failureExitCount: 0,
    remainOpenCount: 0,
    readyToCloseCount: 0,
    blockerCount: 0,
    passCount: 0,
    failCount: 0,
    stderrSignalCount: 0
  };

  if (input.exitCode === null) {
    counters.unavailableCount = 1;
  } else if (input.exitCode === 0) {
    counters.failureExitCount = 0;
  } else {
    counters.failureExitCount = 1;
  }

  const parsed = tryParseJsonObject(input.stdout);
  if (parsed) {
    const verdict = readNestedString(parsed, ['evidence', 'verdict'])
      ?? readNestedString(parsed, ['verdict'])
      ?? readNestedString(parsed, ['evidence', 'status', 'finalVerdict']);
    if (verdict === 'remain-open' || verdict === 'failed' || verdict === 'red') {
      counters.remainOpenCount = 1;
      counters.failCount = 1;
    } else if (verdict === 'ready-to-close' || verdict === 'pass' || verdict === 'green') {
      counters.readyToCloseCount = 1;
      counters.passCount = 1;
    }

    const blockers = readNestedArray(parsed, ['evidence', 'blockers'])
      ?? readNestedArray(parsed, ['blockers']);
    if (blockers) {
      counters.blockerCount = blockers.length;
    }

    const faultCounters = readNestedObject(parsed, ['evidence', 'faultCounters'])
      ?? readNestedObject(parsed, ['faultCounters']);
    if (faultCounters) {
      for (const [key, value] of Object.entries(faultCounters)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          counters[key] = value;
        }
      }
    }
  } else {
    if (/\bremain-open\b/i.test(input.stdout) || /\bFAIL\b/.test(input.stdout)) {
      counters.failCount = 1;
      counters.remainOpenCount = 1;
    }
    if (/\bready-to-close\b/i.test(input.stdout) || /\bPASS\b/.test(input.stdout) || /\bok\b/i.test(input.stdout)) {
      counters.passCount = 1;
      counters.readyToCloseCount = 1;
    }
  }

  if (input.stderr.trim().length > 0) {
    const signalLines = input.stderr.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
    counters.stderrSignalCount = signalLines;
  }

  if (input.eventStateDiff) {
    for (const [key, value] of Object.entries(input.eventStateDiff)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        counters[key] = (counters[key] ?? 0) + value;
      }
    }
  }

  return counters;
}

export function classifyProbeVerdict(input: {
  readonly executed: boolean;
  readonly runnerAvailable: boolean;
  readonly exitCode: number | null;
  readonly counters: Readonly<Record<string, number>>;
}): { readonly verdict: RunnerProbeVerdict; readonly reason: string } {
  if (!input.runnerAvailable || !input.executed || input.exitCode === null) {
    return { verdict: 'unavailable', reason: 'runner unavailable or probe did not execute' };
  }

  const failureScore =
    (input.counters.failureExitCount ?? 0)
    + (input.counters.remainOpenCount ?? 0)
    + (input.counters.blockerCount ?? 0)
    + (input.counters.failCount ?? 0)
    + (input.counters.staleAuthorizationCount ?? 0)
    + (input.counters.dimensionMismatchedAuthorizationCount ?? 0)
    + (input.counters.releaseOrderDivergenceCount ?? 0)
    + (input.counters.closurePacketDivergenceCount ?? 0);

  const successScore =
    (input.counters.readyToCloseCount ?? 0)
    + (input.counters.passCount ?? 0);

  if (failureScore > 0) {
    return { verdict: 'red', reason: 'probe output exposed one or more failure counters' };
  }
  if (input.exitCode === 0 && successScore > 0) {
    return { verdict: 'green', reason: 'probe output cleared without failure counters' };
  }
  if (input.exitCode === 0 && successScore === 0 && failureScore === 0) {
    // Neutral zero-exit with no semantic verdict is treated as green only when
    // explicitly pass-marked; otherwise inconclusive at the pair level via red≠green rule.
    return { verdict: 'green', reason: 'probe exited 0 with no failure counters' };
  }
  return { verdict: 'red', reason: 'probe exited non-zero without success markers' };
}

export function buildRunnerProbeReceipt(input: {
  readonly role: RunnerRole;
  readonly runner: SealedRunnerIdentity;
  readonly scenarioDigest: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly executed: boolean;
  readonly eventStateDiff?: Readonly<Record<string, number>>;
}): RunnerProbeReceipt {
  if (input.runner.role !== input.role) {
    throw new Error(`runner role mismatch: receipt=${input.role} seal=${input.runner.role}`);
  }
  const counters = deriveProbeCounters({
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
    eventStateDiff: input.eventStateDiff
  });
  const classified = classifyProbeVerdict({
    executed: input.executed,
    runnerAvailable: input.runner.available,
    exitCode: input.exitCode,
    counters
  });
  return {
    schemaId: 'atm.runnerProbeReceipt.v1',
    role: input.role,
    runner: input.runner,
    scenarioDigest: input.scenarioDigest,
    command: input.command,
    exitCode: input.exitCode,
    stdoutDigest: digestRunnerContent(input.stdout),
    stderrDigest: digestRunnerContent(input.stderr),
    executed: input.executed,
    counters,
    verdict: classified.verdict,
    reason: classified.reason
  };
}

export function evaluateRedGreenDiscrimination(input: {
  readonly scenario: DiscriminationScenarioSeal;
  readonly historical: RunnerProbeReceipt;
  readonly current: RunnerProbeReceipt;
  readonly generatedAt?: string;
}): RedGreenDiscriminationSummary {
  if (input.historical.role !== 'historical' || input.current.role !== 'current') {
    throw new Error('discrimination requires historical and current probe receipts');
  }
  if (
    input.historical.scenarioDigest !== input.scenario.scenarioDigest
    || input.current.scenarioDigest !== input.scenario.scenarioDigest
  ) {
    throw new Error('both runners must execute the same sealed scenarioDigest');
  }
  if (input.historical.runner.digest === input.current.runner.digest) {
    // Same binary cannot prove historical vs current discrimination.
    const inconclusive = buildSummary(input, 'inconclusive', 'historical and current runner digests are identical');
    return inconclusive;
  }

  const historicalVerdict = input.historical.verdict;
  const currentVerdict = input.current.verdict;
  if (historicalVerdict === 'unavailable' || currentVerdict === 'unavailable') {
    return buildSummary(input, 'inconclusive', 'one or both runners could not execute the sealed probe');
  }
  if (historicalVerdict === 'red' && currentVerdict === 'green') {
    return buildSummary(input, 'red-green', 'historical runner is red and current runner is green on the same scenarioDigest');
  }
  return buildSummary(
    input,
    'inconclusive',
    `paired verdicts are not discriminating (historical=${historicalVerdict}, current=${currentVerdict})`
  );
}

export function validateRedGreenDiscriminationSummary(summary: unknown): string[] {
  const findings: string[] = [];
  if (!summary || typeof summary !== 'object') {
    return ['summary-missing-or-non-object'];
  }
  const value = summary as Partial<RedGreenDiscriminationSummary> & Record<string, unknown>;
  if (value.schemaId !== 'atm.runnerRedGreenDiscriminationSummary.v1') {
    findings.push('unsupported-or-missing-schemaId');
  }
  if (value.specVersion !== '0.1.0') {
    findings.push('unsupported-or-missing-specVersion');
  }
  if (!value.scenario || typeof value.scenario !== 'object') {
    findings.push('missing-scenario-seal');
  } else {
    const scenario = value.scenario as DiscriminationScenarioSeal;
    if (!scenario.scenarioDigest || !/^sha256:[a-f0-9]{64}$/.test(scenario.scenarioDigest)) {
      findings.push('invalid-scenarioDigest');
    }
  }
  for (const role of ['historical', 'current'] as const) {
    const receipt = value[role] as RunnerProbeReceipt | undefined;
    if (!receipt || typeof receipt !== 'object') {
      findings.push(`missing-${role}-receipt`);
      continue;
    }
    if (receipt.schemaId !== 'atm.runnerProbeReceipt.v1') {
      findings.push(`invalid-${role}-receipt-schema`);
    }
    if (!receipt.runner || receipt.runner.schemaId !== 'atm.sealedRunnerIdentity.v1') {
      findings.push(`missing-${role}-runner-seal`);
    }
    if (!receipt.counters || typeof receipt.counters !== 'object') {
      findings.push(`missing-${role}-derived-counters`);
    }
    if ('failureShapes' in (receipt as object)) {
      findings.push(`${role}-receipt-must-not-embed-failureShapes`);
    }
  }
  if (value.discrimination !== 'red-green' && value.discrimination !== 'inconclusive') {
    findings.push('invalid-discrimination-verdict');
  }
  if (typeof value.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.digest)) {
    findings.push('invalid-summary-digest');
  } else {
    const recomputed = digestDiscriminationSummary(value as RedGreenDiscriminationSummary);
    if (recomputed !== value.digest) {
      findings.push('summary-digest-mismatch');
    }
  }
  return findings;
}

function buildSummary(
  input: {
    readonly scenario: DiscriminationScenarioSeal;
    readonly historical: RunnerProbeReceipt;
    readonly current: RunnerProbeReceipt;
    readonly generatedAt?: string;
  },
  discrimination: RedGreenDiscriminationVerdict,
  reason: string
): RedGreenDiscriminationSummary {
  const withoutDigest = {
    schemaId: 'atm.runnerRedGreenDiscriminationSummary.v1' as const,
    specVersion: '0.1.0' as const,
    generatedAt: input.generatedAt ?? new Date(0).toISOString(),
    scenario: input.scenario,
    historical: input.historical,
    current: input.current,
    discrimination,
    reason
  };
  return {
    ...withoutDigest,
    digest: sha256Digest(withoutDigest)
  };
}

function digestDiscriminationSummary(summary: RedGreenDiscriminationSummary): string {
  const { digest: _digest, ...withoutDigest } = summary;
  return sha256Digest(withoutDigest);
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readNestedString(root: Record<string, unknown>, pathParts: readonly string[]): string | null {
  let cursor: unknown = root;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === 'string' ? cursor : null;
}

function readNestedArray(root: Record<string, unknown>, pathParts: readonly string[]): unknown[] | null {
  let cursor: unknown = root;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return Array.isArray(cursor) ? cursor : null;
}

function readNestedObject(root: Record<string, unknown>, pathParts: readonly string[]): Record<string, unknown> | null {
  let cursor: unknown = root;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor && typeof cursor === 'object' && !Array.isArray(cursor)
    ? cursor as Record<string, unknown>
    : null;
}
