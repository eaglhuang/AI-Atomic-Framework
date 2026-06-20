import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createClaudeCodeIntegrationAdapter } from '../../../integration-claude-code/src/index.ts';
import { createCopilotIntegrationAdapter } from '../../../integration-copilot/src/index.ts';
import { createCodexIntegrationAdapter } from '../../../integration-codex/src/index.ts';
import { createCursorIntegrationAdapter } from '../../../integration-cursor/src/index.ts';
import { createAntigravityIntegrationAdapter, createGeminiIntegrationAdapter } from '../../../integration-gemini/src/index.ts';
import type { InstallManifest, IntegrationAdapter } from '../../../integrations-core/src/index.ts';
import { CliError, ensureAtmDirectory, makeResult, message, parseArgsForCommand, readJsonFile, relativePathFrom, resolveValue } from './shared.ts';
import { getCommandSpec } from './command-specs.ts';
type IntegrationHooksModule = typeof import('./integration-hooks.ts');

export type GovernedVendorConfigSurface = {
  rootDir: string;
  templateReadme: string;
  exists: boolean;
};

export function discoverGovernedVendorConfigSurface(repositoryRoot: string): GovernedVendorConfigSurface {
  const rootDir = path.join(repositoryRoot, 'agent-integrations', 'vendors');
  return {
    rootDir,
    templateReadme: path.join(repositoryRoot, 'release', 'atm-root-drop', 'templates', 'root-drop', 'agent-integrations', 'vendors', 'README.md'),
    exists: existsSync(rootDir)
  };
}

async function loadIntegrationHooks(): Promise<IntegrationHooksModule> {
  return import('./integration-hooks.ts');
}

const integrationAdapterFactories = Object.freeze({
  'claude-code': createClaudeCodeIntegrationAdapter,
  codex: createCodexIntegrationAdapter,
  copilot: createCopilotIntegrationAdapter,
  cursor: createCursorIntegrationAdapter,
  gemini: createGeminiIntegrationAdapter,
  antigravity: createAntigravityIntegrationAdapter
});

const primaryEntryPathByAdapterId = Object.freeze({
  'claude-code': '.claude/skills/atm-governance-router/SKILL.md',
  codex: 'integrations/codex-skills/atm-governance-router/SKILL.md',
  copilot: '.github/instructions/atm-governance-router.instructions.md',
  cursor: '.cursor/rules/skills/atm-governance-router/SKILL.md',
  gemini: '.gemini/commands/atm-governance-router.toml',
  antigravity: 'GEMINI.md'
} satisfies Record<KnownCliIntegrationId, string>);

type KnownCliIntegrationId = keyof typeof integrationAdapterFactories;
type EditorDetectionSource = 'ATM_EDITOR_ID' | 'ATM_ACTOR_ID' | 'AGENT_IDENTITY' | 'CODEX_HOME';

interface DetectedCurrentEditor {
  readonly id: KnownCliIntegrationId | null;
  readonly source: EditorDetectionSource | null;
  readonly rawValue: string | null;
}

export interface InstallIntegrationOptions {
  readonly actor?: string;
  readonly now?: string;
  readonly dryRun?: boolean;
  readonly force?: boolean;
}

