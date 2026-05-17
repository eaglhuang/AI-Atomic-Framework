import { existsSync, mkdirSync } from 'node:fs';
import { CliError, configPathFor, ensureAtmDirectory, frameworkVersion, makeResult, message, parseOptions, relativePathFrom, writeJsonFile } from './shared.ts';
import { adoptDefaultBootstrap, installDefaultRootDropScripts } from './bootstrap.ts';
import type { LocalGovernanceBootstrapResult } from '../../../plugin-governance-local/src/index.ts';
import { installIntegrationAdapter } from './integration.ts';

export async function runInit(argv: any) {
  const { options } = parseOptions(argv, 'init');
  const shouldAdoptDefault = options.adopt === 'default' || typeof options.integration === 'string';
  if (options.adopt && options.adopt !== 'default') {
    throw new CliError('ATM_CLI_USAGE', `init does not support adopt profile ${options.adopt}`, { exitCode: 2 });
  }
  if (options.dryRun) {
    return createDryRunResult(options);
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

  const bootstrap: LocalGovernanceBootstrapResult | {
    created: string[];
    unchanged: string[];
    adoptedProfile: null;
    bootstrapTaskPath: null;
    bootstrapLockPath: null;
    agentInstructionsPath: null;
    profilePath: null;
    projectProbePath: null;
    defaultGuardsPath: null;
    evidencePath: null;
    contextBudgetPolicyPath: null;
    contextBudgetReportPath: null;
    contextBudgetSummaryPath: null;
    contextSummaryPath: null;
    contextSummaryMarkdownPath: null;
    continuationReportPath: null;
    projectProbe: null;
    recommendedPrompt: null;
    charterPath: null;
    charterInvariantsPath: null;
    scriptPaths: [];
  } = shouldAdoptDefault
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
        contextBudgetPolicyPath: null,
        contextBudgetReportPath: null,
        contextBudgetSummaryPath: null,
        contextSummaryPath: null,
        contextSummaryMarkdownPath: null,
        continuationReportPath: null,
        projectProbe: null,
        recommendedPrompt: null,
        charterPath: null,
        charterInvariantsPath: null,
        scriptPaths: []
      };

  const scriptInstall = shouldAdoptDefault
    ? { created: [], unchanged: [], scriptPaths: bootstrap.scriptPaths, platformHintPath: process.platform === 'win32' ? '.atm/scripts/ps' : '.atm/scripts/sh' }
    : installDefaultRootDropScripts(options.cwd, { force: options.force });

  const integrationInstall = options.integration
    ? await installIntegrationAdapter(options.cwd, options.integration, {
        actor: '@ai-atomic-framework/cli',
        force: options.force
      })
    : null;

  return makeResult({
    ok: true,
    command: 'init',
    cwd: options.cwd,
    messages: [
      configExists && !options.force
        ? message('info', 'ATM_INIT_ALREADY_INITIALIZED', 'ATM config already exists; no files were changed.')
        : message('info', 'ATM_INIT_CREATED', 'ATM standalone config created.'),
      ...(integrationInstall ? [message('info', 'ATM_INIT_INTEGRATION_ADDED', `Integration adapter ${integrationInstall.adapter.id} installed during init.`)] : [])
    ],
    evidence: {
      configPath: relativePathFrom(options.cwd, configPath),
      created: [...created, ...bootstrap.created, ...scriptInstall.created],
      unchanged: [...unchanged, ...bootstrap.unchanged, ...scriptInstall.unchanged],
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
      contextBudgetPolicyPath: bootstrap.contextBudgetPolicyPath,
      contextBudgetReportPath: bootstrap.contextBudgetReportPath,
      contextBudgetSummaryPath: bootstrap.contextBudgetSummaryPath,
      contextSummaryPath: bootstrap.contextSummaryPath,
      contextSummaryMarkdownPath: bootstrap.contextSummaryMarkdownPath,
      continuationReportPath: bootstrap.continuationReportPath,
      recommendedPrompt: bootstrap.recommendedPrompt,
      charterPath: bootstrap.charterPath,
      charterInvariantsPath: bootstrap.charterInvariantsPath,
      scriptPaths: scriptInstall.scriptPaths,
      scriptPlatformHintPath: scriptInstall.platformHintPath,
      integrationInstall,
      adoptedAt: bootstrap.adoptedProfile ? new Date().toISOString() : null
    }
  });
}

