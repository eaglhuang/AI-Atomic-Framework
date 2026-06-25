import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PaperProfileSummary } from './types.ts';

function fmt(n: number, suffix = ''): string {
  if (!Number.isFinite(n)) return 'not-applicable';
  return `${n}${suffix}`;
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return 'not-applicable';
  return `${(n * 100).toFixed(2)}%`;
}

function cell(value: string | number | undefined | null | boolean): string {
  if (value === '' || value === undefined || value === null) return 'not-applicable';
  return String(value);
}

export function renderPaperTables(summary: PaperProfileSummary): string {
  const lines: string[] = [];
  lines.push('# ATM-AdmissionBench v0.2 — Paper Tables');
  lines.push('');
  lines.push(`Seed: \`${summary.seed}\` · Contract: v0.2 · Track: \`${summary.track}\` · Primary denominator: ${summary.primaryDenominator} mode-comparisons (unresolved set excluded).`);
  lines.push('');
  lines.push('## Table 1 — Policy Comparison');
  lines.push('');
  lines.push('| Policy | Scenarios | False-safe | Over-serialization | Route F1 | Intent preservation | p95 latency |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const row of summary.policyAggregates) {
    lines.push(`| ${row.policy} | ${cell(row.scenarios)} | ${cell(row.falseSafe)} | ${cell(row.overSerialization)} | ${cell(row.routeF1)} | ${pct(row.intentPreservation)} | ${cell(row.p95LatencyNs)} |`);
  }
  lines.push('');
  lines.push('## Table 2 — Ablation');
  lines.push('');
  lines.push('| Variant | Δ false-safe | Δ over-serialization | Δ E2E success | Main affected families |');
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const row of summary.ablationAggregates) {
    const families = row.mainAffectedFamilies.length === 0 ? 'not-applicable' : row.mainAffectedFamilies.join('; ');
    lines.push(`| ${row.variant} | ${fmt(row.deltaFalseSafe)} | ${fmt(row.deltaOverSerialization)} | ${fmt(row.deltaE2ESuccess)} | ${families} |`);
  }
  lines.push('');
  lines.push('## Table 3 — Enforcement and Trust Boundary');
  lines.push('');
  lines.push('| Condition | Admission caught | Apply caught | Validator caught | Silent miss | Total |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of summary.enforcementAggregates) {
    lines.push(`| ${row.condition} | ${cell(row.admissionCaught)} | ${cell(row.applyCaught)} | ${cell(row.validatorCaught)} | ${cell(row.silentMiss)} | ${cell(row.total)} |`);
  }
  lines.push('');
  lines.push(`Forwarding summary: admission-forwarded=${summary.forwarding.admissionForwardedCount} (→apply ${summary.forwarding.forwardedToApply}, →validator ${summary.forwarding.forwardedToValidator}, →human ${summary.forwarding.forwardedToHuman}); not-forwarded=${summary.forwarding.notForwarded}. Field evidence source: ${summary.forwarding.fieldEvidenceSourcePath}. Field evidence mixed into policy baseline denominator: ${summary.forwarding.fieldEvidenceMixedIntoBaseline ? 'yes' : 'no'}.`);
  lines.push('');
  return lines.join('\n');
}

export function renderMainResults(summary: PaperProfileSummary): string {
  const lines: string[] = [];
  lines.push('# ATM-AdmissionBench v0.2 — Paper Profile Main Results');
  lines.push('');
  lines.push(`- Profile: \`paper\`, contract version 0.2, track \`${summary.track}\`, seed \`${summary.seed}\`.`);
  lines.push(`- Frozen denominator: ${summary.scenarioCount} scenarios, ${summary.modeComparisons} mode comparisons (v0.1 corpus).`);
  lines.push(`- Primary metrics denominator: ${summary.primaryDenominator} (unresolved set excluded).`);
  lines.push(`- Unresolved entries: ${summary.unresolvedCount}.`);
  lines.push(`- Policy rows: ${summary.policyRows}, ablation rows: ${summary.ablationRows}, adversarial rows: ${summary.adversarialRows}, enforcement rows: ${summary.enforcementRows}.`);
  lines.push(`- atm-full false-safe count: ${summary.atmFullFalseSafeCount}.`);
  lines.push('');
  lines.push('See `paper-tables.md` for the three paper-facing tables; detailed scenario × policy data is in `policy-comparison.csv`.');
  lines.push('');
  return lines.join('\n');
}

export function renderFromArtifactDir(dir: string): void {
  const summaryPath = path.join(dir, 'summary.json');
  if (!existsSync(summaryPath)) {
    throw new Error(`paper artifacts missing: ${summaryPath}`);
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as PaperProfileSummary;
  for (const required of ['run-manifest.json', 'policy-comparison.csv', 'ablation.csv', 'enforcement-boundary.csv', 'unresolved-set.json', 'generator-manifest.json']) {
    if (!existsSync(path.join(dir, required))) {
      throw new Error(`paper artifacts missing: ${required}`);
    }
  }
  writeFileSync(path.join(dir, 'paper-tables.md'), renderPaperTables(summary), 'utf8');
}
