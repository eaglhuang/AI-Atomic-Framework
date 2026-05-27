#!/usr/bin/env node
/**
 * atomize-score.js - ATM 自我原子化 dogfood 分數報告
 * 對應: TASK-ASA-0003
 *
 * 使用: node atm.mjs atomize score --repo . --json
 *
 * 行為：
 * - 重用 atomize-inventory 的 production source / owned / unowned 統計
 * - 對 atomic-registry.json entries 評估 evidence coverage（test / rollback / provenance / report）
 * - 對 packages/cli/src/commands 估計 public command coverage
 * - 對 integrations/* 估計 integration health
 * - 對 packages/core 與 atom-callsite-readability 報告估計 readable_callsite_coverage
 * - 依 DogfoodScore schema（docs/ATOMIZATION_COVERAGE_TAXONOMY.md §3.4）輸出 atm.dogfoodScore.v1
 * - 同時寫出 atomic_workbench/atomization-coverage/dogfood-score.json
 *   與 atomic_workbench/atomization-coverage/dogfood-score.md
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const COMPONENT_WEIGHTS = {
  source_ownership_coverage: 0.30,
  public_command_coverage: 0.20,
  runtime_behavior_coverage: 0.10,
  evidence_coverage: 0.20,
  readable_callsite_coverage: 0.10,
  integration_health: 0.10
};

const PASS_THRESHOLDS = {
  source_ownership_coverage: 95,
  public_command_coverage: 95,
  atom_with_test_evidence: 80,
  atom_with_rollback_evidence: 70,
  excluded_paths_with_reason: 95,
  runAtm_with_readable_ref: 100,
  overall_atomization_score: 85
};

const FAIL_THRESHOLDS = {
  source_ownership_coverage: 80,
  public_command_coverage: 80,
  atom_with_test_evidence: 60,
  atom_with_rollback_evidence: 50,
  excluded_paths_with_reason: 90,
  runAtm_with_readable_ref: 95,
  overall_atomization_score: 70
};

function gradeFor(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  return 'F';
}

function stageFor(score) {
  if (score >= 90) return 'dogfood-excellent';
  if (score >= 70) return 'dogfood-complete';
  if (score >= 50) return 'dogfood-core';
  if (score >= 30) return 'dogfood-essential';
  return 'dogfood-foundation';
}

function countLineMatches(content, regex) {
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    if (regex.test(line)) count += 1;
  }
  return count;
}

function listDirIfExists(dirPath) {
  if (!existsSync(dirPath)) return [];
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function evaluateRegistryEvidence(registry) {
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  if (entries.length === 0) {
    return {
      atomTotal: 0,
      withTest: 0,
      withRollback: 0,
      withProvenance: 0,
      withReport: 0,
      coverage: 0
    };
  }

  let withTest = 0;
  let withRollback = 0;
  let withProvenance = 0;
  let withReport = 0;

  for (const entry of entries) {
    const ev = Array.isArray(entry.evidence) ? entry.evidence : [];
    const text = ev.join('\n').toLowerCase();
    if (/\b(test|spec|test\.report|\.test\.)\b/.test(text)) withTest += 1;
    if (/rollback/.test(text)) withRollback += 1;
    if (/provenance/.test(text)) withProvenance += 1;
    if (/report|attest|verify/.test(text)) withReport += 1;
  }

  const evidenceWeights = [withTest, withRollback, withProvenance, withReport];
  const avg = evidenceWeights.reduce((sum, v) => sum + v, 0) / (4 * entries.length);
  return {
    atomTotal: entries.length,
    withTest,
    withRollback,
    withProvenance,
    withReport,
    coverage: Math.round(avg * 100)
  };
}

/**
 * TASK-AAO-0020: public_command_coverage uses packages/cli/src/commands/command-specs.ts as
 * the canonical public command catalog. A command is public when its registry entry does not
 * use `withVisibility(spec, 'internal')`. Each public command must ship a per-command help
 * spec file under packages/cli/src/commands/command-specs/<name>.spec.ts — missing files are
 * counted as coverage gaps.
 */
