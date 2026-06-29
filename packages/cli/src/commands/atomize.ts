import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CliError, makeResult, message } from './shared.ts';

type AtomizeOptions = {
  cwd: string;
  subcommand: string | null;
  repo: string;
  apply: boolean;
  dryRun: boolean;
  passthroughArgs: string[];
};

export async function runAtomize(argv: string[]) {
  const options = parseAtomizeArgs(argv);

  if (!options.subcommand) {
    return makeResult({
      ok: false,
      command: 'atomize',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ATOMIZE_MISSING_SUBCOMMAND', 'Missing required subcommand.', {
          usage: 'node atm.mjs atomize <subcommand> [options]',
          subcommands: ['inventory', 'score', 'backfill', 'register-receipt', 'snapshot', 'verify-task']
        })
      ]
    });
  }

  if (options.subcommand === 'inventory') {
    return runAtomizeInventory(options);
  }

  if (options.subcommand === 'score') {
    return runAtomizeScore(options);
  }

  if (options.subcommand === 'backfill') {
    return runAtomizeBackfill(options);
  }

  if (options.subcommand === 'register-receipt' || options.subcommand === 'snapshot' || options.subcommand === 'verify-task') {
    return runAtomizationRegistrationTool(options);
  }

  return makeResult({
    ok: false,
    command: 'atomize',
    cwd: options.cwd,
    messages: [
      message('error', 'ATM_ATOMIZE_UNKNOWN_SUBCOMMAND', `Unknown subcommand: ${options.subcommand}`, {
        supportedSubcommands: ['inventory', 'score', 'backfill', 'register-receipt', 'snapshot', 'verify-task']
      })
    ]
  });
}

async function runAtomizationRegistrationTool(options: AtomizeOptions) {
  const subcommand = options.subcommand as 'register-receipt' | 'snapshot' | 'verify-task';
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.resolve(__dirname, '../../../../');
    const scriptPath = path.join(repoRoot, 'scripts', 'src', 'atomization-register-receipt.js');
    const command = subcommand === 'register-receipt' ? 'register-path' : subcommand;
    const output = execFileSync(process.execPath, [scriptPath, command, '--repo', options.repo, ...options.passthroughArgs], {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const parsed = JSON.parse(output);
    return makeResult({
      ok: parsed.ok !== false,
      command: `atomize ${options.subcommand}`,
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_ATOMIZE_REGISTRATION_TOOL_SUCCESS', `Atomize ${options.subcommand} completed.`, {
          receiptPath: parsed.receiptPath ?? null,
          snapshotPath: parsed.snapshotPath ?? null
        })
      ],
      evidence: parsed
    });
  } catch (err: unknown) {
    const error = err as Record<string, unknown> | null;
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const payload = stderr.startsWith('{') ? stderr : '';
    const details = payload ? JSON.parse(payload) : null;
    const errorMessage = err instanceof Error ? err.message : String(err);
    return makeResult({
      ok: false,
      command: `atomize ${subcommand}`,
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ATOMIZE_REGISTRATION_TOOL_FAILED', `Atomize ${subcommand} failed: ${details?.error ?? errorMessage}`, {
          usage: details?.usage ?? null
        })
      ],
      evidence: details ?? { stderr }
    });
  }
}

async function runAtomizeInventory(options: AtomizeOptions) {
  try {
    // 解析到 atomize-inventory.js 的正確路徑
    // 從 packages/cli/src/commands/atomize.ts 相對於 repo root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.resolve(__dirname, '../../../../');
    const inventoryScriptPath = path.join(repoRoot, 'scripts', 'src', 'atomize-inventory.js');

    // 動態導入 atomize-inventory 模組
    const { atomizeInventory } = await import(pathToFileURL(inventoryScriptPath).href);

    const result = await atomizeInventory({
      repo: options.repo
    });

    if (result.status === 'error') {
      return makeResult({
        ok: false,
        command: 'atomize inventory',
        cwd: options.cwd,
        messages: [
          message('error', 'ATM_ATOMIZE_INVENTORY_ERROR', result.message, {
            suggestedFix: result.suggestedFix
          })
        ]
      });
    }

    return makeResult({
      ok: true,
      command: 'atomize inventory',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_ATOMIZE_INVENTORY_SUCCESS', 'Atomization coverage inventory completed.', {
          timestamp: result.report.timestamp,
          coveragePercentage: result.report.inventory?.coverage_percentage ?? null,
          riskLevel: result.report.risk_level ?? null
        })
      ],
      evidence: {
        schemaId: result.schemaId ?? 'atm.atomizeInventoryReport.v1',
        inventory: result.report.inventory,
        owned_paths: result.report.owned_paths,
        unowned_paths_sample: result.report.unowned_paths_sample,
        unowned_by_map_family: result.report.unowned_by_map_family,
        unowned_by_risk: result.report.unowned_by_risk,
        registry_summary: result.report.registry_summary,
        suggested_actions: result.report.suggested_actions,
        risk_level: result.report.risk_level,
        full_report: result.report
      }
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return makeResult({
      ok: false,
      command: 'atomize inventory',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ATOMIZE_INVENTORY_FAILED', `Atomization inventory failed: ${error.message}`, {
          stack: error.stack
        })
      ]
    });
  }
}

