#!/usr/bin/env node
/**
 * validate-atomization-coverage.ts
 *
 * 對應: TASK-ASA-0004 atomization-coverage guard 與 validate
 *
 * 行為：
 * - 讀取 atomic_workbench/atomization-coverage/dogfood-score.json
 * - 讀取 atomic_workbench/atomization-coverage/exclusion-inventory.json
 * - 讀取 atomic_workbench/atomization-coverage/path-to-atom-map.json
 * - 依 docs/ATOMIZATION_COVERAGE_TAXONOMY.md §3.2 的 pass / fail thresholds 驗收
 * - 對新增的 production source path，檢查是否已在 path-to-atom-map.json 或 exclusion-inventory.json
 * - exit 0 = pass; exit 1 = violations found
 *
 * 兩種呼叫模式：
 *   npm run validate:atomization-coverage      # 驗證整個 repo
 *   node --strip-types scripts/validate-atomization-coverage.ts --mode validate [--repo path]
 *   node --strip-types scripts/validate-atomization-coverage.ts --mode guard --new-paths "path1,path2"
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import {
  loadPathToAtomMap,
  validateProjectionMatchesShards
} from '../atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js';

interface DogfoodScore {
  schemaId?: string;
  overall_atomization_score?: number;
  grade?: string;
  scores?: Record<string, number>;
  trend?: string;
}

interface ExclusionEntry {
  path: string;
  reason: string;
  owner_atom_id?: string;
  provenance: string;
  valid_until?: string;
  notes?: string;
}

interface PathMapping {
  path_pattern: string;
  atom_id: string;
  capability: string;
  coverage_status: string;
}

interface PathToAtomMap {
  schemaId?: string;
  mappings: PathMapping[];
  summary: Record<string, number>;
}

const PASS_THRESHOLDS: Record<string, number> = {
  source_ownership_coverage: 95,
  public_command_coverage: 95,
  atom_with_test_evidence: 80,
  atom_with_rollback_evidence: 70,
  excluded_paths_with_reason: 95,
  runAtm_with_readable_ref: 100,
  overall_atomization_score: 85
};

const FAIL_THRESHOLDS: Record<string, number> = {
  source_ownership_coverage: 80,
  public_command_coverage: 80,
  atom_with_test_evidence: 60,
  atom_with_rollback_evidence: 50,
  excluded_paths_with_reason: 90,
  runAtm_with_readable_ref: 95,
  overall_atomization_score: 70
};

const ALLOWED_EXCLUSION_REASONS = new Set([
  'generated', 'fixture', 'snapshot', 'doc', 'example', 'test-only', 'internal-only'
]);

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function globPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__ATM_DBL__')
    .replace(/\*/g, '[^/]*')
    .replace(/__ATM_DBL__/g, '.*');
  return new RegExp('^' + escaped + '$');
}

