import { compileSkillTemplatesForAdapter, loadSkillCorpusSourceSnapshot, createStaticIntegrationAdapter } from '../../integrations-core/dist/index.js';
import path from 'node:path';
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
        sourceFiles: (context) => createCodexSourceFiles(context.repositoryRoot),
        sourceCoverage: (context) => ({ sourceFileCount: loadSkillCorpusSourceSnapshot(path.join(context.repositoryRoot, 'templates', 'skills')).templateCount })
    });
}
export function createCodexSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('codex', undefined, { repositoryRoot });
}
