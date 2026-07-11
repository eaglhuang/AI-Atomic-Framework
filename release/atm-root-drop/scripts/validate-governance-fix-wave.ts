#!/usr/bin/env node
/**
 * TASK-RFT-0011 — validate-governance-fix-wave.ts
 *
 * Deterministic gate that verifies the three ATM governance defects fixed by
 * TASK-RFT-0011 remain wired end-to-end:
 *
 *   Fix #1 — taskflow auto-evidence npm-script mapping
 *   Fix #2 — tasks import reset-open UX classifier
 *   Fix #3 — next --claim admission uses conflict-matrix parity
 *
 * The gate runs the three unit specs and asserts that the three policy
 * modules and their spec files exist. It is registered as
 * `npm run validate:governance-fix-wave` so the auto-evidence mapper itself
 * gets exercised via the dogfood npm-script path.
 *
 * Usage:
 *   npm run validate:governance-fix-wave
 *   node --strip-types scripts/validate-governance-fix-wave.ts
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const specFiles = [
  'packages/cli/src/commands/taskflow/__tests__/auto-evidence-mapper.spec.ts',
  'packages/cli/src/commands/tasks/__tests__/import-reset-open-ux.spec.ts',
  'packages/cli/src/commands/next/__tests__/claim-admission-broker-parity.spec.ts'
];

const requiredExports: Array<{ file: string; symbols: string[] }> = [
  {
    file: 'packages/cli/src/commands/taskflow/auto-evidence-mapper.ts',
    symbols: ['mapAutoEvidenceCommand']
  },
  {
    file: 'packages/cli/src/commands/tasks/import-verify.ts',
    symbols: ['classifyResetOpenImport']
  },
  {
    file: 'packages/cli/src/commands/next/claim-admission.ts',
    symbols: ['evaluateClaimAdmission', 'detectBrokerCidDivergence', 'isBrokerVerdictAdmissible']
  }
];

interface SpecOutcome {
  readonly file: string;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stderrSnippet: string;
}

const outcomes: SpecOutcome[] = [];
let allOk = true;

for (const rel of specFiles) {
  const abs = resolve(repoRoot, rel);
  if (!existsSync(abs)) {
    outcomes.push({ file: rel, ok: false, exitCode: -1, stderrSnippet: 'spec file missing' });
    allOk = false;
    continue;
  }
  const result = spawnSync(process.execPath, ['--strip-types', abs], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  const ok = result.status === 0;
  outcomes.push({
    file: rel,
    ok,
    exitCode: result.status ?? -1,
    stderrSnippet: (result.stderr ?? '').split('\n').slice(-6).join('\n').trim()
  });
  if (!ok) allOk = false;
}

interface ExportCheck {
  readonly file: string;
  readonly symbol: string;
  readonly ok: boolean;
}

const exportChecks: ExportCheck[] = [];
for (const req of requiredExports) {
  const abs = resolve(repoRoot, req.file);
  if (!existsSync(abs)) {
    for (const sym of req.symbols) {
      exportChecks.push({ file: req.file, symbol: sym, ok: false });
    }
    allOk = false;
    continue;
  }
  const src = readFileSync(abs, 'utf8');
  for (const sym of req.symbols) {
    // Match `export function <sym>` / `export const <sym>` / `export {  ..., <sym>, ...  }`
    const re = new RegExp(
      `export\\s+(?:async\\s+)?(?:function|const|let|var|class|type|interface)\\s+${sym}\\b`
        + `|export\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}`
    );
    const ok = re.test(src);
    exportChecks.push({ file: req.file, symbol: sym, ok });
    if (!ok) allOk = false;
  }
}

const report = {
  schemaId: 'atm.governanceFixWaveReport.v1',
  specVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  taskId: 'TASK-RFT-0011',
  ok: allOk,
  specOutcomes: outcomes,
  exportChecks
};

console.log(JSON.stringify(report, null, 2));
if (!allOk) {
  console.error('[validate-governance-fix-wave] one or more checks failed');
  process.exit(1);
}
process.exit(0);
