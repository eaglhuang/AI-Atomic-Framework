import { existsSync, mkdirSync } from 'node:fs';
import { CliError, configPathFor, ensureAtmDirectory, frameworkVersion, makeResult, message, parseOptions, relativePathFrom, writeJsonFile } from './shared.mjs';
import { adoptDefaultBootstrap } from './bootstrap.mjs';

export function runInit(argv) {
  const { options } = parseOptions(argv, 'init');
  if (options.adopt && options.adopt !== 'default') {
    throw new CliError('ATM_CLI_USAGE', `init does not support adopt profile ${options.adopt}`, { exitCode: 2 });
  }
  mkdirSync(options.cwd, { recursive: true });
  ensureAtmDirectory(options.cwd);

  const configPath = configPathFor(options.cwd);
  const configExists = existsSync(configPath);
  const created = [];
  const unchanged = [];

  if (!configExists || options.force) {
    writeJsonFile(configPath, createDefaultConfig(options));
    created.push(relativePathFrom(options.cwd, configPath));
  } else {
    unchanged.push(relativePathFrom(options.cwd, configPath));
  }

  const bootstrap = options.adopt === 'default'
    ? adoptDefaultBootstrap(options.cwd, { force: options.force, taskTitle: options.task })
    : {
        created: [],
        unchanged: [],
        adoptedProfile: null,
        bootstrapTaskPath: null,
        bootstrapLockPath: null,
        agentInstructionsPath: null,
        profilePath: null,
        projectProbePath: null,
        defaultGuardsPath: null,
        evidencePath: null,
        projectProbe: null,
        recommendedPrompt: null
      };

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
      created: [...created, ...bootstrap.created],
      unchanged: [...unchanged, ...bootstrap.unchanged],
      adapterMode: 'standalone',
      adapterImplemented: false,
      adoptedProfile: bootstrap.adoptedProfile,
      bootstrapTaskPath: bootstrap.bootstrapTaskPath,
      bootstrapLockPath: bootstrap.bootstrapLockPath,
      agentInstructionsPath: bootstrap.agentInstructionsPath,
      profilePath: bootstrap.profilePath,
      projectProbePath: bootstrap.projectProbePath,
      defaultGuardsPath: bootstrap.defaultGuardsPath,
      evidencePath: bootstrap.evidencePath,
      recommendedPrompt: bootstrap.recommendedPrompt
    }
  });
}

function createDefaultConfig(options) {
  const config = {
    schemaVersion: 'atm.config.v0.1',
    frameworkVersion,
    createdBy: '@ai-atomic-framework/cli',
    adapter: {
      mode: 'standalone',
      implemented: false
    },
    paths: {
      atomicSpecs: 'atoms',
      reports: '.atm/reports',
      profile: '.atm/profile',
      state: '.atm/state',
      tasks: '.atm/tasks',
      locks: '.atm/locks',
      artifacts: '.atm/artifacts',
      logs: '.atm/logs',
      evidence: '.atm/evidence',
      context: '.atm/context'
    },
    validation: {
      command: 'atm validate',
      output: 'json'
    }
  };

  if (options.adopt === 'default') {
    config.adoption = {
      profile: 'default',
      taskPath: '.atm/tasks/BOOTSTRAP-0001.json',
      lockPath: '.atm/locks/BOOTSTRAP-0001.lock.json',
      projectProbePath: '.atm/state/project-probe.json',
      defaultGuardsPath: '.atm/state/default-guards.json',
      evidencePath: '.atm/evidence/BOOTSTRAP-0001.json'
    };
  }

  return config;
}