import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { runBootstrap } from './bootstrap-entry.ts';
import { runWelcome } from './welcome.ts';
import { installIntegrationAdapter } from './integration/install.ts';
import { runIntegration } from './integration/run.ts';
import { getCommandSpec } from './command-specs.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';
import { detectInstalledAgents, supportedAgentIds, type AgentDetectionOptions } from './setup/detection.ts';
import { validateSetupTarget } from './setup/target.ts';
import { codexBridgeManifest, codexHostBridge } from './setup/codex-bridge.ts';
import { safeIntegrationHooks } from './integration/safe-hooks.ts';
import { preflightBootstrap } from './setup/bootstrap-preflight.ts';
import { setupRunnerPath } from './setup/runner.ts';
import { ensureSetupProjectRunner, preflightSetupProjectRunner } from './setup/project-runner.ts';

export interface SetupInput {
  readonly interactive?: boolean;
  readonly ask?: (question: string) => Promise<string>;
  readonly detection?: Omit<AgentDetectionOptions, 'repositoryRoot'>;
}

function isAdopterProjectRoot(dir: string): boolean {
  const packageJson = path.join(dir, 'package.json');
  if (existsSync(packageJson)) {
    try { if (JSON.parse(readFileSync(packageJson, 'utf8')).name === 'ai-atomic-framework') return false; } catch { /* unreadable package.json still marks a project */ }
  }
  return existsSync(path.join(dir, '.git')) || existsSync(packageJson);
}

