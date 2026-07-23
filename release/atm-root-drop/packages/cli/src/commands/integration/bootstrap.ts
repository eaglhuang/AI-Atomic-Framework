import { existsSync } from 'node:fs';
import path from 'node:path';
import { availableAdapters, detectCurrentEditorIntegrationId, primaryEntryPathByAdapterId } from './adapters.ts';
import type { KnownCliIntegrationId } from './adapters.ts';
import { inspectTeamRuntimeBackendCapabilities } from './health.ts';
import type { GovernedVendorConfigSurface } from './types.ts';

export function discoverGovernedVendorConfigSurface(repositoryRoot: string): GovernedVendorConfigSurface {
  const rootDir = path.join(repositoryRoot, 'agent-integrations', 'vendors');
  return {
    rootDir,
    templateReadme: path.join(repositoryRoot, 'release', 'atm-root-drop', 'templates', 'root-drop', 'agent-integrations', 'vendors', 'README.md'),
    exists: existsSync(rootDir)
  };
}
export function inspectIntegrationBootstrap(repositoryRoot: string) {
  const repoBootstrapped = existsSync(path.join(repositoryRoot, '.atm', 'config.json'));
  const detectedEditor = detectCurrentEditorIntegrationId();
  const adapters = availableAdapters(repositoryRoot).map((adapter) => {
    const primaryEntryPath = primaryEntryPathByAdapterId[adapter.id as KnownCliIntegrationId];
    const primaryEntryPresent = existsSync(path.join(repositoryRoot, primaryEntryPath));
    const installCommand = `node atm.mjs integration add ${adapter.id} --json`;
    const verifyCommand = `node atm.mjs integration verify ${adapter.id} --json`;
    let status: 'installed' | 'manifest-only' | 'entry-only' | 'missing' = 'missing';
    if (adapter.installed && primaryEntryPresent) {
      status = 'installed';
    } else if (adapter.installed) {
      status = 'manifest-only';
    } else if (primaryEntryPresent) {
      status = 'entry-only';
    }
    return {
      ...adapter,
      primaryEntryPath,
      primaryEntryPresent,
      installCommand,
      verifyCommand,
      status
    };
  });
  const installedAdapters = adapters.filter((adapter) => adapter.status === 'installed').map((adapter) => adapter.id);
  const missingAdapters = adapters.filter((adapter) => adapter.status === 'missing').map((adapter) => adapter.id);
  const currentEditorAdapter = detectedEditor.id
    ? adapters.find((adapter) => adapter.id === detectedEditor.id) ?? null
    : null;
  const currentEditorAdapterMissing = Boolean(currentEditorAdapter && currentEditorAdapter.status !== 'installed');
  const reason = repoBootstrapped
    ? currentEditorAdapterMissing
      ? 'current-editor-missing'
      : installedAdapters.length === 0
        ? 'none-installed'
        : null
    : null;
  return {
    repoBootstrapped,
    currentEditorId: detectedEditor.id,
    currentEditorDetectedFrom: detectedEditor.source,
    currentEditorRawValue: detectedEditor.rawValue,
    editorIdentityIsProvenanceOnly: true,
    actorAuthorityNote: 'currentEditorRawValue is editor provenance only; it must not replace ATM_ACTOR_ID, --actor, or an active claim/lane/queue-head owner.',
    currentEditorAdapter,
    currentEditorAdapterMissing,
    needsInstallHint: reason !== null,
    reason,
    installedAdapters,
    missingAdapters,
    adapters,
    suggestedAction: reason === 'current-editor-missing' && currentEditorAdapter
      ? `Run \`node atm.mjs integration add ${currentEditorAdapter.id} --json\`, then \`node atm.mjs integration verify ${currentEditorAdapter.id} --json\`.`
      : reason === 'none-installed'
        ? 'Run `node atm.mjs integration add <editor-id> --json` for the editor you are using, then `node atm.mjs integration verify <editor-id> --json`.'
        : null
  };
}

export function describeIntegrationInstallHint(bootstrap: ReturnType<typeof inspectIntegrationBootstrap>) {
  if (!bootstrap.needsInstallHint) {
    return null;
  }
  const adapters = bootstrap.adapters.map((adapter) => ({
    id: adapter.id,
    displayName: adapter.displayName,
    status: adapter.status,
    primaryEntryPath: adapter.primaryEntryPath,
    installCommand: adapter.installCommand,
    verifyCommand: adapter.verifyCommand
  }));
  if (bootstrap.reason === 'current-editor-missing' && bootstrap.currentEditorAdapter) {
    return {
      text: `ATM runtime is ready, but the current editor (${bootstrap.currentEditorAdapter.displayName}) is missing its repo-local ATM integration. Install it before relying on ATM entry skills.`,
      data: {
        reason: bootstrap.reason,
        currentEditorId: bootstrap.currentEditorId,
        currentEditorDetectedFrom: bootstrap.currentEditorDetectedFrom,
        currentEditorRawValue: bootstrap.currentEditorRawValue,
        suggestedAction: bootstrap.suggestedAction,
        adapters
      }
    };
  }
  return {
    text: 'ATM runtime is ready, but no repo-local editor integration is installed yet. Install the adapter for the editor you are using before relying on ATM entry skills.',
    data: {
      reason: bootstrap.reason,
      currentEditorId: bootstrap.currentEditorId,
      currentEditorDetectedFrom: bootstrap.currentEditorDetectedFrom,
      currentEditorRawValue: bootstrap.currentEditorRawValue,
      suggestedAction: bootstrap.suggestedAction,
      adapters
    }
  };
}