export async function checkIntegrationHealth(repositoryRoot: string) {
  const manifestDirectory = path.join(repositoryRoot, '.atm', 'integrations');
  if (!existsSync(manifestDirectory)) {
    return {
      ok: true,
      manifestDir: '.atm/integrations',
      installed: [],
      manifests: [],
      failed: []
    };
  }

  const manifestReports = await Promise.all(readdirSync(manifestDirectory)
    .filter((entryName) => entryName.endsWith('.manifest.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((entryName) => verifyManifestFile(repositoryRoot, entryName)));

  return {
    ok: manifestReports.every((report) => report.ok),
    manifestDir: '.atm/integrations',
    installed: manifestReports.filter((report) => report.adapterId).map((report) => report.adapterId),
    manifests: manifestReports,
    failed: manifestReports.filter((report) => !report.ok)
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

export async function runIntegration(argv: string[]) {
  const spec = getCommandSpec('integration');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for integration.', { exitCode: 2 });
  }
  if (argv[0] === 'hook') {
    const hooks = await loadIntegrationHooks();
    return hooks.runIntegrationHookInvocation(argv.slice(1));
  }
  const parsed = parseArgsForCommand(spec, argv);
  const [action = 'list', adapterId, maybeHookAdapterId] = parsed.positional;
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  if (action === 'hooks') {
    const hooksAction = adapterId;
    const hookAdapterId = maybeHookAdapterId;
    if (hooksAction === 'install') {
      const requiredHookAdapterId = requireAdapterId(hookAdapterId, 'hooks install');
      if (parsed.options.dryRun !== true && !existsSync(path.join(cwd, manifestPathForIntegration(requiredHookAdapterId)))) {
        await installIntegrationAdapter(cwd, requiredHookAdapterId, {
          actor: asOptionalString(parsed.options.actor),
          dryRun: false,
          force: parsed.options.force === true
        });
      }
      const hooks = await loadIntegrationHooks();
      return hooks.makeIntegrationHookInstallResult(cwd, requiredHookAdapterId, {
        dryRun: parsed.options.dryRun === true,
        force: parsed.options.force === true
      });
    }
    if (hooksAction === 'verify') {
      const hooks = await loadIntegrationHooks();
      return hooks.makeIntegrationHookVerifyResult(cwd, requireAdapterId(hookAdapterId, 'hooks verify'));
    }
    throw new CliError('ATM_CLI_USAGE', 'integration hooks supports only: install | verify', { exitCode: 2 });
  }

  if (action === 'list') {
    return createIntegrationListResult(cwd);
  }

  if (action === 'add') {
    const report = await installIntegrationAdapter(cwd, requireAdapterId(adapterId, action), {
      actor: asOptionalString(parsed.options.actor),
      now: asOptionalString(parsed.options.at),
      dryRun: parsed.options.dryRun === true,
      force: parsed.options.force === true
    });
    const hookInstallReport = parsed.options.dryRun === true || (adapterId !== 'copilot' && adapterId !== 'claude-code')
      ? null
      : (await loadIntegrationHooks()).installEditorIntegrationHooks(cwd, adapterId, { force: true });
    return makeResult({
      ok: true,
      command: 'integration',
      cwd,
      messages: [
        message('info', report.dryRun ? 'ATM_INTEGRATION_ADD_DRY_RUN' : 'ATM_INTEGRATION_ADDED', report.dryRun
          ? `Integration adapter ${report.adapter.id} install dry-run completed.`
          : `Integration adapter ${report.adapter.id} installed.`)
      ],
      evidence: {
        action,
        ...report,
        hookInstallReport
      }
    });
  }

  if (action === 'verify') {
    const adapter = createIntegrationAdapter(requireAdapterId(adapterId, action));
    const manifestPath = manifestPathForIntegration(adapter.id);
    const manifest = readIntegrationManifest(cwd, adapter.id);
    const verifyReport = await resolveValue(adapter.verify(createIntegrationContext(cwd, adapter, {}), manifest));
    const hookVerifyReport = adapter.id === 'copilot' || adapter.id === 'claude-code'
      ? (await loadIntegrationHooks()).verifyEditorIntegrationHooks(cwd, adapter.id)
      : null;
    const ok = verifyReport.ok && (hookVerifyReport?.ok ?? true);
    return makeResult({
      ok,
      command: 'integration',
      cwd,
      messages: [
        ok
          ? message('info', 'ATM_INTEGRATION_VERIFY_OK', `Integration adapter ${adapter.id} matches its manifest.`)
          : message('error', 'ATM_INTEGRATION_VERIFY_DRIFT', `Integration adapter ${adapter.id} has manifest drift.`)
      ],
      evidence: {
        action,
        adapter: describeAdapter(adapter, cwd),
        manifestPath,
        findings: verifyReport.findings,
        driftedFiles: verifyReport.driftedFiles,
        hookVerifyReport
      }
    });
  }

  if (action === 'remove') {
    const adapter = createIntegrationAdapter(requireAdapterId(adapterId, action));
    const manifestPath = manifestPathForIntegration(adapter.id);
    const manifest = readIntegrationManifest(cwd, adapter.id);
    const uninstallReport = await resolveValue(adapter.uninstall(createIntegrationContext(cwd, adapter, {}), manifest));
    return makeResult({
      ok: uninstallReport.ok,
      command: 'integration',
      cwd,
      messages: [message('info', 'ATM_INTEGRATION_REMOVED', `Integration adapter ${adapter.id} uninstall completed.`)],
      evidence: {
        action,
        adapter: describeAdapter(adapter, cwd),
        manifestPath,
        removedFiles: uninstallReport.removedFiles,
        preservedFiles: uninstallReport.preservedFiles,
        findings: uninstallReport.findings
      }
    });
  }

  throw new CliError('ATM_CLI_USAGE', `integration does not support action ${action}`, {
    exitCode: 2,
    details: {
      supportedActions: ['list', 'add', 'verify', 'remove', 'hook', 'hooks']
    }
  });
}

export async function installIntegrationAdapter(repositoryRoot: string, adapterId: string, options: InstallIntegrationOptions = {}) {
  const adapter = createIntegrationAdapter(adapterId);
  const context = createIntegrationContext(repositoryRoot, adapter, options);
  const manifestPath = manifestPathForIntegration(adapter.id);
  const absoluteManifestPath = path.join(repositoryRoot, manifestPath);
  const dryRunInstall = await resolveValue(adapter.install({ ...context, dryRun: true }));
  const existingTargetFiles = dryRunInstall.manifest.files
    .map((fileRecord) => fileRecord.path)
    .filter((filePath) => existsSync(path.join(repositoryRoot, filePath)));

  if (options.force !== true && options.dryRun !== true) {
    if (existsSync(absoluteManifestPath)) {
      throw new CliError('ATM_INTEGRATION_ALREADY_INSTALLED', `Integration adapter ${adapter.id} already has a manifest. Use --force to reinstall.`, {
        details: {
          adapterId: adapter.id,
          manifestPath
        }
      });
    }
    if (existingTargetFiles.length > 0) {
      throw new CliError('ATM_INTEGRATION_TARGET_EXISTS', `Integration adapter ${adapter.id} target files already exist. Use --force to overwrite.`, {
        details: {
          adapterId: adapter.id,
          existingTargetFiles
        }
      });
    }
  }

  if (options.dryRun !== true) {
    ensureAtmDirectory(repositoryRoot);
  }
  const installReport = options.dryRun === true
    ? dryRunInstall
    : await resolveValue(adapter.install(context));

  return {
    adapter: describeAdapter(adapter, repositoryRoot),
    dryRun: installReport.dryRun,
    manifestPath,
    writtenFiles: installReport.writtenFiles,
    existingTargetFiles,
    manifest: installReport.manifest
  };
}

function createIntegrationListResult(cwd: string) {
  const adapters = availableAdapters(cwd);
  return makeResult({
    ok: true,
    command: 'integration',
    cwd,
    messages: [message('info', 'ATM_INTEGRATION_LIST_OK', 'Integration adapters listed.')],
    evidence: {
      adapters,
      available: adapters.map((adapter) => adapter.id),
      installed: adapters.filter((adapter) => adapter.installed).map((adapter) => adapter.id)
    }
  });
}

function availableAdapters(repositoryRoot: string) {
  return Object.keys(integrationAdapterFactories).map((adapterId) => describeAdapter(createIntegrationAdapter(adapterId), repositoryRoot));
}

export function detectCurrentEditorIntegrationId(env: NodeJS.ProcessEnv = process.env): DetectedCurrentEditor {
  const explicitCandidates: Array<{ readonly source: EditorDetectionSource; readonly value: string | undefined }> = [
    { source: 'ATM_EDITOR_ID', value: env.ATM_EDITOR_ID },
    { source: 'ATM_ACTOR_ID', value: env.ATM_ACTOR_ID },
    { source: 'AGENT_IDENTITY', value: env.AGENT_IDENTITY }
  ];
  for (const candidate of explicitCandidates) {
    const normalizedId = normalizeDetectedEditorId(candidate.value);
    if (normalizedId) {
      return {
        id: normalizedId,
        source: candidate.source,
        rawValue: candidate.value ?? null
      };
    }
  }
  if (typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim().length > 0) {
    return {
      id: 'codex',
      source: 'CODEX_HOME',
      rawValue: env.CODEX_HOME
    };
  }
  return {
    id: null,
    source: null,
    rawValue: null
  };
}

function describeAdapter(adapter: IntegrationAdapter, repositoryRoot: string) {
  const manifestPath = manifestPathForIntegration(adapter.id);
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    adapterVersion: adapter.adapterVersion,
    targetDir: adapter.targetDir({ repositoryRoot, manifestPath }),
    fileFormat: adapter.fileFormat,
    placeholderStyle: adapter.placeholderStyle,
    manifestPath,
    installed: existsSync(path.join(repositoryRoot, manifestPath))
  };
}

function normalizeDetectedEditorId(value: string | undefined): KnownCliIntegrationId | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (Object.hasOwn(integrationAdapterFactories, normalized)) {
    return normalized as KnownCliIntegrationId;
  }
  if (normalized.includes('copilot')) return 'copilot';
  if (normalized.includes('claude')) return 'claude-code';
  if (normalized.includes('codex')) return 'codex';
  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('antigravity')) return 'antigravity';
  return null;
}

function createIntegrationContext(repositoryRoot: string, adapter: IntegrationAdapter, options: InstallIntegrationOptions) {
  return {
    repositoryRoot,
    actor: options.actor,
    now: options.now,
    dryRun: options.dryRun,
    manifestPath: manifestPathForIntegration(adapter.id)
  };
}

function manifestPathForIntegration(adapterId: string) {
  return `.atm/integrations/${adapterId}.manifest.json`;
}

async function verifyManifestFile(repositoryRoot: string, entryName: string) {
  const manifestPath = `.atm/integrations/${entryName}`;
  let manifest: InstallManifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(repositoryRoot, manifestPath), 'utf8')) as InstallManifest;
  } catch (error) {
    return createManifestHealthReport({
      ok: false,
      status: 'stale',
      manifestPath,
      adapterId: null,
      findings: [{ level: 'error', code: 'manifest-unreadable', path: manifestPath, message: error instanceof Error ? error.message : String(error) }],
      driftedFiles: []
    });
  }

  if (!isKnownIntegrationAdapter(manifest.adapterId)) {
    return createManifestHealthReport({
      ok: false,
      status: 'stale',
      manifestPath,
      adapterId: manifest.adapterId ?? null,
      findings: [{ level: 'error', code: 'adapter-unknown', path: manifestPath, message: `Unknown integration adapter in manifest: ${manifest.adapterId}` }],
      driftedFiles: []
    });
  }

  const expectedManifestPath = manifestPathForIntegration(manifest.adapterId);
  if (manifestPath !== expectedManifestPath) {
    return createManifestHealthReport({
      ok: false,
      status: 'stale',
      manifestPath,
      adapterId: manifest.adapterId,
      findings: [{ level: 'error', code: 'manifest-path-mismatch', path: manifestPath, message: `Manifest path should be ${expectedManifestPath}.` }],
      driftedFiles: []
    });
  }

  const adapter = createIntegrationAdapter(manifest.adapterId);
  const verifyReport = await resolveValue(adapter.verify(createIntegrationContext(repositoryRoot, adapter, {}), manifest));
  return createManifestHealthReport({
    ok: verifyReport.ok,
    status: verifyReport.ok ? 'ok' : 'drift',
    manifestPath,
    adapterId: adapter.id,
    findings: verifyReport.findings,
    driftedFiles: verifyReport.driftedFiles
  });
}

