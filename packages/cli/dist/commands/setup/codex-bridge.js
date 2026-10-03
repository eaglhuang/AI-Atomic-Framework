import { createCodexSourceFiles } from '../../_vendor/integration-codex/dist/index.js';
import { createStaticIntegrationAdapter } from '../../_vendor/integrations-core/dist/index.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
/** Reuse the same canonical corpus for Codex's native discovery directory. */
export function codexHostBridge(repositoryRoot) {
    return createStaticIntegrationAdapter({
        id: 'codex', displayName: 'Codex project governance router', adapterVersion: '0.0.0',
        targetDir: '.agents/skills', fileFormat: 'skill', placeholderStyle: '$ARGUMENTS',
        sourceFiles: () => createCodexSourceFiles(repositoryRoot).filter(file => file.relativePath.startsWith('atm-governance-router/'))
    });
}
export const codexBridgeManifest = '.atm/integrations/codex.host.json';
export async function verifyCodexHostBridge(repositoryRoot) {
    const file = path.join(repositoryRoot, codexBridgeManifest);
    if (!existsSync(file))
        return { ok: false, reason: 'Codex native bridge manifest is missing.' };
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    if (manifest.schemaId !== 'atm.integrationInstallManifest' || manifest.adapterId !== 'codex' || !Array.isArray(manifest.files)) {
        return { ok: false, reason: 'Codex native bridge manifest is invalid.' };
    }
    const adapter = codexHostBridge(repositoryRoot);
    const verify = await adapter.verify({ repositoryRoot, manifestPath: codexBridgeManifest }, manifest);
    const expected = await adapter.install({ repositoryRoot, manifestPath: codexBridgeManifest, dryRun: true });
    const signature = (value) => JSON.stringify(value.files.map(file => [file.path, file.sha256, file.sizeBytes]));
    return { ok: verify.ok && signature(manifest) === signature(expected.manifest), reason: 'Codex native bridge must match both its manifest and the current source.', verify };
}
