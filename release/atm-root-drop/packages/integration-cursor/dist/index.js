import { compileSkillTemplatesForAdapter, createStaticIntegrationAdapter } from '../../integrations-core/dist/index.js';
export const integrationCursorPackage = {
    packageName: '@ai-atomic-framework/integration-cursor',
    packageRole: 'cursor-integration-adapter',
    packageVersion: '0.0.0'
};
export function createCursorIntegrationAdapter(options = {}) {
    return createStaticIntegrationAdapter({
        id: 'cursor',
        displayName: 'Cursor rules skills',
        adapterVersion: options.adapterVersion ?? integrationCursorPackage.packageVersion,
        targetDir: options.targetDir ?? '.cursor/rules/skills',
        fileFormat: 'markdown',
        placeholderStyle: '$ARGUMENTS',
        sourceFiles: (context) => createCursorSourceFiles(context.repositoryRoot)
    });
}
export function createCursorSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('cursor', undefined, { repositoryRoot });
}
