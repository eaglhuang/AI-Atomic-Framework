import { compileSkillTemplatesForAdapter, createStaticIntegrationAdapter } from '../../integrations-core/dist/index.js';
export const integrationCopilotPackage = {
    packageName: '@ai-atomic-framework/integration-copilot',
    packageRole: 'copilot-integration-adapter',
    packageVersion: '0.0.0'
};
export function createCopilotIntegrationAdapter(options = {}) {
    return createStaticIntegrationAdapter({
        id: 'copilot',
        displayName: 'GitHub Copilot instructions and prompts',
        adapterVersion: options.adapterVersion ?? integrationCopilotPackage.packageVersion,
        targetDir: options.targetDir ?? '.github',
        fileFormat: 'instructions-md',
        placeholderStyle: '{{vars}}',
        sourceFiles: (context) => createCopilotSourceFiles(context.repositoryRoot)
    });
}
export function createCopilotSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('copilot', undefined, { repositoryRoot });
}
