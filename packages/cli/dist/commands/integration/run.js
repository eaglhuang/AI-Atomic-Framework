import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { CliError, makeResult, message, parseArgsForCommand, resolveValue, writeJsonFile } from '../shared.js';
import { codexBridgeManifest, codexHostBridge } from '../setup/codex-bridge.js';
import { validateOwnershipManifest } from '../../_vendor/integrations-core/dist/manifest/safe-install.js';
import { getCommandSpec } from '../command-specs.js';
import { installAtmPrePushHook, uninstallAtmPrePushHook, verifyAtmPrePushHook } from '../git.js';
import { inspectTeamRuntimeBackendCapabilities, readIntegrationManifest, verifyInstalledManifest } from './health.js';
import { createIntegrationListResult } from './list.js';
import { installIntegrationAdapter } from './install.js';
import { asOptionalString, createIntegrationAdapter, createIntegrationContext, describeAdapter, manifestPathForIntegration, requireAdapterId } from './adapters.js';
import { collectAdapterParity } from './adapter-parity.js';
import { safeIntegrationHooks } from './safe-hooks.js';
async function loadIntegrationHooks() {
    return import('../integration-hooks.js');
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
    if (action === 'parity') {
        const receipt = await collectAdapterParity(cwd);
        return makeResult({
            ok: receipt.status === 'proven',
            command: 'integration',
            cwd,
            messages: [receipt.status === 'proven'
                    ? message('info', 'ATM_INTEGRATION_PARITY_PROVEN', 'All six editor projections match the current sealed source snapshot.', receipt)
                    : message('error', 'ATM_INTEGRATION_PARITY_BLOCKED', 'At least one editor projection is stale, degraded, or lacks smoke proof.', receipt)],
            evidence: { action, receipt }
        });
    }
    if (action === 'add') {
        if (parsed.options.merge === true && parsed.options.force === true)
            throw new CliError('ATM_CLI_USAGE', '--merge and --force are mutually exclusive.', { exitCode: 2 });
        if (parsed.options.merge === true)
            await safeIntegrationHooks(cwd, requireAdapterId(adapterId, action), true);
        const nativeBridge = parsed.options.merge === true && adapterId === 'codex' ? codexHostBridge(cwd) : null;
        if (nativeBridge)
            await nativeBridge.install({ repositoryRoot: cwd, manifestPath: codexBridgeManifest, dryRun: true, merge: true });
        const report = await installIntegrationAdapter(cwd, requireAdapterId(adapterId, action), {
            actor: asOptionalString(parsed.options.actor),
            now: asOptionalString(parsed.options.at),
            dryRun: parsed.options.dryRun === true,
            force: parsed.options.force === true,
            merge: parsed.options.merge === true
        });
        const hookInstallReport = parsed.options.dryRun === true || (adapterId !== 'copilot' && adapterId !== 'claude-code')
            ? null
            : parsed.options.merge === true
                ? await safeIntegrationHooks(cwd, adapterId, false)
                : (await loadIntegrationHooks()).installEditorIntegrationHooks(cwd, adapterId, { force: true });
        if (nativeBridge && parsed.options.dryRun !== true) {
            await nativeBridge.install({ repositoryRoot: cwd, manifestPath: codexBridgeManifest, merge: true });
            const updated = { ...report.manifest, metadata: { ...report.manifest.metadata, nativeBridgeManifest: codexBridgeManifest } };
            writeJsonFile(path.join(cwd, report.manifestPath), updated);
        }
        return makeResult({
            ok: hookInstallReport?.ok !== false,
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
        const hostManifestPath = '.atm/integrations/codex.host.json';
        const hostVerify = adapter.id === 'codex' && existsSync(path.join(cwd, hostManifestPath))
            ? await resolveValue(adapter.verify({ repositoryRoot: cwd, manifestPath: hostManifestPath }, JSON.parse(readFileSync(path.join(cwd, hostManifestPath), 'utf8')))) : null;
        const hookVerifyReport = adapter.id === 'copilot' || adapter.id === 'claude-code'
            ? (await loadIntegrationHooks()).verifyEditorIntegrationHooks(cwd, adapter.id)
            : null;
        const ok = verifyReport.ok && (hookVerifyReport?.ok ?? true) && (hostVerify?.ok ?? true);
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
                hookVerifyReport,
                hostVerify
            }
        });
    }
    if (action === 'remove') {
        const adapter = createIntegrationAdapter(requireAdapterId(adapterId, action));
        const manifestPath = manifestPathForIntegration(adapter.id);
        const manifest = readIntegrationManifest(cwd, adapter.id);
        const hostManifestPath = '.atm/integrations/codex.host.json';
        const hostManifest = adapter.id === 'codex' && existsSync(path.join(cwd, hostManifestPath))
            ? JSON.parse(readFileSync(path.join(cwd, hostManifestPath), 'utf8')) : null;
        if (hostManifest && (hostManifest.schemaId !== 'atm.integrationInstallManifest' || hostManifest.adapterId !== 'codex' || !Array.isArray(hostManifest.files)))
            throw new CliError('ATM_INTEGRATION_INVALID_OWNERSHIP', 'Repair the Codex host manifest before removing either projection.');
        if (hostManifest)
            validateOwnershipManifest(hostManifest);
        const uninstallReport = await resolveValue(adapter.uninstall(createIntegrationContext(cwd, adapter, {}), manifest));
        const hostUninstall = hostManifest ? await resolveValue(adapter.uninstall({ repositoryRoot: cwd, manifestPath: hostManifestPath }, hostManifest)) : null;
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
                findings: uninstallReport.findings,
                hostUninstall
            }
        });
    }
    throw new CliError('ATM_CLI_USAGE', `integration does not support action ${action}`, {
        exitCode: 2,
        details: {
            supportedActions: ['list', 'add', 'verify', 'parity', 'remove', 'hook', 'hooks']
        }
    });
}
