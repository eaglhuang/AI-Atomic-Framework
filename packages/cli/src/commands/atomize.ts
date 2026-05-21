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

  return makeResult({
    ok: false,
    command: 'atomize',
    cwd: options.cwd,
    messages: [
      message('error', 'ATM_ATOMIZE_UNKNOWN_SUBCOMMAND', `Unknown subcommand: ${options.subcommand}`, {
        supportedSubcommands: ['inventory']
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
          timestamp: result.report.timestamp
        })
      ],
      evidence: {
        inventory: result.report.inventory,
        registry_owned_paths: result.report.registry_owned_paths,
        unowned_paths_sample: result.report.unowned_paths_sample,
        suggested_actions: result.report.suggested_actions,
        gap_report: result.report.gap_report,
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
