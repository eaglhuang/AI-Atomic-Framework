import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  EnforcementRow,
  ForwardingSummary,
  PolicyRow
} from './types.ts';

export function buildForwardingSummary(rows: readonly PolicyRow[], root: string): ForwardingSummary {
  let admissionForwarded = 0;
  let toApply = 0;
  let toValidator = 0;
  let toHuman = 0;
  let notForwarded = 0;
  for (const row of rows) {
    if (row.policy !== 'atm-full') continue;
    if (row.route === 'merge-with-tool') { admissionForwarded += 1; toApply += 1; continue; }
    if (row.caughtPhase === 'validator') { admissionForwarded += 1; toValidator += 1; continue; }
    if (row.route === 'block' && row.oracleVerdict !== row.route) { admissionForwarded += 1; toHuman += 1; continue; }
    notForwarded += 1;
  }
  const fieldPath = path.join(root, 'artifacts/field-evidence/admission/summary.json');
  const fieldEvidenceSourcePath = existsSync(fieldPath) ? path.relative(root, fieldPath).replace(/\\/g, '/') : 'not-applicable';
  if (fieldEvidenceSourcePath !== 'not-applicable') {
    try {
      const _ = JSON.parse(readFileSync(fieldPath, 'utf8'));
    } catch {
      // ignore parse errors; do not mix into baseline regardless
    }
  }
  return {
    schemaId: 'atm.admissionBenchForwardingSummary.v1',
    admissionForwardedCount: admissionForwarded,
    forwardedToApply: toApply,
    forwardedToValidator: toValidator,
    forwardedToHuman: toHuman,
    notForwarded,
    fieldEvidenceMixedIntoBaseline: false,
    fieldEvidenceSourcePath
  };
}

export function enforcementBoundaryRows(rows: readonly PolicyRow[]): readonly EnforcementRow[] {
  const buckets: Record<EnforcementRow['condition'], EnforcementRow> = {
    'unsafe-input': { schemaId: 'atm.admissionBenchEnforcementRow.v1', condition: 'unsafe-input', admissionCaught: 0, applyCaught: 0, validatorCaught: 0, silentMiss: 0, total: 0 },
    'safe-input': { schemaId: 'atm.admissionBenchEnforcementRow.v1', condition: 'safe-input', admissionCaught: 0, applyCaught: 0, validatorCaught: 0, silentMiss: 0, total: 0 },
    'mixed': { schemaId: 'atm.admissionBenchEnforcementRow.v1', condition: 'mixed', admissionCaught: 0, applyCaught: 0, validatorCaught: 0, silentMiss: 0, total: 0 },
    'adversarial-input': { schemaId: 'atm.admissionBenchEnforcementRow.v1', condition: 'adversarial-input', admissionCaught: 0, applyCaught: 0, validatorCaught: 0, silentMiss: 0, total: 0 }
  };
  for (const row of rows) {
    if (row.policy !== 'atm-full') continue;
    const condition: EnforcementRow['condition'] = row.oracleVerdict === 'admit-parallel' ? 'safe-input' : 'unsafe-input';
    const bucket = { ...buckets[condition] };
    bucket.total += 1;
    if (row.caughtPhase === 'admission') bucket.admissionCaught += 1;
    else if (row.caughtPhase === 'apply') bucket.applyCaught += 1;
    else if (row.caughtPhase === 'validator') bucket.validatorCaught += 1;
    else if (row.caughtPhase === 'silent-miss') bucket.silentMiss += 1;
    buckets[condition] = bucket;
  }
  return Object.values(buckets);
}
