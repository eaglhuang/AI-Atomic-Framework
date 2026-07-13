#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const gateCommands = new Map([
  ['ts-syntax', 'npm run typecheck'],
  ['typecheck', 'npm run typecheck'],
  ['eslint-rules', 'npm run lint'],
  ['lint', 'npm run lint'],
  ['validator-facade', 'npm run validate:test-facade'],
  ['test-facade', 'npm run validate:test-facade'],
  ['encoding-touched', 'npm run check:encoding:touched'],
  ['encoding-staged', 'npm run check:encoding:staged']
]);

const profileGates = new Map([
  ['quick', ['ts-syntax']],
  ['standard', ['ts-syntax', 'eslint-rules']],
  ['full', ['ts-syntax', 'eslint-rules', 'validator-facade']]
]);

function parseArgs(argv) {
  const options = {
    profile: null,
    gates: [],
    json: false,
    dryRun: false,
    agentFeedback: false,
    noStop: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--profile requires quick, standard, or full');
      options.profile = value;
      index += 1;
      continue;
    }
    if (arg === '--gates') {
      for (let cursor = index + 1; cursor < argv.length && !argv[cursor].startsWith('--'); cursor += 1) {
        options.gates.push(...argv[cursor].split(',').map((entry) => entry.trim()).filter(Boolean));
        index = cursor;
      }
      if (options.gates.length === 0) throw new Error('--gates requires at least one gate name');
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--agent-feedback') {
      options.agentFeedback = true;
      continue;
    }
    if (arg === '--no-stop') {
      options.noStop = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unsupported option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log([
    'Usage: node tools_node/compute-gate.js [--profile quick|standard|full] [--gates <gate...>] [--json] [--dry-run]',
    '',
    'Known gates: ts-syntax, eslint-rules, validator-facade, encoding-touched, encoding-staged.',
    'Examples:',
    '  node tools_node/compute-gate.js --profile quick',
    '  node tools_node/compute-gate.js --gates ts-syntax eslint-rules --json'
  ].join('\n'));
}

function shellCommand(command) {
  return process.platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { command: 'sh', args: ['-c', command] };
}

function resolvePlan(options) {
  const gates = options.gates.length > 0
    ? options.gates
    : profileGates.get(options.profile ?? 'standard');
  if (!gates) throw new Error(`Unknown profile: ${options.profile}`);
  return gates.map((gate) => {
    const command = gateCommands.get(gate);
    if (!command) {
      throw new Error(`Unknown gate: ${gate}. Known gates: ${[...gateCommands.keys()].join(', ')}`);
    }
    return { gate, command };
  });
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = resolvePlan(options);
    const runs = [];
    let ok = true;
    for (const item of plan) {
      if (options.dryRun) {
        runs.push({ ...item, exitCode: null, skipped: true });
        continue;
      }
      const shell = shellCommand(item.command);
      const result = spawnSync(shell.command, shell.args, { stdio: options.json ? 'pipe' : 'inherit', encoding: 'utf8' });
      const exitCode = typeof result.status === 'number' ? result.status : 1;
      runs.push({ ...item, exitCode, stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
      if (exitCode !== 0) {
        ok = false;
        if (!options.noStop) break;
      }
    }
    const output = { ok, command: 'compute-gate', profile: options.profile ?? 'standard', dryRun: options.dryRun, runs };
    if (options.json) console.log(JSON.stringify(output, null, 2));
    process.exit(ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = { ok: false, command: 'compute-gate', error: message };
    if (process.argv.includes('--json')) console.error(JSON.stringify(payload, null, 2));
    else console.error(message);
    process.exit(1);
  }
}

main();
