import path from 'node:path';
import { existsSync } from 'node:fs';
import { CliError, makeResult, message, parseArgsForCommand, resolveValue } from '../shared.js';
import { getCommandSpec } from '../command-specs.js';
import { installAtmPrePushHook, uninstallAtmPrePushHook, verifyAtmPrePushHook } from '../git.js';
import { inspectTeamRuntimeBackendCapabilities } from './health.js';
import { createIntegrationListResult } from './list.js';
import { installIntegrationAdapter } from './install.js';
import { asOptionalString, createIntegrationAdapter, createIntegrationContext, describeAdapter, manifestPathForIntegration, requireAdapterId } from './adapters.js';
import { readIntegrationManifest, verifyInstalledManifest } from './health.js';
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