function createDryRunResult(options: any) {
  const configPath = configPathFor(options.cwd);
  const shouldAdoptDefault = options.adopt === 'default' || typeof options.integration === 'string';
  return makeResult({
    ok: true,
    command: 'init',
    cwd: options.cwd,
    messages: [message('info', 'ATM_INIT_DRY_RUN_OK', 'ATM init adoption dry-run completed.')],
    evidence: {
      configPath: relativePathFrom(options.cwd, configPath),
      created: [],
      unchanged: [],
      adapterMode: 'standalone',
      adapterImplemented: false,
      adoptedProfile: shouldAdoptDefault ? 'default' : null,
      contextBudgetPolicyPath: shouldAdoptDefault ? '.atm/runtime/budget/default-policy.json' : null,
      contextBudgetReportPath: shouldAdoptDefault ? '.atm/history/reports/context-budget/bootstrap-bootstrap-BOOTSTRAP-0001.json' : null,
      contextBudgetSummaryPath: null,
      contextSummaryPath: shouldAdoptDefault ? '.atm/history/handoff/BOOTSTRAP-0001.json' : null,
      contextSummaryMarkdownPath: shouldAdoptDefault ? '.atm/history/handoff/BOOTSTRAP-0001.md' : null,
      continuationReportPath: shouldAdoptDefault ? '.atm/history/reports/continuation/BOOTSTRAP-0001.json' : null,
      scriptPaths: expectedRootDropScriptPaths(),
      scriptPlatformHintPath: process.platform === 'win32' ? '.atm/scripts/ps' : '.atm/scripts/sh',
      adoptedAt: shouldAdoptDefault ? new Date().toISOString() : null,
      integrationId: options.integration ?? null,
      dryRun: true
    }
  });
}

function expectedRootDropScriptPaths() {
  return [
    'atm-next',
    'atm-orient',
    'atm-create',
    'atm-lock',
    'atm-evidence',
    'atm-upgrade-scan',
    'atm-handoff'
  ].flatMap((scriptName) => [
    `.atm/scripts/sh/${scriptName}.sh`,
    `.atm/scripts/ps/${scriptName}.ps1`
  ]);
}

function createDefaultConfig(options: any) {
  const shouldAdoptDefault = options.adopt === 'default' || typeof options.integration === 'string';
  const config: Record<string, any> = {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    frameworkVersion,
    createdBy: '@ai-atomic-framework/cli',
    adapter: {
      mode: 'standalone',
      implemented: false
    },
    paths: {
      atomicSpecs: 'atoms',
      runtime: '.atm/runtime',
      history: '.atm/history',
      catalog: '.atm/catalog',
      profile: '.atm/runtime/profile',
      currentTask: '.atm/runtime/current-task.json',
      state: '.atm/runtime/state',
      tasks: '.atm/history/tasks',
      locks: '.atm/runtime/locks',
      artifacts: '.atm/history/artifacts',
      logs: '.atm/history/logs',
      evidence: '.atm/history/evidence',
      handoff: '.atm/history/handoff',
      reports: '.atm/history/reports',
      contextBudget: '.atm/runtime/budget',
      contextSummary: '.atm/history/handoff',
      registry: '.atm/catalog/registry',
      index: '.atm/catalog/index',
      shards: '.atm/catalog/shards'
    },
    validation: {
      command: 'atm validate',
      output: 'json'
    }
  };

  if (shouldAdoptDefault) {
    config.adoption = {
      profile: 'default',
      taskPath: '.atm/history/tasks/BOOTSTRAP-0001.json',
      lockPath: '.atm/runtime/locks/BOOTSTRAP-0001.lock.json',
      projectProbePath: '.atm/runtime/project-probe.json',
      defaultGuardsPath: '.atm/runtime/default-guards.json',
      evidencePath: '.atm/history/evidence/BOOTSTRAP-0001.json',
      currentTaskPath: '.atm/runtime/current-task.json'
    };
  }

  return config;
}
