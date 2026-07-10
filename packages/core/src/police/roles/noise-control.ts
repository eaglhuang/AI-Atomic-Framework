import type {
  NoiseControlGateInput,
  PoliceFinding,
  SharedGateReport
} from '../types.ts';
import { DEFAULT_POLICE_DAILY_CAP } from '../constants.ts';

export function runNoiseControlGate(input: NoiseControlGateInput = {}): SharedGateReport {
  const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
  const confidenceThreshold = input.confidenceThreshold ?? 0;
  const suppressed = new Set(input.suppressedKeys ?? []);
  const findings: PoliceFinding[] = [];
  const filteredOut: PoliceFinding[] = [];
  let suppressedCount = 0;
  let bypassedCount = 0;
  let admitted = 0;

  for (const finding of input.findings ?? []) {
    const key = (finding.metadata as Record<string, unknown> | undefined)?.suppressionKey;
    const isHighSeverity = finding.severity === 'block' || finding.severity === 'error';

    if (typeof key === 'string' && suppressed.has(key)) {
      if (isHighSeverity) {
        bypassedCount += 1;
        findings.push(finding);
        continue;
      }
      suppressedCount += 1;
      filteredOut.push(finding);
      continue;
    }
    const confidence = Number((finding.metadata as Record<string, unknown> | undefined)?.confidence ?? 1);
    if (Number.isFinite(confidence) && confidence < confidenceThreshold && !isHighSeverity) {
      suppressedCount += 1;
      filteredOut.push(finding);
      continue;
    }
    if (admitted >= dailyCap && !isHighSeverity) {
      suppressedCount += 1;
      filteredOut.push(finding);
      continue;
    }
    admitted += 1;
    findings.push(finding);
  }

  return {
    gate: 'noise-control',
    status: suppressedCount > 0 || bypassedCount > 0 ? 'advisory' : 'pass',
    findings,
    summary: { total: findings.length, suppressed: suppressedCount, bypassed: bypassedCount },
    sourceValidator: 'runNoiseControlGate'
  };
}