function evaluateCommandCoverage(cwd) {
  const specsRegistryPath = resolve(
    cwd,
    'packages',
    'cli',
    'src',
    'commands',
    'command-specs.ts'
  );
  const specsDir = resolve(cwd, 'packages', 'cli', 'src', 'commands', 'command-specs');
  const relativeRegistry = 'packages/cli/src/commands/command-specs.ts';

  if (!existsSync(specsRegistryPath)) {
    return {
      total: 0,
      withSpec: 0,
      coverage: 0,
      source: relativeRegistry,
      missing: [],
      publicCommands: [],
      internalCommands: [],
      notes: ['command-specs.ts not found; scorer cannot evaluate public command coverage']
    };
  }

  const content = readFileSync(specsRegistryPath, 'utf8');
  const blockMatch = content.match(
    /export\s+const\s+commandSpecs\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\s*\)\s*;/
  );
  if (!blockMatch) {
    return {
      total: 0,
      withSpec: 0,
      coverage: 0,
      source: relativeRegistry,
      missing: [],
      publicCommands: [],
      internalCommands: [],
      notes: ['commandSpecs Object.freeze block not found in command-specs.ts']
    };
  }

  const block = blockMatch[1];
  const publicCommands = [];
  const internalCommands = [];
  // Each entry is on its own line, e.g. `actor: actorSpec,`,
  // `'agent-pack': agentPackSpec,`, or `do: withVisibility(doSpec, 'internal'),`.
  // We parse line-by-line so commas inside withVisibility(...) do not split the RHS.
  const entryLineRe = /^\s*(?:'([^']+)'|([A-Za-z][A-Za-z0-9_-]*))\s*:\s*(.+?),?\s*$/;
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('//')) continue;
    const match = entryLineRe.exec(line);
    if (!match) continue;
    const name = match[1] ?? match[2];
    const rhs = match[3];
    if (!name) continue;
    if (/withVisibility\(.*,\s*['"]internal['"]\s*\)/.test(rhs)) {
      internalCommands.push(name);
    } else {
      publicCommands.push(name);
    }
  }

  publicCommands.sort();
  internalCommands.sort();

  const missing = [];
  let withSpec = 0;
  for (const name of publicCommands) {
    const specFile = resolve(specsDir, `${name}.spec.ts`);
    if (existsSync(specFile)) {
      withSpec += 1;
    } else {
      missing.push(name);
    }
  }

  const total = publicCommands.length;
  const coverage = total === 0 ? 0 : Math.round((withSpec / total) * 100);
  return {
    total,
    withSpec,
    coverage,
    source: relativeRegistry,
    missing,
    publicCommands,
    internalCommands
  };
}

function evaluateRuntimeBehaviorCoverage(cwd, pathMap) {
  const requiredAreas = [
    'packages/core/src/**',
    'packages/cli/src/**',
    'packages/adapters/*/src/**',
    'scripts/src/build/**',
    'scripts/src/validate/**',
    'scripts/src/evidence/**',
    'integrations/codex/**',
    'integrations/claude/**'
  ];
  const mappings = Array.isArray(pathMap.mappings) ? pathMap.mappings : [];
  const mappedPatterns = new Set(mappings.map((m) => m.path_pattern));
  let covered = 0;
  for (const area of requiredAreas) {
    if (mappedPatterns.has(area)) covered += 1;
  }
  return {
    requiredAreas: requiredAreas.length,
    coveredAreas: covered,
    coverage: Math.round((covered / requiredAreas.length) * 100)
  };
}

function evaluateReadableCallsiteCoverage(cwd) {
  const report = resolve(cwd, 'atomic_workbench', 'reports', 'atom-callsite-readability.report.json');
  if (!existsSync(report)) {
    return { coverage: 0, total: 0, withReadable: 0, missing: 'report-not-found' };
  }
  try {
    const data = JSON.parse(readFileSync(report, 'utf8'));
    const summary = data.summary ?? {};
    const total = Number(summary.totalCallsites ?? summary.total ?? 0);
    const readable = Number(summary.readableCallsites ?? summary.readableRefCallsites ?? 0);
    if (total === 0) return { coverage: 0, total: 0, withReadable: 0 };
    return {
      coverage: Math.round((readable / total) * 100),
      total,
      withReadable: readable
    };
  } catch {
    return { coverage: 0, total: 0, withReadable: 0, missing: 'report-unreadable' };
  }
}

