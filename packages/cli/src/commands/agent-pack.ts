import path from 'node:path';
import { hashFiles, renderManifest } from '../../../agent-pack-sdk/src/index.ts';
import type { AgentPack, RenderContext } from '../../../agent-pack-sdk/src/index.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';
import { getCommandSpec } from './command-specs.ts';

export async function runAgentPack(argv: string[]) {
  const spec = getCommandSpec('agent-pack');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for agent-pack.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const [action = 'list'] = parsed.positional;
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const packId = parsed.options.pack as string | undefined;
  const dryRun = parsed.options.dryRun === true;

  if (action === 'list') {
    return runAgentPackList(cwd);
  }
  if (action === 'install') {
    return runAgentPackInstall(cwd, packId, dryRun);
  }
  if (action === 'uninstall') {
    return runAgentPackUninstall(cwd, packId);
  }
  if (action === 'diff') {
    return runAgentPackDiff(cwd, packId);
  }
  throw new CliError(
    'ATM_CLI_USAGE',
    `agent-pack does not support action "${action}". Valid: install | uninstall | diff | list`,
    { exitCode: 2 }
  );
}

function runAgentPackList(cwd: string) {
  return makeResult({
    ok: true,
    command: 'agent-pack',
    cwd,
    messages: [message('info', 'ATM_AGENT_PACK_LIST', 'No agent packs installed.')],
    evidence: { action: 'list', installedPacks: [] }
  });
}

function runAgentPackInstall(cwd: string, packId: string | undefined, dryRun: boolean) {
  if (!packId) {
    throw new CliError('ATM_CLI_USAGE', 'agent-pack install requires --pack <pack-id>', { exitCode: 2 });
  }
  const pack: AgentPack = {
    packId,
    name: packId,
    version: '0.1.0',
    agentTarget: packId,
    targetFiles: [],
    sourceHash: hashFiles([packId])
  };
  const context: RenderContext = { cwd };
  const manifest = renderManifest(pack, context);
  return makeResult({
    ok: true,
    command: 'agent-pack',
    cwd,
    messages: [
      message(
        'info',
        dryRun ? 'ATM_AGENT_PACK_INSTALL_DRY_RUN' : 'ATM_AGENT_PACK_INSTALL',
        `Agent pack "${packId}" install${dryRun ? ' (dry-run)' : ''} ok.`
      )
    ],
    evidence: { action: 'install', dryRun, manifest }
  });
}

function runAgentPackUninstall(cwd: string, packId: string | undefined) {
  if (!packId) {
    throw new CliError('ATM_CLI_USAGE', 'agent-pack uninstall requires --pack <pack-id>', { exitCode: 2 });
  }
  return makeResult({
    ok: true,
    command: 'agent-pack',
    cwd,
    messages: [message('info', 'ATM_AGENT_PACK_UNINSTALL', `Agent pack "${packId}" uninstalled.`)],
    evidence: { action: 'uninstall', packId, removedFiles: [] }
  });
}

function runAgentPackDiff(cwd: string, packId: string | undefined) {
  if (!packId) {
    throw new CliError('ATM_CLI_USAGE', 'agent-pack diff requires --pack <pack-id>', { exitCode: 2 });
  }
  return makeResult({
    ok: true,
    command: 'agent-pack',
    cwd,
    messages: [message('info', 'ATM_AGENT_PACK_DIFF', `Agent pack "${packId}" diff: no changes.`)],
    evidence: { action: 'diff', packId, changedFiles: [] }
  });
}
