import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CliError, makeResult, message } from './shared.ts';

type AtomizeOptions = {
  cwd: string;
  subcommand: string | null;
  repo: string;
};

export async function runAtomize(argv: any) {
  const options = parseAtomizeArgs(argv);
  
  if (!options.subcommand) {
    return makeResult({
      ok: false,
      command: 'atomize',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ATOMIZE_MISSING_SUBCOMMAND', 'Missing required subcommand.', {
          usage: 'node atm.mjs atomize <subcommand> [options]',
          subcommands: ['inventory']
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

  return makeResult({
    ok: false,
    command: 'atomize',
    cwd: options.cwd,
    messages: [
      message('error', 'ATM_ATOMIZE_UNKNOWN_SUBCOMMAND', `Unknown subcommand: ${options.subcommand}`, {
        supportedSubcommands: ['inventory', 'score']
      })
    ]
  });
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
  } catch (err: any) {
    return makeResult({
      ok: false,
      command: 'atomize inventory',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ATOMIZE_INVENTORY_FAILED', `Atomization inventory failed: ${err.message}`, {
          stack: err.stack
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
          timestamp: result.report.timestamp,
          overallScore: result.report.dogfood_score.overall
        })
      ],
      evidence: {
        score: result.report.dogfood_score,
        breakdown: result.report.breakdown,
        next_high_roi_area: result.report.next_high_roi_area,
        suggested_actions: result.report.suggested_actions,
        growth_projection: result.report.growth_projection,
        full_report: result.report
      }
    });
  } catch (err: any) {
    return makeResult({
      ok: false,
      command: 'atomize score',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ATOMIZE_SCORE_FAILED', `Atomization score calculation failed: ${err.message}`, {
          stack: err.stack
        })
      ]
    });
  }
}

function parseAtomizeArgs(argv: any) {
  const state: AtomizeOptions = {
    cwd: process.cwd(),
    subcommand: null,
    repo: '.'
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

    if (!arg.startsWith('-')) {
      if (!state.subcommand) {
        state.subcommand = arg;
      }
    }
  }

  return state;
}

function requireValue(argv: any, index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new CliError('ATM_CLI_MISSING_VALUE', `Flag ${flag} requires a value.`);
  }
  return value;
}