function createManifestHealthReport(input: any) {
  return {
    ok: input.ok === true,
    status: input.status,
    manifestPath: input.manifestPath,
    adapterId: input.adapterId,
    findings: input.findings,
    driftedFiles: input.driftedFiles
  };
}

function readIntegrationManifest(repositoryRoot: string, adapterId: string): InstallManifest {
  const adapter = createIntegrationAdapter(adapterId);
  const manifestPath = manifestPathForIntegration(adapter.id);
  const manifest = readJsonFile(path.join(repositoryRoot, manifestPath), 'ATM_INTEGRATION_MANIFEST_MISSING') as InstallManifest;
  if (manifest.adapterId !== adapter.id) {
    throw new CliError('ATM_INTEGRATION_MANIFEST_ADAPTER_MISMATCH', `Integration manifest adapterId does not match ${adapter.id}.`, {
      details: {
        expectedAdapterId: adapter.id,
        actualAdapterId: manifest.adapterId,
        manifestPath
      }
    });
  }
  return manifest;
}

function createIntegrationAdapter(adapterId: string): IntegrationAdapter {
  const factory = integrationAdapterFactories[adapterId as KnownCliIntegrationId];
  if (!factory) {
    throw new CliError('ATM_INTEGRATION_UNKNOWN_ADAPTER', `Unknown integration adapter: ${adapterId}`, {
      exitCode: 2,
      details: {
        availableAdapters: Object.keys(integrationAdapterFactories)
      }
    });
  }
  return factory();
}

function isKnownIntegrationAdapter(adapterId: string) {
  return Object.hasOwn(integrationAdapterFactories, adapterId);
}

function requireAdapterId(adapterId: string | undefined, action: string) {
  if (!adapterId) {
    throw new CliError('ATM_CLI_USAGE', `integration ${action} requires an adapter id`, { exitCode: 2 });
  }
  return adapterId;
}

function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
