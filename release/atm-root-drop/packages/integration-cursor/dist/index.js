import { compileSkillTemplatesForAdapter, loadSkillCorpusSourceSnapshot, createStaticIntegrationAdapter } from '../../integrations-core/dist/index.js';
import path from 'node:path';
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
        sourceFiles: (context) => createCursorSourceFiles(context.repositoryRoot),
        sourceCoverage: (context) => ({ sourceFileCount: loadSkillCorpusSourceSnapshot(path.join(context.repositoryRoot, 'templates', 'skills')).templateCount })
    });
}
export function createCursorSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('cursor', undefined, { repositoryRoot });
}
