import { existsSync, mkdirSync } from 'node:fs';
import { configPathFor, ensureAtmDirectory, frameworkVersion, makeResult, message, parseOptions, relativePathFrom, writeJsonFile } from './shared.mjs';

export function runInit(argv) {
  const { options } = parseOptions(argv, 'init');
  mkdirSync(options.cwd, { recursive: true });
  ensureAtmDirectory(options.cwd);

  const configPath = configPathFor(options.cwd);
  const configExists = existsSync(configPath);
  const created = [];
  const unchanged = [];

  if (!configExists || options.force) {
    writeJsonFile(configPath, createDefaultConfig());
    created.push(relativePathFrom(options.cwd, configPath));
  } else {
    unchanged.push(relativePathFrom(options.cwd, configPath));
  }

  return makeResult({
    ok: true,
    command: 'init',
    cwd: options.cwd,
    messages: [
      configExists && !options.force
        ? message('info', 'ATM_INIT_ALREADY_INITIALIZED', 'ATM config already exists; no files were changed.')
        : message('info', 'ATM_INIT_CREATED', 'ATM standalone config created.')
    ],
    evidence: {
      configPath: relativePathFrom(options.cwd, configPath),
      created,
      unchanged,
      adapterMode: 'standalone',
      adapterImplemented: false
    }
  });
}

function createDefaultConfig() {
  return {
    schemaVersion: 'atm.config.v0.1',
    frameworkVersion,
    createdBy: '@ai-atomic-framework/cli',
    adapter: {
      mode: 'standalone',
      implemented: false
    },
    paths: {
      atomicSpecs: 'atoms',
      reports: '.atm/reports'
    },
    validation: {
      command: 'atm validate',
      output: 'json'
    }
  };
}