function listChangedFiles(repo: string): string[] {
  try {
    const out = execSync(`git -C "${repo}" diff --name-only HEAD~1 HEAD`, { encoding: 'utf8' });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function isProductionPath(filePath: string): boolean {
  return /^packages\/[^/]+\/src\//.test(filePath)
    || /^packages\/[^/]+\/types\//.test(filePath)
    || /^scripts\/src\//.test(filePath)
    || /^integrations\//.test(filePath);
}

interface CoverageViolation {
  kind: 'threshold' | 'unowned-new-source' | 'invalid-exclusion-reason' | 'missing-artifact' | 'shard-merge';
  detail: string;
  data?: Record<string, unknown>;
}

interface CoverageValidationReport {
  schemaId: 'atm.atomizationCoverageValidation.v1';
  ok: boolean;
  mode: 'validate' | 'guard';
  generatedAt: string;
  repo: string;
  thresholds: Record<string, number>;
  scores: Record<string, number>;
  violations: CoverageViolation[];
  remediation: string[];
}

export interface ValidateOptions {
  repo: string;
  mode: 'validate' | 'guard';
  newPaths?: string[];
}

export function validateAtomizationCoverage(options: ValidateOptions): CoverageValidationReport {
  const repo = resolve(options.repo);
  const scorePath = resolve(repo, 'atomic_workbench/atomization-coverage/dogfood-score.json');
  const exclusionPath = resolve(repo, 'atomic_workbench/atomization-coverage/exclusion-inventory.json');
  const mapPath = resolve(repo, 'atomic_workbench/atomization-coverage/path-to-atom-map.json');

  const violations: CoverageViolation[] = [];
  const remediation: string[] = [];

  const score = readJson<DogfoodScore>(scorePath);
  if (!score) {
    violations.push({
      kind: 'missing-artifact',
      detail: 'atomic_workbench/atomization-coverage/dogfood-score.json missing',
      data: { path: scorePath }
    });
    remediation.push('Run `node atm.mjs atomize score --repo . --json` to produce dogfood-score.json.');
  }

  const exclusions = readJson<ExclusionEntry[]>(exclusionPath) ?? [];
  if (exclusions.length === 0) {
    violations.push({
      kind: 'missing-artifact',
      detail: 'atomic_workbench/atomization-coverage/exclusion-inventory.json empty or missing',
      data: { path: exclusionPath }
    });
    remediation.push('TASK-ASA-0001 must define exclusion entries (17 minimum per baseline).');
  } else {
    for (const entry of exclusions) {
      if (!ALLOWED_EXCLUSION_REASONS.has(entry.reason)) {
        violations.push({
          kind: 'invalid-exclusion-reason',
          detail: `exclusion-inventory entry uses invalid reason "${entry.reason}"`,
          data: { path: entry.path, reason: entry.reason }
        });
        remediation.push(`Use one of ${[...ALLOWED_EXCLUSION_REASONS].join(', ')} for path ${entry.path}.`);
      }
    }
  }

  let pathMap: PathToAtomMap | null = null;
  try {
    pathMap = loadPathToAtomMap(repo) as PathToAtomMap;
  } catch (error) {
    violations.push({
      kind: 'shard-merge',
      detail: `path-to-atom-map owner shard merge failed: ${error instanceof Error ? error.message : String(error)}`,
      data: { path: mapPath }
    });
    remediation.push('Fix duplicate path_pattern ownership in path-to-atom-map owner shards or restore projection.');
  }

  if (!pathMap || !Array.isArray(pathMap.mappings)) {
    violations.push({
      kind: 'missing-artifact',
      detail: 'atomic_workbench/atomization-coverage/path-to-atom-map.json missing or invalid',
      data: { path: mapPath }
    });
    remediation.push('TASK-ASA-0001 must produce path-to-atom-map.json with mappings array.');
  } else {
    const shardEquivalence = validateProjectionMatchesShards(repo);
    if (!shardEquivalence.ok && !shardEquivalence.skipped) {
      violations.push({
        kind: 'shard-merge',
        detail: `path-to-atom-map projection is not equivalent to owner shard merge: ${shardEquivalence.detail ?? shardEquivalence.reason}`,
        data: { reason: shardEquivalence.reason }
      });
      remediation.push('Rebuild projection via node atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js <repo> write-projection');
    }
  }

  const scoreValues = score?.scores ?? {};

  if (options.mode === 'validate') {
    // Validate mode: check thresholds against dogfood-score.json
    if (score && typeof score.overall_atomization_score === 'number') {
      if (score.overall_atomization_score < FAIL_THRESHOLDS.overall_atomization_score) {
        violations.push({
          kind: 'threshold',
          detail: `overall_atomization_score=${score.overall_atomization_score} below fail threshold ${FAIL_THRESHOLDS.overall_atomization_score}`,
          data: { metric: 'overall_atomization_score', value: score.overall_atomization_score, threshold: FAIL_THRESHOLDS.overall_atomization_score }
        });
        remediation.push('Address priority gaps from dogfood-score.md before closing release-blocking tasks.');
      }
    }
    for (const [metric, value] of Object.entries(scoreValues)) {
      const failAt = FAIL_THRESHOLDS[metric];
      if (failAt !== undefined && value < failAt) {
        violations.push({
          kind: 'threshold',
          detail: `${metric}=${value} below fail threshold ${failAt}`,
          data: { metric, value, threshold: failAt }
        });
      }
    }
  } else {
    // Guard mode: check new paths
    const newPaths = options.newPaths ?? listChangedFiles(repo);
    const mappings = pathMap?.mappings ?? [];
    for (const newPath of newPaths) {
      if (!isProductionPath(newPath)) continue;
      const owned = mappings.some((m) => globPatternToRegex(m.path_pattern).test(newPath));
      if (owned) continue;
      const excluded = exclusions.some((e) => globPatternToRegex(e.path).test(newPath));
      if (excluded) continue;
      violations.push({
        kind: 'unowned-new-source',
        detail: `New production source ${newPath} has no atom/map ownership and no exclusion reason`,
        data: { path: newPath, suggestedAction: 'Add to path-to-atom-map.json mappings or add exclusion-inventory.json entry' }
      });
      remediation.push(`Map ${newPath} via path-to-atom-map.json or add explicit exclusion reason in exclusion-inventory.json.`);
    }
  }

  return {
    schemaId: 'atm.atomizationCoverageValidation.v1',
    ok: violations.length === 0,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    repo,
    thresholds: options.mode === 'validate' ? FAIL_THRESHOLDS : {},
    scores: scoreValues,
    violations,
    remediation: [...new Set(remediation)]
  };
}

function parseArgs(argv: string[]): { mode: 'validate' | 'guard'; repo: string; newPaths?: string[] } {
  let mode: 'validate' | 'guard' = 'validate';
  let repo: string = process.cwd();
  let newPaths: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode') {
      const v = argv[i + 1];
      if (v === 'validate' || v === 'guard') mode = v;
      i += 1;
    } else if (arg === '--repo' || arg === '--cwd') {
      repo = argv[i + 1] ?? repo;
      i += 1;
    } else if (arg === '--new-paths') {
      newPaths = (argv[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    }
  }
  return { mode, repo, newPaths };
}

import { fileURLToPath } from 'node:url';
const invokedAsScript = (() => {
  try {
    const me = fileURLToPath(import.meta.url);
    const entry = process.argv[1] ? resolve(process.argv[1]) : '';
    return me === entry;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  const { mode, repo, newPaths } = parseArgs(process.argv.slice(2));
  const report = validateAtomizationCoverage({ mode, repo, newPaths });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