function evaluateIntegrationHealth(cwd) {
  const integrationRoot = resolve(cwd, 'integrations');
  const adapters = listDirIfExists(integrationRoot).filter((entry) => {
    try {
      return statSync(resolve(integrationRoot, entry)).isDirectory();
    } catch {
      return false;
    }
  });
  if (adapters.length === 0) return { adapters: 0, installed: 0, coverage: 0 };
  let installed = 0;
  for (const adapter of adapters) {
    const dir = resolve(integrationRoot, adapter);
    const files = listDirIfExists(dir);
    if (files.length > 0) installed += 1;
  }
  return {
    adapters: adapters.length,
    installed,
    coverage: Math.round((installed / adapters.length) * 100)
  };
}

function evaluateExclusionCoverage(exclusions) {
  if (!Array.isArray(exclusions) || exclusions.length === 0) return 0;
  let withReason = 0;
  for (const entry of exclusions) {
    if (entry?.reason && entry?.provenance) withReason += 1;
  }
  return Math.round((withReason / exclusions.length) * 100);
}

function stableInventorySnapshot(inventory) {
  const categoryBreakdown = inventory?.category_breakdown && typeof inventory.category_breakdown === 'object'
    ? Object.fromEntries(Object.entries(inventory.category_breakdown).filter(([key]) => key !== 'uncategorized'))
    : null;
  const snapshot = {
    production_source_count: inventory.production_source_count,
    owned_by_registry: inventory.owned_by_registry,
    unowned_count: inventory.unowned_count,
    coverage_percentage: inventory.coverage_percentage
  };
  if (categoryBreakdown) {
    snapshot.category_breakdown = categoryBreakdown;
  }
  return snapshot;
}

function buildRunMetadata(input) {
  const uncategorizedPathCount = typeof input.inventory?.category_breakdown?.uncategorized === 'number'
    ? input.inventory.category_breakdown.uncategorized
    : null;
  return {
    schemaId: 'atm.dogfoodScoreRunMetadata.v1',
    generatedAt: input.generatedAt,
    repo: input.repo,
    artifacts: input.artifacts,
    volatileInputs: {
      inventoryTimestamp: input.inventoryReport?.timestamp ?? null,
      uncategorizedPathCount,
      trackedPathCount: input.inventoryReport?.sourceTotal ?? null
    }
  };
}

function buildMarkdownReport(score, inventory) {
  const lines = [
    `# ATM Self-Atomization Dogfood Score`,
    '',
    `- Overall score: **${score.overall_atomization_score} / 100** (Grade ${score.grade})`,
    `- Stage: \`${score.stage}\``,
    `- Trend: ${score.trend}`,
    `- Schema: \`${score.schemaId}\``,
    '',
    '## Component scores',
    '',
    '| Component | Score | Pass threshold | Fail threshold | Status |',
    '|---|---|---|---|---|',
    ...Object.entries(score.scores).map(([key, value]) => {
      const pass = PASS_THRESHOLDS[key];
      const fail = FAIL_THRESHOLDS[key];
      const status = pass !== undefined && value >= pass
        ? '✅ pass'
        : fail !== undefined && value < fail
          ? '❌ fail'
          : '⚠️ at-risk';
      return `| ${key} | ${value} | ${pass ?? 'n/a'} | ${fail ?? 'n/a'} | ${status} |`;
    }),
    '',
    '## Inventory snapshot',
    '',
    `- production source paths: ${inventory.production_source_count}`,
    `- owned by registry: ${inventory.owned_by_registry}`,
    `- unowned: ${inventory.unowned_count}`,
    `- coverage: ${inventory.coverage_percentage}%`,
    '',
    '## Priority gaps',
    '',
    ...(score.priority_gaps ?? []).map((gap) =>
      `- ${gap.area}: ${gap.current} → ${gap.target}${gap.task ? ` (driven by ${gap.task})` : ''}`
    ),
    '',
    `## Next high-ROI area`,
    '',
    `- ${score.next_high_roi_area}`,
    '',
    '## Notes',
    '',
    '- Score schema: `atm.dogfoodScore.v1` (see docs/ATOMIZATION_COVERAGE_TAXONOMY.md §3.4)',
    '- Grade thresholds: A ≥ 90, B ≥ 80, C ≥ 70, F < 70',
    ''
  ];
  return lines.join('\n');
}

