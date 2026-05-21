import {
  isCacheEnabled,
  enableGuideCache,
  disableGuideCache,
  clearCache,
  getCacheStatus
} from '../../../core/src/cache/guide-cache.ts';
import { CliError, makeResult, message } from './shared.ts';

const KNOWN_CACHE_ACTIONS = ['enable', 'disable', 'clear', 'status'];

interface CacheOptions {
  cwd: string;
  action: string;
  goalFilter?: string;
}

function parseCacheArgs(argv: string[]): CacheOptions {
  const cwd = process.cwd();
  let goalFilter: string | undefined;

  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--goal' && argv[i + 1]) {
      goalFilter = argv[++i];
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  return { cwd, action: positionals[0] ?? 'status', goalFilter };
}

export async function runCache(argv: string[]) {
  const options = parseCacheArgs(argv);

  if (!KNOWN_CACHE_ACTIONS.includes(options.action)) {
    throw new CliError('ATM_CLI_USAGE',
      `cache subcommand "${options.action}" not recognized. Valid: ${KNOWN_CACHE_ACTIONS.join(', ')}`,
      { exitCode: 2 }
    );
  }

  switch (options.action) {
    case 'enable':
      return runCacheEnable(options);
    case 'disable':
      return runCacheDisable(options);
    case 'clear':
      return runCacheClear(options);
    case 'status':
      return runCacheStatus(options);
    default:
      throw new CliError('ATM_CLI_USAGE', `Unhandled cache action: ${options.action}`, { exitCode: 2 });
  }
}

function runCacheEnable(options: CacheOptions) {
  enableGuideCache(options.cwd);
  return makeResult({
    ok: true,
    command: 'cache',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_CACHE_ENABLED',
        'Guide Cache enabled. candidates rank will now use the cache.',
        {
          enabled: true,
          warning: 'Guide Cache is opt-in due to AI-drift risk. Dirty working tree will always bypass cache. Use --no-cache to skip per-call.'
        }
      )
    ],
    evidence: { enabled: true }
  });
}

function runCacheDisable(options: CacheOptions) {
  disableGuideCache(options.cwd);
  return makeResult({
    ok: true,
    command: 'cache',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_CACHE_DISABLED',
        'Guide Cache disabled. Cache files are preserved and can be re-enabled.',
        { enabled: false }
      )
    ],
    evidence: { enabled: false }
  });
}

function runCacheClear(options: CacheOptions) {
  const result = clearCache(options.cwd, { goalFilter: options.goalFilter });
  return makeResult({
    ok: true,
    command: 'cache',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_CACHE_CLEARED',
        `Cleared ${result.clearedEntries} cache entry(ies), freed ${result.freedBytes} bytes.`,
        {
          clearedEntries: result.clearedEntries,
          freedBytes: result.freedBytes,
          goalFilter: options.goalFilter ?? null
        }
      )
    ],
    evidence: { result }
  });
}

function runCacheStatus(options: CacheOptions) {
  const status = getCacheStatus(options.cwd);
  return makeResult({
    ok: true,
    command: 'cache',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_CACHE_STATUS',
        status.enabled
          ? `Guide Cache enabled. ${status.entryCount} entry(ies), ${status.totalBytes} bytes.`
          : 'Guide Cache disabled (run `atm cache enable` to opt in).',
        status
      )
    ],
    evidence: { status }
  });
}
