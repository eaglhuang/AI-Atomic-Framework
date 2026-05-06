import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const configRelativePath = path.join('.atm', 'config.json');
export const frameworkVersion = '0.0.0';

export class CliError extends Error {
  constructor(code, text, options = {}) {
    super(text);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? {};
  }
}

export function message(level, code, text, data = {}) {
  return { level, code, text, data };
}

export function makeResult({ ok, command, cwd, mode = 'standalone', messages = [], evidence = {} }) {
  return {
    ok,
    command,
    mode,
    cwd,
    messages,
    evidence
  };
}

export function writeResult(result, stream) {
  stream.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function parseOptions(argv, commandName) {
  const options = {
    cwd: process.cwd(),
    spec: undefined,
    validate: undefined,
    force: false,
    adopt: undefined,
    task: undefined
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd', commandName);
      index += 1;
      continue;
    }
    if (arg === '--spec') {
      options.spec = requireOptionValue(argv, index, '--spec', commandName);
      index += 1;
      continue;
    }
    if (arg === '--validate') {
      if (commandName !== 'spec') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --validate`, { exitCode: 2 });
      }
      options.validate = requireOptionValue(argv, index, '--validate', commandName);
      index += 1;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--adopt') {
      if (commandName !== 'init') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --adopt`, { exitCode: 2 });
      }
      options.adopt = requireOptionValue(argv, index, '--adopt', commandName);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      if (commandName !== 'init' && commandName !== 'bootstrap') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --task`, { exitCode: 2 });
      }
      options.task = requireOptionValue(argv, index, '--task', commandName);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option ${arg}`, { exitCode: 2 });
    }
    positional.push(arg);
  }

  return {
    options: {
      ...options,
      cwd: path.resolve(options.cwd)
    },
    positional
  };
}

export function configPathFor(cwd) {
  return path.join(cwd, configRelativePath);
}

export function relativePathFrom(cwd, absolutePath) {
  return path.relative(cwd, absolutePath).replace(/\\/g, '/');
}

export function ensureAtmDirectory(cwd) {
  const directory = path.join(cwd, '.atm');
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function readJsonFile(filePath, missingCode = 'ATM_JSON_NOT_FOUND') {
  if (!existsSync(filePath)) {
    throw new CliError(missingCode, `JSON file not found: ${filePath}`, { details: { filePath } });
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new CliError('ATM_JSON_INVALID', `Invalid JSON file: ${filePath}`, {
      details: {
        filePath,
        reason: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

export function writeJsonFile(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function requireOptionValue(argv, optionIndex, optionName, commandName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `${commandName} requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}