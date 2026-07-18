import { existsSync } from 'node:fs';
import path from 'node:path';
import { CliError, ensureAtmDirectory, resolveValue } from '../shared.js';
import { createIntegrationAdapter, createIntegrationContext, describeAdapter, manifestPathForIntegration } from './adapters.js';
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
