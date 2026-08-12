#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFourPlanObjectiveVerdict,
  type FourPlanObjectiveRow,
  type ObjectiveVerdictStatus
} from '../packages/core/src/evidence/plan-closeout-dashboard.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultMatrixPath = path.join(root, 'governance-optimization', 'plan-3x-4x-objective-audit-2026-07-31.json');

function parseArgs(argv: string[]) {
  const options = { mode: 'validate', input: defaultMatrixPath, json: false, plan: null as string | null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      options.mode = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--input') {
      options.input = path.resolve(root, String(argv[++index] ?? ''));
      continue;
    }
    if (arg === '--plan') {
      options.plan = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-four-plan-objectives.ts --mode validate [--input <json>] [--plan 3.0|3.1|3.2|4.0] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function rowsFromAudit(value: any): FourPlanObjectiveRow[] {
  if (Array.isArray(value?.rows)) return normalizeRows(value.rows);
  if (Array.isArray(value?.objectives)) return normalizeRows(value.objectives);
  const plans = value?.plans && typeof value.plans === 'object' ? value.plans : null;
  if (plans) {
    return Object.entries(plans).flatMap(([planId, entries]) =>
      Array.isArray(entries) ? normalizeRows(entries.map((entry: any, index) => ({ ...entry, planId, objectiveId: entry.objectiveId ?? entry.id ?? `${index + 1}` }))) : []
    );
  }
  return [];
}

function normalizeRows(rows: readonly any[]): FourPlanObjectiveRow[] {
  return rows.flatMap((row, index) => {
    const planId = normalizePlanId(row.planId ?? row.plan ?? row.planName);
    const status = normalizeStatus(row.status ?? row.verdict ?? row.disposition);
    const evidenceRefs = evidenceRefsFor(row);
    if (row.objectiveId == null && row.id == null && row.objective == null && row.plan != null) {
      const count = expectedCountFor(planId);
      return Array.from({ length: count }, (_, objectiveIndex) => ({
        planId,
        objectiveId: `OBJ-${String(objectiveIndex + 1).padStart(2, '0')}`,
        status,
        evidenceRefs,
        summary: row.summary == null ? null : String(row.summary ?? row.nonClaims?.[0] ?? '')
      }));
    }
    return [{
      planId,
      objectiveId: String(row.objectiveId ?? row.id ?? row.objective ?? `OBJ-${index + 1}`).trim(),
      status,
      evidenceRefs,
      summary: row.summary == null ? null : String(row.summary)
    }];
  });
}

function evidenceRefsFor(row: any): string[] {
  if (Array.isArray(row.evidenceRefs)) return row.evidenceRefs.map(String);
  if (Array.isArray(row.evidence)) return row.evidence.map(String);
  if (Array.isArray(row.evidenceTuples)) return row.evidenceTuples.map((entry: any) => String(entry?.source ?? '')).filter(Boolean);
  return [];
}

function expectedCountFor(planId: FourPlanObjectiveRow['planId']): number {
  if (planId === 'Plan 3.1') return 23;
  if (planId === 'Plan 3.2') return 29;
  if (planId === 'Plan 4.0') return 17;
  return 17;
}

function normalizePlanId(value: unknown): FourPlanObjectiveRow['planId'] {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('3.1')) return 'Plan 3.1';
  if (text.includes('3.2')) return 'Plan 3.2';
  if (text.includes('4.0')) return 'Plan 4.0';
  return 'Plan 3.0';
}

function normalizeStatus(value: unknown): ObjectiveVerdictStatus {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('conflict')) return 'conflicting';
  if (text.includes('unknown') || text.includes('unavailable')) return 'unknown';
  if (text.includes('not') || text.includes('incomplete') || text.includes('open') || text.includes('fail')) return 'not-complete';
  if (text.includes('verified') || text.includes('pass') || text.includes('done') || text.includes('satisfied')) return 'verified';
  return 'unknown';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode !== 'validate') throw new Error(`unsupported mode: ${options.mode}`);
  if (!existsSync(options.input)) throw new Error(`objective audit input missing: ${path.relative(root, options.input)}`);
  const parsed = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const rows = rowsFromAudit(parsed).filter((row) => options.plan ? row.planId === normalizePlanId(options.plan) : true);
  const verdict = buildFourPlanObjectiveVerdict({
    generatedAt: new Date(0).toISOString(),
    rows
  });
  const outputVerdict = options.plan ? {
    ...verdict,
    findings: verdict.findings.filter((finding) => finding.includes(normalizePlanId(options.plan))),
    status: verdict.findings.some((finding) => finding.includes(normalizePlanId(options.plan))) ? 'not-ready' : 'ready'
  } : verdict;
  if (options.json) {
    console.log(JSON.stringify(outputVerdict, null, 2));
  } else if (outputVerdict.status === 'ready') {
    console.log(`[validate-four-plan-objectives] ok ${JSON.stringify(outputVerdict.observedDenominators)} digest=${outputVerdict.sortedRowDigest}`);
  } else {
    console.error(`[validate-four-plan-objectives] failed: ${outputVerdict.findings.join('; ')}`);
  }
  process.exit(outputVerdict.status === 'ready' ? 0 : 1);
}

main();
