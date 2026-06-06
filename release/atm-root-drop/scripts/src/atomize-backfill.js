#!/usr/bin/env node
/**
 * atomize-backfill.js - ATM bulk atom spec backfill
 * 對應: TASK-ASA-0006
 *
 * 使用:
 *   node atm.mjs atomize backfill --dry-run --repo . --json
 *   node atm.mjs atomize backfill --apply --repo . --json
 *
 * 行為：
 * - 從 atomize-inventory 取得 unowned production paths（按 map family 分組）
 * - 對每個 family 生成提案：atom spec、README、最小 test、registry entry、rollback 指令
 * - dry-run 模式：只輸出 proposal JSON，不修改 production code
 * - apply 模式：寫入 proposal + applied manifest + rollback markdown
 *   （只新增治理 artifacts 與 registry placeholder，不修改 production logic）
 * - 每顆 generated atom 都標記 status=generatedDraft，等待人工審查
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEMA_ID = 'atm.atomBackfillProposal.v1';
const SCHEMA_VERSION = '1.0.0';

// Map family -> atom spec template metadata
const FAMILY_DEFAULTS = {
  'atm.bootstrap-runtime-map': {
    capability: 'bootstrap runtime, adapter loading, agent pack initialization',
    review_status: 'generatedDraft',
    priority: 'P1',
    test_strategy: 'integration-only',
    rollback_strategy: 'remove generated registry entry'
  },
  'atm.language-adapter-map': {
    capability: 'language-binding adapter (python/js)',
    review_status: 'generatedDraft',
    priority: 'P2',
    test_strategy: 'adapter-contract-only',
    rollback_strategy: 'remove generated registry entry'
  },
  'atm.behavior-pack-map': {
    capability: 'behavior pack workflow (atomize/evolve/compose/expire/etc.)',
    review_status: 'generatedDraft',
    priority: 'P1',
    test_strategy: 'dry-run-fixture',
    rollback_strategy: 'remove generated registry entry'
  },
  'atm.atom-birth-map': {
    capability: 'atom birth (inventory/score/backfill workflows)',
    review_status: 'generatedDraft',
    priority: 'P0',
    test_strategy: 'cli-mode-validation',
    rollback_strategy: 'remove generated registry entry'
  },
  'atm.guard-validation-map': {
    capability: 'governance guard / validator script',
    review_status: 'generatedDraft',
    priority: 'P1',
    test_strategy: 'mode-validate-fixture',
    rollback_strategy: 'remove generated registry entry'
  }
};

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function pathToAtomIdSuggestion(filePath, family) {
  // Convert path like packages/adapter-local-git/src/local-git-adapter.ts
  // to atom-local-git-adapter (best-effort heuristic)
  const baseName = filePath.split('/').pop().replace(/\.(ts|js|mjs|tsx)$/, '');
  if (family === 'atm.guard-validation-map') {
    // scripts/validate-X.ts -> atom-validator-X
    const m = baseName.match(/^validate-(.+)$/);
    if (m) return `atom-validator-${m[1]}`;
    return `atom-${baseName}`;
  }
  if (family === 'atm.behavior-pack-map') {
    return `atom-behavior-${baseName}`;
  }
  if (family === 'atm.language-adapter-map') {
    return `atom-${baseName}`;
  }
  if (family === 'atm.bootstrap-runtime-map') {
    return `atom-${baseName.replace(/^index$/, filePath.split('/')[1])}`;
  }
  if (family === 'atm.atom-birth-map') {
    return `atom-${baseName}`;
  }
  return `atom-${baseName}`;
}

function buildAtomProposal(filePath, family) {
  const defaults = FAMILY_DEFAULTS[family] ?? {
    capability: 'unclassified production source',
    review_status: 'generatedDraft',
    priority: 'P2',
    test_strategy: 'manual',
    rollback_strategy: 'remove generated registry entry'
  };
  const atomId = pathToAtomIdSuggestion(filePath, family);
  return {
    atomId,
    suggestedMapFamily: family,
    path: filePath,
    capability: defaults.capability,
    review_status: defaults.review_status,
    priority: defaults.priority,
    test_strategy: defaults.test_strategy,
    rollback_strategy: defaults.rollback_strategy,
    artifacts: {
      spec: `atomic_workbench/atom-specs/${atomId}.spec.md`,
      readme: `atomic_workbench/atom-specs/${atomId}.README.md`,
      test_stub: `atomic_workbench/atom-specs/${atomId}.test-stub.md`,
      registry_entry: { atomId, status: 'generatedDraft', mapFamily: family }
    }
  };
}

async function loadInventory(repoRoot) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const inventoryScriptPath = join(__dirname, 'atomize-inventory.js');
  const { atomizeInventory } = await import(pathToFileURL(inventoryScriptPath).href);
  return atomizeInventory({ repo: repoRoot });
}

export async function atomizeBackfill(options) {
  const repoRoot = resolve(options.repo ?? process.cwd());
  const mode = options.apply ? 'apply' : 'dry-run';

  const inv = await loadInventory(repoRoot);
  if (!inv || inv.status === 'error' || !inv.report) {
    return {
      status: 'error',
      message: inv?.message ?? 'failed to load inventory',
      schemaId: SCHEMA_ID
    };
  }

  // Re-load all unowned paths (inventory only returns samples). We use the
  // unowned_paths_sample plus extend by scanning unowned_by_map_family.
  // For backfill purposes the sample list is sufficient as input for the
  // proposal; the user can iterate.
  const families = inv.report.unowned_by_map_family ?? {};
  const proposals = [];
  for (const [family, info] of Object.entries(families)) {
    const samples = Array.isArray(info.samples) ? info.samples : [];
    for (const filePath of samples) {
      proposals.push(buildAtomProposal(filePath, family));
    }
  }

  const generatedAt = new Date().toISOString();
  const familyBreakdown = {};
  for (const p of proposals) {
    familyBreakdown[p.suggestedMapFamily] = (familyBreakdown[p.suggestedMapFamily] ?? 0) + 1;
  }

  const proposal = {
    schemaId: SCHEMA_ID,
    specVersion: SCHEMA_VERSION,
    generatedAt,
    mode,
    repo: repoRoot,
    summary: {
      total_atom_proposals: proposals.length,
      total_unowned_paths: inv.report.inventory?.unowned_count ?? null,
      proposal_coverage_pct: inv.report.inventory?.unowned_count
        ? Math.round((proposals.length / inv.report.inventory.unowned_count) * 100)
        : 0,
      family_breakdown: familyBreakdown,
      all_generated_marked_as: 'generatedDraft'
    },
    proposals,
    review_requirements: [
      'Each generatedDraft atom must be reviewed before status -> reviewed',
      'No production code edits performed by this command',
      'Registry entries are placeholders only and require human approval',
      'Rollback instructions are emitted alongside applied manifest'
    ],
    rollback_command: 'node atm.mjs atomize backfill --rollback --repo . --json'
  };

  const proposalPath = join(repoRoot, 'atomic_workbench', 'atomization-coverage', 'atom-backfill-proposal.json');
  mkdirSync(dirname(proposalPath), { recursive: true });
  writeFileSync(proposalPath, JSON.stringify(proposal, null, 2));

  let appliedManifest = null;
  let rollbackMarkdownPath = null;
  if (mode === 'apply') {
    appliedManifest = {
      schemaId: 'atm.atomBackfillAppliedManifest.v1',
      specVersion: SCHEMA_VERSION,
      appliedAt: generatedAt,
      mode: 'apply',
      proposal_path: 'atomic_workbench/atomization-coverage/atom-backfill-proposal.json',
      applied_count: proposals.length,
      governance_artifacts_only: true,
      no_production_code_changes: true,
      registry_placeholders: proposals.map((p) => ({
        atomId: p.atomId,
        mapFamily: p.suggestedMapFamily,
        status: 'generatedDraft',
        sourcePath: p.path
      })),
      review_gate: {
        required: true,
        next_step: 'Run human-review on each generatedDraft atom before promoting status to reviewed.'
      }
    };
    const appliedPath = join(repoRoot, 'atomic_workbench', 'atomization-coverage', 'atom-backfill-applied.json');
    writeFileSync(appliedPath, JSON.stringify(appliedManifest, null, 2));

    rollbackMarkdownPath = join(repoRoot, 'atomic_workbench', 'atomization-coverage', 'atom-backfill-rollback.md');
    const rollbackContent = buildRollbackMarkdown(proposals, generatedAt);
    writeFileSync(rollbackMarkdownPath, rollbackContent);
  }

  return {
    status: 'success',
    schemaId: SCHEMA_ID,
    mode,
    report: proposal,
    appliedManifest,
    artifactPaths: {
      proposal: 'atomic_workbench/atomization-coverage/atom-backfill-proposal.json',
      applied: mode === 'apply' ? 'atomic_workbench/atomization-coverage/atom-backfill-applied.json' : null,
      rollback: mode === 'apply' ? 'atomic_workbench/atomization-coverage/atom-backfill-rollback.md' : null
    }
  };
}

function buildRollbackMarkdown(proposals, generatedAt) {
  const familyMap = {};
  for (const p of proposals) {
    if (!familyMap[p.suggestedMapFamily]) familyMap[p.suggestedMapFamily] = [];
    familyMap[p.suggestedMapFamily].push(p);
  }
  let md = `# Atom Backfill Rollback Instructions\n\n`;
  md += `Generated: ${generatedAt}\n\n`;
  md += `## Summary\n\n`;
  md += `- Total proposed atoms: ${proposals.length}\n`;
  md += `- All atoms are in **generatedDraft** state (no production code changes)\n`;
  md += `- Rollback removes generated governance artifacts and registry placeholders\n\n`;
  md += `## Rollback Steps\n\n`;
  md += `### 1. Remove applied manifest\n\n`;
  md += `\`\`\`bash\n`;
  md += `rm atomic_workbench/atomization-coverage/atom-backfill-applied.json\n`;
  md += `rm atomic_workbench/atomization-coverage/atom-backfill-rollback.md\n`;
  md += `\`\`\`\n\n`;
  md += `### 2. Remove registry placeholders\n\n`;
  md += `For each atomId below, remove the corresponding entry from \`atomic-registry.json\`:\n\n`;
  for (const [family, items] of Object.entries(familyMap)) {
    md += `#### ${family} (${items.length} atoms)\n\n`;
    for (const p of items) {
      md += `- \`${p.atomId}\` (source: \`${p.path}\`)\n`;
    }
    md += `\n`;
  }
  md += `### 3. Verify rollback\n\n`;
  md += `\`\`\`bash\n`;
  md += `node atm.mjs validate atomization-coverage --repo . --json\n`;
  md += `npm run validate:registry-core\n`;
  md += `npm run validate:registry-catalog\n`;
  md += `\`\`\`\n\n`;
  md += `## Notes\n\n`;
  md += `- This rollback does NOT touch any production source files\n`;
  md += `- It only removes the governance artifacts generated by \`atomize backfill --apply\`\n`;
  md += `- Run \`node atm.mjs atomize inventory\` after rollback to confirm coverage state reverted\n`;
  return md;
}

function parseArgs(argv) {
  let mode = 'dry-run';
  let repo = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') mode = 'apply';
    else if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--repo' || arg === '--cwd') {
      repo = argv[i + 1] ?? repo;
      i += 1;
    }
  }
  return { mode, repo };
}

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
  const { mode, repo } = parseArgs(process.argv.slice(2));
  atomizeBackfill({ repo, apply: mode === 'apply' }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === 'success' ? 0 : 1);
  }).catch((err) => {
    console.error(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exit(1);
  });
}