/** One composition of existing project governance. No agent login/global writes. */
export async function runSetup(argv: string[], input: SetupInput = {}) {
  const spec = getCommandSpec('setup');
  if (!spec) throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'Setup command spec is unavailable.', { exitCode: 2 });
  const parsed = parseArgsForCommand(spec, argv);
  if (parsed.positional.length) throw new CliError('ATM_CLI_USAGE', 'Use --cwd to select the target project.', { exitCode: 2 });
  const interactive = !argv.includes('--json') && (input.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));
  async function ask(question: string): Promise<string> {
    if (!interactive) throw new CliError('ATM_SETUP_SELECTION_REQUIRED', `${question} Pass explicit --cwd and --agents (or none) in noninteractive mode.`, { exitCode: 2 });
    if (input.ask) return input.ask(question);
    const terminal = createInterface({ input: process.stdin, output: process.stderr });
    try { return await terminal.question(`${question} `); } finally { terminal.close(); }
  }
  const targetOption = parsed.options.cwd;
  // Running setup from inside a project means that project: only ask (or fail
  // in noninteractive mode) when the current directory is not a project root.
  const cwdLooksLikeProject = isAdopterProjectRoot(process.cwd());
  const target = typeof targetOption === 'string' ? targetOption
    : !interactive && cwdLooksLikeProject ? process.cwd()
    : (await ask('Which project directory should receive ATM?')).trim();
  if (!target) throw new CliError('ATM_SETUP_CANCELLED', 'Setup cancelled before writing: no project was selected.', { exitCode: 2 });
  const cwd = validateSetupTarget(target, input.detection?.homeDir, input.detection?.env);
  const detection = detectInstalledAgents({ ...input.detection, repositoryRoot: cwd });
  let selection = typeof parsed.options.agents === 'string' ? parsed.options.agents : detection.adapters.map(entry => entry.id).join(',');
  if (!selection) selection = (await ask(`No agent configuration was detected. Select ${supportedAgentIds.join(', ')} or none:`)).trim();
  const agents = selection === 'none' ? [] : [...new Set(selection.split(',').map(id => id.trim()))];
  if (agents.some(id => !supportedAgentIds.includes(id as typeof supportedAgentIds[number]))) {
    throw new CliError('ATM_SETUP_UNKNOWN_AGENT', `Use supported adapter IDs: ${supportedAgentIds.join(', ')}, or none.`, { exitCode: 2 });
  }
  const steps: { name: string; ok: boolean; code?: string; detail?: string }[] = [];
  let failure: string | null = null;
  const dryRun = parsed.options.dryRun === true;
  const bridge = agents.includes('codex') ? codexHostBridge(cwd) : null;
  let nativeBridge: string[] = [];
  let projectRunner: ReturnType<typeof ensureSetupProjectRunner> | null = null;
  const runner = setupRunnerPath();
  const recoveryArgs = [runner, 'setup', '--cwd', cwd, '--agents', agents.length ? agents.join(',') : 'none', '--json'];
  try {
    preflightBootstrap(cwd);
    preflightSetupProjectRunner(cwd);
    // Plan every adapter before bootstrap writes any configuration that could
    // alter detection. No --force is used, including on repeat installations.
    for (const id of agents) {
      await installIntegrationAdapter(cwd, id, { dryRun: true, merge: true });
      await safeIntegrationHooks(cwd, id, true);
    }
    if (bridge) await bridge.install({ repositoryRoot: cwd, manifestPath: codexBridgeManifest, dryRun: true, merge: true });
    steps.push({ name: 'preflight', ok: true });
    if (!dryRun) {
      const bootstrap = await runBootstrap(['--cwd', cwd]);
      steps.push({ name: 'bootstrap', ok: bootstrap.ok });
      if (!bootstrap.ok) throw new Error('Bootstrap failed; review its diagnostics before rerunning setup.');
      const pinned = bootstrap.evidence.pinnedRunner as { status?: string } | null;
      projectRunner = ensureSetupProjectRunner(cwd, pinned?.status);
      steps.push({ name: 'project runner', ok: true });
      for (const id of agents) {
        const installed = await runIntegration(['add', id, '--merge', '--cwd', cwd]);
        steps.push({ name: `integration add ${id}`, ok: installed.ok });
        if (!installed.ok) throw new Error(`Integration or hook installation failed: ${id}`);
      }
      if (bridge) {
        const report = await bridge.install({ repositoryRoot: cwd, manifestPath: codexBridgeManifest, merge: true });
        const verified = await bridge.verify({ repositoryRoot: cwd, manifestPath: codexBridgeManifest }, report.manifest);
        steps.push({ name: 'codex native entry', ok: verified.ok });
        if (!verified.ok) throw new Error('Codex native entry verification failed.');
        nativeBridge = report.manifest.files.map(file => file.path);
      }
      for (const id of agents) {
        const verified = await runIntegration(['verify', id, '--cwd', cwd]);
        steps.push({ name: `integration verify ${id}`, ok: verified.ok });
        if (!verified.ok) throw new Error(`Integration verification failed: ${id}. Run node atm.mjs integration verify ${id} --json in the selected project.`);
      }
      const welcome = await runWelcome(['--cwd', cwd]);
      const health = welcome.evidence.integrations as { ok?: boolean } | undefined;
      const ready = welcome.ok && health?.ok === true;
      steps.push({ name: 'welcome', ok: ready });
      if (!ready) throw new Error('Welcome reported unhealthy integrations; inspect node atm.mjs welcome --json in the selected project.');
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    steps.push({ name: 'setup stopped', ok: false, detail: failure });
  }
  return makeResult({
    ok: failure === null, command: 'setup', cwd,
    messages: [message(failure ? 'error' : 'info', failure ? 'ATM_SETUP_FAILED' : dryRun ? 'ATM_SETUP_PLAN_READY' : 'ATM_SETUP_READY',
      failure ?? (dryRun ? 'Setup preflight passed without writing.' : `ATM setup verified for ${cwd}.`)),
      ...(failure || dryRun ? [] : [message('info', 'ATM_SETUP_TRY_NEXT', 'Next: open this project in your AI editor and say: "Use ATM governance to inspect this repo and suggest the next safe improvement."')])],
    evidence: { dryRun, projectRoot: cwd, agents, cliOnly: agents.length === 0, detection,
      detectionMeaning: 'Configuration paths and explicit editor environment hints are not proof of installation, authentication, or an active agent session.',
      globalWrites: false, steps, failure, projectRunner,
      recovery: failure ? { executable: process.execPath, args: recoveryArgs, cwd } : null,
      recoveryCommand: failure ? [process.execPath, ...recoveryArgs].map(value => JSON.stringify(value)).join(' ') : null,
      nextCommand: dryRun || failure ? null : `node ${JSON.stringify(path.join(cwd, 'atm.mjs'))} next --cwd ${JSON.stringify(cwd)} --prompt "<current user prompt>" --json`,
      nativeBridge }
  });
}
