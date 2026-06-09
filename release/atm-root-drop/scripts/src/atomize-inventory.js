#!/usr/bin/env node
/**
 * atomize-inventory.js - ATM 自我原子化覆蓋盤點 CLI 實作
 * 對應: TASK-ASA-0002
 *
 * 使用: node atm.mjs atomize inventory --repo . --json
 *
 * 行為：
 * - 掃描 packages/、scripts/、tests/、atomic_workbench/、integrations/ 下可分類的檔案
 * - 對照 atomic-registry.json + path-to-atom-map.json 找出已覆蓋的 path
 * - 找出未覆蓋的 production source 並依路徑啟發法給出建議 map family
 * - 依 docs/ATOMIZATION_COVERAGE_TAXONOMY.md 的分類規則切 production / generated / test / fixture / doc
 */

import { execSync } from 'child_process';
import { resolve, posix } from 'path';
import { existsSync, readFileSync } from 'fs';
import { loadPathToAtomMap } from '../../atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js';

const PRODUCTION_GLOBS = [
  /^packages\/[^/]+\/src\/.+\.(ts|js|mts|cts|tsx)$/,
  /^packages\/[^/]+\/types\/.+\.d\.ts$/,
  /^scripts\/src\/.+\.(ts|js|mjs)$/,
  /^scripts\/.+\.(ts|mts|mjs)$/,
  /^integrations\/.+\.(ts|js|mjs)$/
];

const GENERATED_GLOBS = [
  /^dist\//,
  /^build\//,
  /^release\//,
  /\.gen\.(ts|json)$/,
  /^atomic_workbench\/generators\/.+\/(outputs|artifacts)\//
];

const TEST_GLOBS = [
  /^tests\/.+\.(test|spec)\.(ts|js)$/,
  /^packages\/[^/]+\/tests\/.+\.(test|spec)\.(ts|js)$/
];

const FIXTURE_GLOBS = [
  /^fixtures\//,
  /^tests\/.+\.(snapshot|snap)$/,
  /\/__snapshots__\//,
  /^tests\/schema-fixtures\//,
  /^specs\/samples\//
];

const DOC_GLOBS = [
  /^docs\/.+\.md$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^CONTRIBUTING\.md$/,
  /^SECURITY\.md$/,
  /^AGENTS\.md$/,
  /^GEMINI\.md$/
];

function matchAny(filePath, patterns) {
  return patterns.some((re) => re.test(filePath));
}

function categorize(filePath) {
  const f = filePath.replace(/\\/g, '/');
  if (matchAny(f, GENERATED_GLOBS)) return 'generated';
  if (matchAny(f, FIXTURE_GLOBS)) return 'fixture';
  if (matchAny(f, TEST_GLOBS)) return 'test';
  if (matchAny(f, DOC_GLOBS)) return 'doc';
  if (matchAny(f, PRODUCTION_GLOBS)) return 'production';
  return null;
}

function globPatternToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__ATM_DBL__')
    .replace(/\*/g, '[^/]*')
    .replace(/__ATM_DBL__/g, '.*');
  return new RegExp('^' + escaped + '$');
}

function pathOwnedBy(filePath, mappings) {
  for (const m of mappings) {
    const re = globPatternToRegex(m.path_pattern);
    if (re.test(filePath)) return m;
  }
  return null;
}

function isExcluded(filePath, exclusions) {
  return exclusions.some((entry) => globPatternToRegex(entry.path).test(filePath));
}

function suggestMapFamily(filePath) {
  if (filePath.startsWith('packages/core/')) return 'atm.atom-registry-lifecycle-map';
  if (filePath.startsWith('packages/cli/src/commands/')) return 'atm.cli-command-router-map';
  if (filePath.startsWith('packages/cli/')) return 'atm.cli-command-router-map';
  if (filePath.startsWith('scripts/src/validate')) return 'atm.guard-validation-map';
  if (filePath.startsWith('scripts/src/atomize')) return 'atm.atom-birth-map';
  if (filePath.startsWith('scripts/src/release') || filePath.startsWith('scripts/src/build')) return 'atm.release-build-map';
  if (filePath.startsWith('scripts/validate-')) return 'atm.guard-validation-map';
  if (filePath.startsWith('scripts/')) return 'atm.bootstrap-runtime-map';
  if (filePath.startsWith('integrations/')) return 'atm.integration-pack-map';
  if (filePath.startsWith('packages/language-')) return 'atm.language-adapter-map';
  if (filePath.startsWith('packages/plugin-')) return 'atm.behavior-pack-map';
  return 'atm.bootstrap-runtime-map';
}

function riskLevel(filePath) {
  if (filePath.startsWith('packages/core/src/')) return 'P0';
  if (filePath.startsWith('packages/cli/src/')) return 'P0';
  if (filePath.startsWith('scripts/src/')) return 'P1';
  if (filePath.startsWith('integrations/')) return 'P2';
  if (filePath.startsWith('packages/')) return 'P1';
  return 'P2';
}