async function runAtomizeScore(options: AtomizeOptions) {
  try {
    // 解析到 atomize-score.js 的正確路徑
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.resolve(__dirname, '../../../../');
    const scoreScriptPath = path.join(repoRoot, 'scripts', 'src', 'atomize-score.js');

    // 動態導入 atomize-score 模組
    const { atomizeScore } = await import(pathToFileURL(scoreScriptPath).href);

    const result = await atomizeScore({
      repo: options.repo
    });

    if (result.status === 'error') {
      return makeResult({
        ok: false,
        command: 'atomize score',
        cwd: options.cwd,
        messages: [
          message('error', 'ATM_ATOMIZE_SCORE_ERROR', result.message, {
            suggestedFix: result.suggestedFix
          })
        ]
      });
    }

    return makeResult({
      ok: true,
      command: 'atomize score',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_ATOMIZE_SCORE_SUCCESS', 'Atomization dogfood score calculated.', {
          generatedAt: result.runMetadata?.generatedAt ?? null,
          overallScore: result.report.overall_atomization_score,
          grade: result.report.grade,
          stage: result.report.stage,
          trend: result.report.trend
        })
      ],
      evidence: {
        schemaId: result.schemaId ?? 'atm.dogfoodScore.v1',
        overall_atomization_score: result.report.overall_atomization_score,
        grade: result.report.grade,
        stage: result.report.stage,
        trend: result.report.trend,
        scores: result.report.scores,
        weighted_components: result.report.weighted_components,
        weights: result.report.weights,
        next_high_roi_area: result.report.next_high_roi_area,
        priority_gaps: result.report.priority_gaps,
        inventory: result.report.inventory,
        detail: result.report.detail,
        artifacts: {
          json: 'atomic_workbench/atomization-coverage/dogfood-score.json',
          markdown: 'atomic_workbench/atomization-coverage/dogfood-score.md',
          runMetadata: '.atm-temp/atomization-coverage/dogfood-score.run-metadata.json'
        },
        runMetadata: result.runMetadata,
        full_report: result.report
      }
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return makeResult({
      ok: false,
      command: 'atomize score',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ATOMIZE_SCORE_FAILED', `Atomization score calculation failed: ${error.message}`, {
          stack: error.stack
        })
      ]
    });
  }
}

async function runAtomizeBackfill(options: AtomizeOptions) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.resolve(__dirname, '../../../../');
    const scriptPath = path.join(repoRoot, 'scripts', 'src', 'atomize-backfill.js');

    const { atomizeBackfill } = await import(pathToFileURL(scriptPath).href);

    const result = await atomizeBackfill({
      repo: options.repo,
      apply: options.apply
    });

    if (result.status === 'error') {
      return makeResult({
        ok: false,
        command: 'atomize backfill',
        cwd: options.cwd,
        messages: [
          message('error', 'ATM_ATOMIZE_BACKFILL_ERROR', result.message, {})
        ]
      });
    }

    const modeLabel = result.mode === 'apply' ? 'applied (governance artifacts only)' : 'dry-run proposal';
    return makeResult({
      ok: true,
      command: 'atomize backfill',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_ATOMIZE_BACKFILL_SUCCESS', `Atomize backfill completed: ${modeLabel}.`, {
          mode: result.mode,
          atomProposalCount: result.report?.summary?.total_atom_proposals ?? 0,
          familyBreakdown: result.report?.summary?.family_breakdown ?? {}
        })
      ],
      evidence: {
        schemaId: result.schemaId ?? 'atm.atomBackfillProposal.v1',
        mode: result.mode,
        summary: result.report?.summary ?? null,
        artifactPaths: result.artifactPaths,
        review_required: true,
        no_production_code_changes: true,
        all_generated_marked_as: 'generatedDraft',
        proposalSample: (result.report?.proposals ?? []).slice(0, 5)
      }
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return makeResult({
      ok: false,
      command: 'atomize backfill',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ATOMIZE_BACKFILL_FAILED', `Atomize backfill failed: ${error.message}`, {
          stack: error.stack
        })
      ]
    });
  }
}

function parseAtomizeArgs(argv: string[]) {
  const state: AtomizeOptions = {
    cwd: process.cwd(),
    subcommand: null,
    repo: '.',
    apply: false,
    dryRun: false,
    passthroughArgs: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }

    if (arg === '--repo') {
      state.repo = requireValue(argv, index, '--repo');
      index += 1;
      continue;
    }

    if (arg === '--apply') {
      state.apply = true;
      continue;
    }

    if (arg === '--dry-run') {
      state.dryRun = true;
      continue;
    }

    if (!arg.startsWith('-')) {
      if (!state.subcommand) {
        state.subcommand = arg;
        continue;
      }
    }

    if (state.subcommand === 'register-receipt' || state.subcommand === 'snapshot' || state.subcommand === 'verify-task') {
      state.passthroughArgs.push(arg);
      const next = argv[index + 1];
      if (arg.startsWith('--') && next && !next.startsWith('-')) {
        state.passthroughArgs.push(next);
        index += 1;
      }
    }
  }

  return state;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new CliError('ATM_CLI_MISSING_VALUE', `Flag ${flag} requires a value.`);
  }
  return value;
}