export async function atomizeScore(options) {
  const repoPath = options.repo || options.cwd || '.';
  const fullPath = resolve(repoPath);

  const pathMapPath = resolve(fullPath, 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json');
  const exclusionPath = resolve(fullPath, 'atomic_workbench', 'atomization-coverage', 'exclusion-inventory.json');
  const taxonomyPath = resolve(fullPath, 'docs', 'ATOMIZATION_COVERAGE_TAXONOMY.md');
  const registryPath = resolve(fullPath, 'atomic-registry.json');

  if (!existsSync(taxonomyPath)) {
    return {
      status: 'error',
      message: 'Coverage taxonomy not found. Run TASK-ASA-0001 first.',
      suggestedFix: 'Execute TASK-ASA-0001: coverage-taxonomy-exclusion-policy'
    };
  }

  const pathMap = existsSync(pathMapPath)
    ? JSON.parse(readFileSync(pathMapPath, 'utf8'))
    : { mappings: [] };
  const exclusions = existsSync(exclusionPath)
    ? JSON.parse(readFileSync(exclusionPath, 'utf8'))
    : [];
  const registry = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, 'utf8'))
    : { entries: [] };

  // Reuse inventory CLI for source ownership
  const inventoryScript = resolve(fullPath, 'scripts', 'src', 'atomize-inventory.js');
  let inventoryReport = null;
  try {
    const { atomizeInventory } = await import(pathToFileURL(inventoryScript).href);
    const invResult = await atomizeInventory({ repo: fullPath });
    if (invResult.status === 'success') inventoryReport = invResult.report;
  } catch {
    inventoryReport = null;
  }

  const inv = inventoryReport?.inventory ?? {
    production_source_count: 0,
    owned_by_registry: 0,
    unowned_count: 0,
    coverage_percentage: 0,
    category_breakdown: {}
  };
  const scoreInventory = stableInventorySnapshot(inv);

  const evidenceEval = evaluateRegistryEvidence(registry);
  const commandEval = evaluateCommandCoverage(fullPath);
  const runtimeEval = evaluateRuntimeBehaviorCoverage(fullPath, pathMap);
  const readableEval = evaluateReadableCallsiteCoverage(fullPath);
  const integrationEval = evaluateIntegrationHealth(fullPath);
  const exclusionCoverage = evaluateExclusionCoverage(exclusions);

  const scores = {
    source_ownership_coverage: inv.coverage_percentage,
    public_command_coverage: commandEval.coverage,
    atom_with_test_evidence: evidenceEval.atomTotal === 0 ? 0 : Math.round((evidenceEval.withTest / evidenceEval.atomTotal) * 100),
    atom_with_rollback_evidence: evidenceEval.atomTotal === 0 ? 0 : Math.round((evidenceEval.withRollback / evidenceEval.atomTotal) * 100),
    excluded_paths_with_reason: exclusionCoverage,
    runAtm_with_readable_ref: readableEval.coverage
  };

  const weightedScores = {
    source_ownership_coverage: scores.source_ownership_coverage,
    public_command_coverage: scores.public_command_coverage,
    runtime_behavior_coverage: runtimeEval.coverage,
    evidence_coverage: evidenceEval.coverage,
    readable_callsite_coverage: scores.runAtm_with_readable_ref,
    integration_health: integrationEval.coverage
  };

  const overall = Math.round(
    Object.entries(weightedScores).reduce((sum, [key, value]) => sum + value * (COMPONENT_WEIGHTS[key] ?? 0), 0)
  );

  const grade = gradeFor(overall);
  const stage = stageFor(overall);
  const previousScorePath = resolve(fullPath, 'atomic_workbench', 'atomization-coverage', 'dogfood-score.json');
  let previousOverall = null;
  if (existsSync(previousScorePath)) {
    try {
      const prev = JSON.parse(readFileSync(previousScorePath, 'utf8'));
      previousOverall = typeof prev.overall_atomization_score === 'number' ? prev.overall_atomization_score : null;
    } catch {
      previousOverall = null;
    }
  }
  const trend = previousOverall === null
    ? 'stable'
    : overall > previousOverall ? 'improving' : overall < previousOverall ? 'regressing' : 'stable';

  const priorityGaps = [];
  for (const [key, value] of Object.entries(scores)) {
    const pass = PASS_THRESHOLDS[key];
    if (pass !== undefined && value < pass) {
      priorityGaps.push({
        area: key,
        current: `${value}%`,
        target: `${pass}%`,
        task: nextTaskForGap(key)
      });
    }
  }

  const nextHighRoi = priorityGaps.length === 0
    ? 'maintain-quality'
    : priorityGaps.sort((a, b) => Number.parseInt(a.current, 10) - Number.parseInt(b.current, 10))[0].area;

  const generatedAt = new Date().toISOString();
  const report = {
    schemaId: 'atm.dogfoodScore.v1',
    version: '1.2',
    overall_atomization_score: overall,
    grade,
    stage,
    scores,
    weighted_components: weightedScores,
    weights: COMPONENT_WEIGHTS,
    trend,
    next_target: Math.min(100, overall + 10),
    next_high_roi_area: nextHighRoi,
    priority_gaps: priorityGaps,
    inventory: scoreInventory,
    detail: {
      evidence: evidenceEval,
      command: commandEval,
      runtime: runtimeEval,
      readable: readableEval,
      integration: integrationEval,
      exclusion_coverage: exclusionCoverage
    },
    notes: [
      'Score schema atm.dogfoodScore.v1 (docs/ATOMIZATION_COVERAGE_TAXONOMY.md §3.4).',
      'TASK-ASA-0003 emits both dogfood-score.json and dogfood-score.md for human + machine consumers.'
    ]
  };

  // Persist reports
  const scoreJsonPath = resolve(fullPath, 'atomic_workbench', 'atomization-coverage', 'dogfood-score.json');
  const scoreMdPath = resolve(fullPath, 'atomic_workbench', 'atomization-coverage', 'dogfood-score.md');
  const runMetadataPath = resolve(fullPath, '.atm-temp', 'atomization-coverage', 'dogfood-score.run-metadata.json');
  const artifacts = {
    json: 'atomic_workbench/atomization-coverage/dogfood-score.json',
    markdown: 'atomic_workbench/atomization-coverage/dogfood-score.md',
    runMetadata: '.atm-temp/atomization-coverage/dogfood-score.run-metadata.json'
  };
  const runMetadata = buildRunMetadata({
    generatedAt,
    repo: fullPath,
    inventory: inv,
    inventoryReport,
    artifacts
  });
  mkdirSync(dirname(scoreJsonPath), { recursive: true });
  mkdirSync(dirname(runMetadataPath), { recursive: true });
  writeFileSync(scoreJsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(scoreMdPath, buildMarkdownReport(report, scoreInventory), 'utf8');
  writeFileSync(runMetadataPath, JSON.stringify(runMetadata, null, 2) + '\n', 'utf8');

  return {
    status: 'success',
    schemaId: 'atm.dogfoodScore.v1',
    report,
    runMetadata,
    artifacts
  };
}

function nextTaskForGap(component) {
  switch (component) {
    case 'source_ownership_coverage': return 'TASK-ASA-0006,TASK-ASA-0008,TASK-ASA-0009';
    case 'public_command_coverage': return 'TASK-AAO-0020';
    case 'atom_with_test_evidence': return 'TASK-ASA-0010';
    case 'atom_with_rollback_evidence': return 'TASK-ASA-0010';
    case 'excluded_paths_with_reason': return 'TASK-ASA-0005';
    case 'runAtm_with_readable_ref': return 'TASK-ASA-0013';
    default: return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await atomizeScore({ repo: '.' });
  console.log(JSON.stringify(result, null, 2));
}
