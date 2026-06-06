import { compileSkillTemplatesForAdapter, createStaticIntegrationAdapter } from '../../integrations-core/dist/index.js';
export const integrationCodexPackage = {
    packageName: '@ai-atomic-framework/integration-codex',
    packageRole: 'codex-integration-adapter',
    packageVersion: '0.0.0'
};
export function createCodexIntegrationAdapter(options = {}) {
    return createStaticIntegrationAdapter({
        id: 'codex',
        displayName: 'Codex skills',
        adapterVersion: options.adapterVersion ?? integrationCodexPackage.packageVersion,
        targetDir: options.targetDir ?? 'integrations/codex-skills',
        fileFormat: 'skill',
        placeholderStyle: '$ARGUMENTS',
        sourceFiles: (context) => createCodexSourceFiles(context.repositoryRoot)
    });
}
export function createCodexSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('codex', undefined, { repositoryRoot });
}
