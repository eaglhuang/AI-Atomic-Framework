import { compileSkillTemplatesForAdapter, createStaticIntegrationAdapter } from '../../integrations-core/dist/index.js';
export const integrationClaudeCodePackage = {
    packageName: '@ai-atomic-framework/integration-claude-code',
    packageRole: 'claude-code-integration-adapter',
    packageVersion: '0.0.0'
};
export function createClaudeCodeIntegrationAdapter(options = {}) {
    return createStaticIntegrationAdapter({
        id: 'claude-code',
        displayName: 'Claude Code skills',
        adapterVersion: options.adapterVersion ?? integrationClaudeCodePackage.packageVersion,
        targetDir: options.targetDir ?? '.claude/skills',
        fileFormat: 'skill',
        placeholderStyle: '$ARGUMENTS',
        sourceFiles: (context) => createClaudeCodeSourceFiles(context.repositoryRoot)
    });
}
export function createClaudeCodeSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('claude-code', undefined, { repositoryRoot });
}
