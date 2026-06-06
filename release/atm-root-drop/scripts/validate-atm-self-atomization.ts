#!/usr/bin/env node
/**
 * validate-atm-self-atomization.ts
 *
 * 對應: TASK-ASA-0016 — 100% self-atomization graduation gate
 *
 * 行為：
 * - 讀取 atomic_workbench/graduation-gate/final-checklist.json
 * - 對每個 criterion 驗證當前 repo 狀態
 * - 計算 graduation status (graduated / blocked-by-rollback-evidence / blocked-by-coverage)
 * - 輸出 atom.atmSelfAtomizationGraduationReport.v1
 * - exit 0 = graduated; exit 1 = blocked
 *
 * 使用：
 *   npm run validate:atm-self-atomization
 *   node --strip-types scripts/validate-atm-self-atomization.ts --mode validate
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FinalChecklist {
  schemaId?: string;
  criteria: Array<{
    name: string;
    description: string;
    source: string;
    threshold?: { fail: number; pass: number };
    requiredState?: 'pass' | 'pass-or-explicit-exclusion';
  }>;
}

interface DogfoodScore {
  overall_atomization_score?: number;
  grade?: string;
  scores?: Record<string, number>;
}

interface GraduationCriterion {
  name: string;
  description: string;
  source: string;
  currentValue: number | string | null;
  threshold?: { fail: number; pass: number };
  status: 'pass' | 'fail' | 'warn' | 'unknown';
  remediation?: string;
}

interface GraduationReport {
  schemaId: 'atm.atmSelfAtomizationGraduationReport.v1';
  specVersion: '1.0.0';
  generatedAt: string;
  mode: 'validate' | 'gate';
  repo: string;
  graduationStatus: 'graduated' | 'blocked';
  criteriaCount: number;
  passedCount: number;
  blockedCount: number;
  warningCount: number;
  criteria: GraduationCriterion[];
  blockingCriteria: string[];
  remediationActions: string[];
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function evaluateChecklist(repoRoot: string): GraduationReport {
  const checklistPath = resolve(repoRoot, 'atomic_workbench', 'graduation-gate', 'final-checklist.json');
  const dogfoodScorePath = resolve(repoRoot, 'atomic_workbench', 'atomization-coverage', 'dogfood-score.json');
  const checklist = readJson<FinalChecklist>(checklistPath);
  const score = readJson<DogfoodScore>(dogfoodScorePath);

  if (!checklist) {
    return {
      schemaId: 'atm.atmSelfAtomizationGraduationReport.v1',
      specVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      mode: 'validate',
      repo: repoRoot,
      graduationStatus: 'blocked',
      criteriaCount: 0,
      passedCount: 0,
      blockedCount: 1,
      warningCount: 0,
      criteria: [],
      blockingCriteria: ['final-checklist.json missing'],
      remediationActions: ['Create atomic_workbench/graduation-gate/final-checklist.json per TASK-ASA-0016 schema']
    };
  }

  const criteria: GraduationCriterion[] = [];
  const blocking: string[] = [];
  const remediations: string[] = [];
  let passed = 0;
  let warn = 0;

  for (const c of checklist.criteria) {
    let currentValue: number | string | null = null;
    let status: 'pass' | 'fail' | 'warn' | 'unknown' = 'unknown';
    let remediation: string | undefined;

    // Look up current value based on source
    if (c.source.startsWith('dogfood-score.scores.')) {
      const key = c.source.replace('dogfood-score.scores.', '');
      currentValue = score?.scores?.[key] ?? null;
    } else if (c.source === 'dogfood-score.overall_atomization_score') {
      currentValue = score?.overall_atomization_score ?? null;
    } else if (c.source.startsWith('report-exists:')) {
      const reportPath = c.source.replace('report-exists:', '');
      currentValue = existsSync(resolve(repoRoot, reportPath)) ? 'exists' : 'missing';
    }

    // Evaluate threshold or required state
    if (c.threshold && typeof currentValue === 'number') {
      if (currentValue >= c.threshold.pass) {
        status = 'pass';
        passed += 1;
      } else if (currentValue >= c.threshold.fail) {
        status = 'warn';
        warn += 1;
        remediation = `${c.name}: ${currentValue} < pass threshold ${c.threshold.pass}; raise via TASK-ASA-0016 follow-up.`;
      } else {
        status = 'fail';
        blocking.push(c.name);
        remediation = `${c.name}: ${currentValue} < fail threshold ${c.threshold.fail}; release-blocking.`;
      }
    } else if (c.requiredState && typeof currentValue === 'string') {
      if (currentValue === 'exists' || currentValue === 'pass') {
        status = 'pass';
        passed += 1;
      } else {
        status = 'fail';
        blocking.push(c.name);
        remediation = `${c.name}: required state not met (got ${currentValue}).`;
      }
    } else if (currentValue === null) {
      status = 'unknown';
      remediation = `${c.name}: data not found at ${c.source}`;
    }

    if (remediation) remediations.push(remediation);
    criteria.push({
      name: c.name,
      description: c.description,
      source: c.source,
      currentValue,
      threshold: c.threshold,
      status,
      remediation
    });
  }

  const graduated = blocking.length === 0;
  return {
    schemaId: 'atm.atmSelfAtomizationGraduationReport.v1',
    specVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode: 'validate',
    repo: repoRoot,
    graduationStatus: graduated ? 'graduated' : 'blocked',
    criteriaCount: criteria.length,
    passedCount: passed,
    blockedCount: blocking.length,
    warningCount: warn,
    criteria,
    blockingCriteria: blocking,
    remediationActions: [...new Set(remediations)]
  };
}

function parseArgs(argv: string[]): { mode: 'validate' | 'gate'; repo: string } {
  let mode: 'validate' | 'gate' = 'validate';
  let repo = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode') {
      const v = argv[i + 1];
      if (v === 'validate' || v === 'gate') mode = v;
      i += 1;
    } else if (arg === '--repo' || arg === '--cwd') {
      repo = argv[i + 1] ?? repo;
      i += 1;
    }
  }
  return { mode, repo };
}

const { mode, repo } = parseArgs(process.argv.slice(2));
const report = evaluateChecklist(resolve(repo));
report.mode = mode;
const banner = `[atm-self-atomization:${mode}] ${report.graduationStatus} (passed=${report.passedCount}, blocked=${report.blockedCount}, warn=${report.warningCount}, total=${report.criteriaCount})`;
console.log(banner);
if (process.argv.includes('--json') || process.env.ATM_VALIDATE_OUTPUT === 'json') {
  console.log(JSON.stringify(report, null, 2));
}
process.exit(report.graduationStatus === 'graduated' ? 0 : 1);
