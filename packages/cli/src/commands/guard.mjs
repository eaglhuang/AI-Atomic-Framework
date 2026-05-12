import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from './shared.mjs';

export function runGuard(argv) {
  const options = parseGuardArgs(argv);
  if (options.guardName !== 'encoding') {
    throw new CliError('ATM_CLI_USAGE', 'guard currently supports only: encoding', { exitCode: 2 });
  }

  const findings = [];
  for (const relativeFile of options.files) {
    const absolutePath = path.resolve(options.cwd, relativeFile);
    const buffer = readFileSync(absolutePath);
    const text = buffer.toString('utf8');
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      findings.push({ file: relativeFile, issue: 'utf8-bom' });
    }
    if (text.includes('\uFFFD')) {
      findings.push({ file: relativeFile, issue: 'replacement-character' });
    }
    if (/Ã.|â.|å.|ç./.test(text)) {
      findings.push({ file: relativeFile, issue: 'possible-mojibake' });
    }
  }

  return makeResult({
    ok: findings.length === 0,
    command: 'guard',
    cwd: options.cwd,
    messages: [findings.length === 0 ? message('info', 'ATM_GUARD_ENCODING_OK', 'Encoding guard passed.') : message('error', 'ATM_GUARD_ENCODING_FAILED', 'Encoding guard found issues.', { findingCount: findings.length })],
    evidence: {
      guard: 'encoding',
      files: options.files,
      findings
    }
  });
}

function parseGuardArgs(argv) {
  const state = {
    cwd: process.cwd(),
    guardName: null,
    files: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--files') {
      state.files = requireValue(argv, index, '--files').split(',').map((entry) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `guard does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.guardName) {
      throw new CliError('ATM_CLI_USAGE', 'guard accepts only one guard name', { exitCode: 2 });
    }
    state.guardName = arg;
  }

  if (!state.guardName) {
    throw new CliError('ATM_CLI_USAGE', 'guard requires a guard name', { exitCode: 2 });
  }
  if (state.guardName === 'encoding' && state.files.length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'guard encoding requires --files <comma-separated-paths>', { exitCode: 2 });
  }

  return {
    cwd: path.resolve(state.cwd),
    guardName: state.guardName,
    files: state.files
  };
}

function requireValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `guard requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
