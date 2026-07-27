import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

type ProductionWorktreeClass = 'emergency-anomaly-recovery' | 'historical-read-only-discrimination' | 'non-development-sealed-packaging';

type CensusFinding = {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
  readonly production: boolean;
  readonly classification: ProductionWorktreeClass | 'test-or-fixture' | 'unclassified';
  readonly receiptContract: string | null;
};

const root = process.cwd();
const productionRoots = ['packages', 'scripts'];
const testRoots = ['tests'];
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'release']);
const productionReceipts: Readonly<Record<string, { readonly classification: ProductionWorktreeClass; readonly receiptContract: string }>> = {
  'scripts/run-sealed-runner-build.ts': {
    classification: 'non-development-sealed-packaging',
    receiptContract: 'atm.runnerSyncReceipt.v1'
  },
  'scripts/validate-framework-development-governance.ts': {
    classification: 'historical-read-only-discrimination',
    receiptContract: 'atm.frameworkWorktreeReadinessReceipt.v1'
  },
  'packages/cli/src/commands/validation-obligations.ts': {
    classification: 'non-development-sealed-packaging',
    receiptContract: 'atm.validationObligationCleanCheckoutReceipt.v1'
  }
};

const findings = [
  ...scanRoots(productionRoots, true),
  ...scanRoots(testRoots, false)
].sort((left, right) => `${left.file}:${left.line}`.localeCompare(`${right.file}:${right.line}`));
const unclassified = findings.filter((finding) => finding.production && finding.classification === 'unclassified');

const report = {
  schemaId: 'atm.worktreeCallsiteCensus.v1',
  ok: unclassified.length === 0,
  closedProductionClasses: [
    'emergency-anomaly-recovery',
    'historical-read-only-discrimination',
    'non-development-sealed-packaging'
  ] satisfies ProductionWorktreeClass[],
  productionFindings: findings.filter((finding) => finding.production),
  testOrFixtureFindings: findings.filter((finding) => !finding.production),
  unclassified
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

function scanRoots(roots: readonly string[], production: boolean): CensusFinding[] {
  return roots.flatMap((entry) => {
    const absolute = path.join(root, entry);
    return existsSync(absolute) ? scanPath(absolute, production) : [];
  });
}

function scanPath(absolutePath: string, production: boolean): CensusFinding[] {
  const statEntries = readdirSync(absolutePath, { withFileTypes: true });
  const findings: CensusFinding[] = [];
  for (const entry of statEntries) {
    if (ignoredDirs.has(entry.name)) continue;
    const child = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      findings.push(...scanPath(child, production && !isTestOrFixturePath(child)));
      continue;
    }
    if (!/\.(ts|js|mts|mjs|cjs|json|md)$/.test(entry.name)) continue;
    findings.push(...scanFile(child, production && !isTestOrFixturePath(child)));
  }
  return findings;
}

function scanFile(absolutePath: string, production: boolean): CensusFinding[] {
  const relative = normalize(path.relative(root, absolutePath));
  if (relative === 'scripts/validate-worktree-callsite-census.ts') return [];
  const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);
  const findings: CensusFinding[] = [];
  lines.forEach((line, index) => {
    if (!/(git\s+worktree\s+add|worktree['"`]?\s*,\s*['"`]add|worktree add)/.test(line)) return;
    const receipt = productionReceipts[relative] ?? null;
    findings.push({
      file: relative,
      line: index + 1,
      snippet: line.trim(),
      production,
      classification: production ? (receipt?.classification ?? 'unclassified') : 'test-or-fixture',
      receiptContract: receipt?.receiptContract ?? null
    });
  });
  return findings;
}

function isTestOrFixturePath(value: string): boolean {
  return /(^|[\\/])(__tests__|fixtures?|test-fixtures)([\\/]|$)/i.test(value);
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/');
}
