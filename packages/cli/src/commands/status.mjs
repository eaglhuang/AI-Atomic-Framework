import { existsSync } from 'node:fs';
import { configPathFor, makeResult, message, parseOptions, readJsonFile, relativePathFrom } from './shared.mjs';

export function runStatus(argv) {
  const { options } = parseOptions(argv, 'status');
  const configPath = configPathFor(options.cwd);

  if (!existsSync(configPath)) {
    return makeResult({
      ok: false,
      command: 'status',
      cwd: options.cwd,
      messages: [message('error', 'ATM_CONFIG_MISSING', 'ATM config is missing. Run atm init first.')],
      evidence: {
        configPath: relativePathFrom(options.cwd, configPath),
        initialized: false
      }
    });
  }

  const config = readJsonFile(configPath, 'ATM_CONFIG_MISSING');
  const schemaVersionOk = config.schemaVersion === 'atm.config.v0.1';
  const adapterMode = config.adapter?.mode ?? 'unknown';
  const adapterImplemented = config.adapter?.implemented === true;

  return makeResult({
    ok: schemaVersionOk,
    command: 'status',
    cwd: options.cwd,
    messages: [
      schemaVersionOk
        ? message('info', 'ATM_STATUS_READY', 'ATM standalone config is ready.')
        : message('error', 'ATM_CONFIG_UNSUPPORTED_VERSION', 'ATM config schemaVersion is not supported.', { schemaVersion: config.schemaVersion })
    ],
    evidence: {
      configPath: relativePathFrom(options.cwd, configPath),
      initialized: true,
      schemaVersion: config.schemaVersion,
      adapterMode,
      adapterImplemented,
      standaloneMode: adapterMode === 'standalone' && !adapterImplemented
    }
  });
}