export async function atomizeInventory(options) {
  const repoPath = options.repo || options.cwd || '.';
  const fullPath = resolve(repoPath);

  const taxonomyPath = resolve(fullPath, 'docs', 'ATOMIZATION_COVERAGE_TAXONOMY.md');
  const exclusionPath = resolve(fullPath, 'atomic_workbench', 'atomization-coverage', 'exclusion-inventory.json');
  const registryPath = resolve(fullPath, 'atomic-registry.json');

  if (!existsSync(taxonomyPath)) {
    return {
      status: 'error',
      message: 'Coverage taxonomy not found. Run TASK-ASA-0001 first.',
      suggestedFix: 'Execute TASK-ASA-0001: coverage-taxonomy-exclusion-policy'
    };
  }

  const exclusions = existsSync(exclusionPath)
    ? JSON.parse(readFileSync(exclusionPath, 'utf-8'))
    : [];
  let pathMap = { mappings: [] };
  try {
    pathMap = loadPathToAtomMap(fullPath);
  } catch {
    pathMap = { mappings: [] };
  }
  const registry = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, 'utf-8'))
    : { entries: [] };

  const mappings = Array.isArray(pathMap.mappings) ? pathMap.mappings : [];

  let files = [];
  try {
    const allFiles = execSync(`git -C "${fullPath}" ls-files --cached`, { encoding: 'utf-8' });
    files = allFiles.split('\n').map((f) => f.trim()).filter((f) => f.length > 0).map((f) => f.replace(/\\/g, '/'));
  } catch {
    files = [];
  }

  const categoryMap = {
    production: [],
    generated: [],
    test: [],
    fixture: [],
    doc: [],
    uncategorized: []
  };

  for (const file of files) {
    const cat = categorize(file);
    if (cat) categoryMap[cat].push(file);
    else categoryMap.uncategorized.push(file);
  }

  const productionFiles = categoryMap.production;
  const ownedFiles = [];
  const unownedFiles = [];

  for (const file of productionFiles) {
    if (isExcluded(file, exclusions)) {
      continue;
    }
    const owner = pathOwnedBy(file, mappings);
    if (owner) {
      ownedFiles.push({ path: file, atomId: owner.atom_id, coverageStatus: owner.coverage_status });
    } else {
      unownedFiles.push({
        path: file,
        suggestedMap: suggestMapFamily(file),
        riskLevel: riskLevel(file)
      });
    }
  }

  const unownedByMap = unownedFiles.reduce((acc, entry) => {
    if (!acc[entry.suggestedMap]) acc[entry.suggestedMap] = { count: 0, samples: [] };
    acc[entry.suggestedMap].count += 1;
    if (acc[entry.suggestedMap].samples.length < 5) {
      acc[entry.suggestedMap].samples.push(entry.path);
    }
    return acc;
  }, {});

  const unownedByRisk = unownedFiles.reduce((acc, entry) => {
    acc[entry.riskLevel] = (acc[entry.riskLevel] ?? 0) + 1;
    return acc;
  }, { P0: 0, P1: 0, P2: 0 });

  const totalProduction = productionFiles.length;
  const ownershipCoverage = totalProduction === 0
    ? 0
    : Math.round((ownedFiles.length / totalProduction) * 100);

  return {
    status: 'success',
    schemaId: 'atm.atomizeInventoryReport.v1',
    report: {
      timestamp: new Date().toISOString(),
      repo: fullPath,
      sourceTotal: files.length,
      inventory: {
        production_source_count: totalProduction,
        owned_by_registry: ownedFiles.length,
        unowned_count: unownedFiles.length,
        coverage_percentage: ownershipCoverage,
        category_breakdown: {
          production: categoryMap.production.length,
          generated: categoryMap.generated.length,
          test: categoryMap.test.length,
          fixture: categoryMap.fixture.length,
          doc: categoryMap.doc.length,
          uncategorized: categoryMap.uncategorized.length
        }
      },
      owned_paths: ownedFiles.slice(0, 50),
      unowned_paths_sample: unownedFiles.slice(0, 25),
      unowned_by_map_family: unownedByMap,
      unowned_by_risk: unownedByRisk,
      registry_summary: {
        registry_id: registry.registryId ?? null,
        atom_entries: Array.isArray(registry.entries) ? registry.entries.length : 0,
        path_mappings: mappings.length,
        path_map_schema: pathMap.schemaId ?? null
      },
      suggested_actions: [
        {
          priority: 'P0',
          action: 'map-first',
          description: 'Define top-level maps for unowned P0 paths (packages/core, packages/cli) before atom detail',
          target_tasks: ['TASK-ASA-0007', 'TASK-ASA-0008', 'TASK-ASA-0009']
        },
        {
          priority: 'P1',
          action: 'bulk-backfill',
          description: 'Use generatedDraft atom spec backfill for unowned P1 production paths',
          target_tasks: ['TASK-ASA-0006']
        },
        {
          priority: 'P2',
          action: 'evidence-gap-filling',
          description: 'Add test/rollback/provenance evidence to existing atoms; cover integrations',
          target_tasks: ['TASK-ASA-0010', 'TASK-ASA-0012', 'TASK-ASA-0015']
        }
      ],
      risk_level: unownedByRisk.P0 > 0 ? 'high' : unownedByRisk.P1 > 50 ? 'medium' : 'low'
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await atomizeInventory({ repo: '.' });
  console.log(JSON.stringify(result, null, 2));
}
