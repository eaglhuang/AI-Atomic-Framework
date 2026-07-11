import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createClaudeCodeIntegrationAdapter } from '../../../integration-claude-code/dist/index.js';
import { createCopilotIntegrationAdapter } from '../../../integration-copilot/dist/index.js';
import { createCodexIntegrationAdapter } from '../../../integration-codex/dist/index.js';
import { createCursorIntegrationAdapter } from '../../../integration-cursor/dist/index.js';
import { createAntigravityIntegrationAdapter, createGeminiIntegrationAdapter } from '../../../integration-gemini/dist/index.js';
import { CliError, ensureAtmDirectory, makeResult, message, parseArgsForCommand, readJsonFile, resolveValue } from './shared.js';
import { getCommandSpec } from './command-specs.js';
import { installAtmPrePushHook, uninstallAtmPrePushHook, verifyAtmPrePushHook } from './git.js';
import { TEAM_DIRECT_API_PROVIDER_IDS } from '../../../core/dist/team-runtime/provider-contract.js';
export function discoverGovernedVendorConfigSurface(repositoryRoot) {
    const rootDir = path.join(repositoryRoot, 'agent-integrations', 'vendors');
    return {
        rootDir,
        templateReadme: path.join(repositoryRoot, 'release', 'atm-root-drop', 'templates', 'root-drop', 'agent-integrations', 'vendors', 'README.md'),
        exists: existsSync(rootDir)
    };
}
async function loadIntegrationHooks() {
    return import('./integration-hooks.js');
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
});
export async function checkIntegrationHealth(repositoryRoot) {
    const manifestDirectory = path.join(repositoryRoot, '.atm', 'integrations');
    if (!existsSync(manifestDirectory)) {
        return {
            ok: true,
            manifestDir: '.atm/integrations',
            installed: [],
            manifests: [],
            failed: [],
            teamRuntimeBackends: inspectTeamRuntimeBackendCapabilities(repositoryRoot)
        };
    }
    const manifestReports = await Promise.all(readdirSync(manifestDirectory)
        .filter((entryName) => entryName.endsWith('.manifest.json'))
        .sort((left, right) => left.localeCompare(right))
        .map((entryName) => verifyManifestFile(repositoryRoot, entryName)));
    const teamRuntimeBackends = inspectTeamRuntimeBackendCapabilities(repositoryRoot);
    return {
        ok: manifestReports.every((report) => report.ok),
        manifestDir: '.atm/integrations',
        installed: manifestReports.filter((report) => report.adapterId).map((report) => report.adapterId),
        manifests: manifestReports,
        failed: manifestReports.filter((report) => !report.ok),
        teamRuntimeBackends
    };
}
export function inspectTeamRuntimeBackendCapabilities(repositoryRoot) {
    const manifestDirectory = path.join(repositoryRoot, '.atm', 'integrations');
    const manifestCapabilities = existsSync(manifestDirectory) ? readdirSync(manifestDirectory)
        .filter((entryName) => entryName.endsWith('.manifest.json'))
        .sort((left, right) => left.localeCompare(right))
        .flatMap((entryName) => {
        const manifestPath = `.atm/integrations/${entryName}`;
        try {
            const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, manifestPath), 'utf8'));
            return normalizeTeamRuntimeCapabilities(manifest, manifestPath);
        }
        catch {
            return [];
        }
    }) : [];
    const builtInCapabilities = TEAM_DIRECT_API_PROVIDER_IDS.map((providerId) => ({
        manifestPath: 'builtin:team-provider-contract',
        adapterId: 'atm.builtin.direct-api',
        providerId,
        runtimeModes: ['real-agent'],
        executionSurfaces: ['agent-runtime'],
        roles: ['*'],
        status: 'supported',
        evidence: `Canonical built-in direct API provider contract: ${providerId}`
    }));
    const capabilities = [...builtInCapabilities, ...manifestCapabilities];
    return {
        schemaId: 'atm.integrationTeamRuntimeBackendReadiness.v1',
        ok: true,
        manifestDir: '.atm/integrations',
        declaredBackendCount: capabilities.length,
        capabilities,
        missingBackendSummary: capabilities.length === 0
            ? 'No built-in direct provider or installed integration manifest declares Team runtime backend capability.'
            : null,
        startReadiness: capabilities.some((capability) => capability.status !== 'unavailable')
            ? 'runtime-backend-declared'
            : 'broker-only-only'
    };
}
function normalizeTeamRuntimeCapabilities(manifest, manifestPath) {
    const rawCapabilities = Array.isArray(manifest.teamRuntimeCapabilities)
        ? manifest.teamRuntimeCapabilities
        : [];
    return rawCapabilities
        .map((capability) => ({
        manifestPath,
        adapterId: manifest.adapterId ?? null,
        providerId: typeof capability.providerId === 'string' ? capability.providerId : '',
        runtimeModes: Array.isArray(capability.runtimeModes)
            ? capability.runtimeModes.filter((mode) => typeof mode === 'string' && mode.length > 0)
            : [],
        executionSurfaces: Array.isArray(capability.executionSurfaces)
            ? capability.executionSurfaces.filter((surface) => typeof surface === 'string' && surface.length > 0)
            : [],
        roles: Array.isArray(capability.roles)
            ? capability.roles.filter((role) => typeof role === 'string' && role.length > 0)
            : [],
        status: capability.status,
        evidence: typeof capability.evidence === 'string' ? capability.evidence : ''
    }))
        .filter((capability) => capability.providerId.length > 0
        && capability.runtimeModes.length > 0
        && capability.executionSurfaces.length > 0
        && capability.roles.length > 0
        && ['supported', 'experimental', 'unavailable'].includes(capability.status)
        && capability.evidence.length > 0);
}
export function inspectIntegrationBootstrap(repositoryRoot) {
    const repoBootstrapped = existsSync(path.join(repositoryRoot, '.atm', 'config.json'));
    const detectedEditor = detectCurrentEditorIntegrationId();
    const adapters = availableAdapters(repositoryRoot).map((adapter) => {
        const primaryEntryPath = primaryEntryPathByAdapterId[adapter.id];
        const primaryEntryPresent = existsSync(path.join(repositoryRoot, primaryEntryPath));
        const installCommand = `node atm.mjs integration add ${adapter.id} --json`;
        const verifyCommand = `node atm.mjs integration verify ${adapter.id} --json`;
        let status = 'missing';
        if (adapter.installed && primaryEntryPresent) {
            status = 'installed';
        }
        else if (adapter.installed) {
            status = 'manifest-only';
        }
        else if (primaryEntryPresent) {
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
export function describeIntegrationInstallHint(bootstrap) {
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
export async function runIntegration(argv) {
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
        if (hookAdapterId === 'git-pre-push') {
            if (hooksAction === 'install') {
                const report = installAtmPrePushHook(cwd, {
                    dryRun: parsed.options.dryRun === true,
                    force: parsed.options.force === true
                });
                return makeResult({
                    ok: report.ok,
                    command: 'integration',
                    cwd,
                    messages: [
                        message('info', 'ATM_GIT_PRE_PUSH_HOOK_INSTALLED', 'ATM pre-push hook install flow completed.', report)
                    ],
                    evidence: {
                        action: 'hooks install',
                        target: 'git-pre-push',
                        report
                    }
                });
            }
            if (hooksAction === 'verify') {
                const report = verifyAtmPrePushHook(cwd);
                return makeResult({
                    ok: report.ok,
                    command: 'integration',
                    cwd,
                    messages: [
                        report.ok
                            ? message('info', 'ATM_GIT_PRE_PUSH_HOOK_VERIFY_OK', 'ATM pre-push hook points at the current CLI entrypoint.', report)
                            : message('error', 'ATM_GIT_PRE_PUSH_HOOK_VERIFY_FAILED', 'ATM pre-push hook is missing or drifted.', report)
                    ],
                    evidence: {
                        action: 'hooks verify',
                        target: 'git-pre-push',
                        report
                    }
                });
            }
            if (hooksAction === 'uninstall') {
                const report = uninstallAtmPrePushHook(cwd, {
                    dryRun: parsed.options.dryRun === true
                });
                return makeResult({
                    ok: report.ok,
                    command: 'integration',
                    cwd,
                    messages: [
                        message('info', 'ATM_GIT_PRE_PUSH_HOOK_UNINSTALLED', 'ATM pre-push hook uninstall flow completed.', report)
                    ],
                    evidence: {
                        action: 'hooks uninstall',
                        target: 'git-pre-push',
                        report
                    }
                });
            }
            throw new CliError('ATM_CLI_USAGE', 'integration hooks git-pre-push supports only: install | verify | uninstall', { exitCode: 2 });
        }
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
        throw new CliError('ATM_CLI_USAGE', 'integration hooks supports only: install | verify | uninstall', { exitCode: 2 });
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
        const verifyReport = await verifyInstalledManifest(cwd, manifestPath, adapter);
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
                    : message('error', verifyReport.status === 'stale' ? 'ATM_INTEGRATION_VERIFY_STALE' : 'ATM_INTEGRATION_VERIFY_DRIFT', verifyReport.status === 'stale'
                        ? `Integration adapter ${adapter.id} is behind the current integration source snapshot.`
                        : `Integration adapter ${adapter.id} has manifest drift.`)
            ],
            evidence: {
                action,
                adapter: describeAdapter(adapter, cwd),
                manifestPath,
                status: verifyReport.status,
                findings: verifyReport.findings,
                driftedFiles: verifyReport.driftedFiles,
                staleFields: verifyReport.staleFields,
                teamRuntimeCapabilities: verifyReport.teamRuntimeCapabilities,
                teamRuntimeBackendReadiness: inspectTeamRuntimeBackendCapabilities(cwd),
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
export async function installIntegrationAdapter(repositoryRoot, adapterId, options = {}) {
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
function createIntegrationListResult(cwd) {
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
function availableAdapters(repositoryRoot) {
    return Object.keys(integrationAdapterFactories).map((adapterId) => describeAdapter(createIntegrationAdapter(adapterId), repositoryRoot));
}
export function detectCurrentEditorIntegrationId(env = process.env) {
    const explicitCandidates = [
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
function describeAdapter(adapter, repositoryRoot) {
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
function normalizeDetectedEditorId(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (Object.hasOwn(integrationAdapterFactories, normalized)) {
        return normalized;
    }
    if (normalized.includes('copilot'))
        return 'copilot';
    if (normalized.includes('claude'))
        return 'claude-code';
    if (normalized.includes('codex'))
        return 'codex';
    if (normalized.includes('cursor'))
        return 'cursor';
    if (normalized.includes('gemini'))
        return 'gemini';
    if (normalized.includes('antigravity'))
        return 'antigravity';
    return null;
}
function createIntegrationContext(repositoryRoot, adapter, options) {
    return {
        repositoryRoot,
        actor: options.actor,
        now: options.now,
        dryRun: options.dryRun,
        manifestPath: manifestPathForIntegration(adapter.id)
    };
}
function manifestPathForIntegration(adapterId) {
    return `.atm/integrations/${adapterId}.manifest.json`;
}
async function verifyManifestFile(repositoryRoot, entryName) {
    const manifestPath = `.atm/integrations/${entryName}`;
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(path.join(repositoryRoot, manifestPath), 'utf8'));
    }
    catch (error) {
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
    return verifyInstalledManifest(repositoryRoot, manifestPath, adapter, manifest);
}
async function verifyInstalledManifest(repositoryRoot, manifestPath, adapter, preloadedManifest) {
    const manifest = preloadedManifest ?? readIntegrationManifest(repositoryRoot, adapter.id);
    const verifyReport = await resolveValue(adapter.verify(createIntegrationContext(repositoryRoot, adapter, {}), manifest));
    if (!verifyReport.ok) {
        return createManifestHealthReport({
            ok: false,
            status: 'drift',
            manifestPath,
            adapterId: adapter.id,
            findings: verifyReport.findings,
            driftedFiles: verifyReport.driftedFiles,
            staleFields: []
        });
    }
    const dryRunInstall = await resolveValue(adapter.install(createIntegrationContext(repositoryRoot, adapter, { dryRun: true })));
    const parity = compareManifestParity(manifest, dryRunInstall.manifest);
    if (!parity.ok) {
        return createManifestHealthReport({
            ok: false,
            status: 'stale',
            manifestPath,
            adapterId: adapter.id,
            findings: [
                ...verifyReport.findings,
                {
                    level: 'error',
                    code: 'source-parity-mismatch',
                    path: manifestPath,
                    message: 'Installed manifest is self-consistent but does not match the current integration source snapshot.'
                }
            ],
            driftedFiles: parity.changedFiles,
            staleFields: parity.changedFields
        });
    }
    return createManifestHealthReport({
        ok: true,
        status: 'ok',
        manifestPath,
        adapterId: adapter.id,
        findings: verifyReport.findings,
        driftedFiles: [],
        staleFields: [],
        teamRuntimeCapabilities: normalizeTeamRuntimeCapabilities(manifest, manifestPath)
    });
}
function compareManifestParity(installed, expected) {
    const changedFiles = new Set();
    const changedFields = [];
    if (installed.adapterVersion !== expected.adapterVersion) {
        changedFields.push('adapterVersion');
    }
    if (installed.targetDir !== expected.targetDir) {
        changedFields.push('targetDir');
    }
    const installedMetadata = JSON.stringify(installed.metadata ?? {});
    const expectedMetadata = JSON.stringify(expected.metadata ?? {});
    if (installedMetadata !== expectedMetadata) {
        changedFields.push('metadata');
    }
    const installedTeamRuntimeCapabilities = JSON.stringify(installed.teamRuntimeCapabilities ?? []);
    const expectedTeamRuntimeCapabilities = JSON.stringify(expected.teamRuntimeCapabilities ?? []);
    if (installedTeamRuntimeCapabilities !== expectedTeamRuntimeCapabilities) {
        changedFields.push('teamRuntimeCapabilities');
    }
    const installedFiles = new Map(installed.files.map((entry) => [entry.path, entry]));
    const expectedFiles = new Map(expected.files.map((entry) => [entry.path, entry]));
    for (const filePath of new Set([...installedFiles.keys(), ...expectedFiles.keys()])) {
        const installedFile = installedFiles.get(filePath) ?? null;
        const expectedFile = expectedFiles.get(filePath) ?? null;
        if (!installedFile || !expectedFile) {
            changedFiles.add(filePath);
            continue;
        }
        if (installedFile.sha256 !== expectedFile.sha256
            || installedFile.sizeBytes !== expectedFile.sizeBytes
            || installedFile.source !== expectedFile.source
            || installedFile.fileFormat !== expectedFile.fileFormat) {
            changedFiles.add(filePath);
        }
    }
    return {
        ok: changedFields.length === 0 && changedFiles.size === 0,
        changedFields,
        changedFiles: [...changedFiles].sort((left, right) => left.localeCompare(right))
    };
}
function createManifestHealthReport(input) {
    return {
        ok: input.ok === true,
        status: input.status,
        manifestPath: input.manifestPath,
        adapterId: input.adapterId,
        findings: input.findings,
        driftedFiles: input.driftedFiles,
        staleFields: Array.isArray(input.staleFields) ? input.staleFields : [],
        teamRuntimeCapabilities: Array.isArray(input.teamRuntimeCapabilities) ? input.teamRuntimeCapabilities : []
    };
}
function readIntegrationManifest(repositoryRoot, adapterId) {
    const adapter = createIntegrationAdapter(adapterId);
    const manifestPath = manifestPathForIntegration(adapter.id);
    const manifest = readJsonFile(path.join(repositoryRoot, manifestPath), 'ATM_INTEGRATION_MANIFEST_MISSING');
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
function createIntegrationAdapter(adapterId) {
    const factory = integrationAdapterFactories[adapterId];
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
function isKnownIntegrationAdapter(adapterId) {
    return Object.hasOwn(integrationAdapterFactories, adapterId);
}
function requireAdapterId(adapterId, action) {
    if (!adapterId) {
        throw new CliError('ATM_CLI_USAGE', `integration ${action} requires an adapter id`, { exitCode: 2 });
    }
    return adapterId;
}
function asOptionalString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
