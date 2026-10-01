import { compileSkillTemplatesForAdapter, createStaticIntegrationAdapter, resolveDefaultSkillSourceCoverage } from '../../integrations-core/dist/index.js';
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
        targetDir: options.targetDir ?? '.cursor/rules',
        fileFormat: 'markdown',
        placeholderStyle: '$ARGUMENTS',
        sourceFiles: (context) => createCursorRuleFiles(context.repositoryRoot),
        sourceCoverage: (context) => resolveDefaultSkillSourceCoverage(context.repositoryRoot)
    });
}
export function createCursorSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('cursor', undefined, { repositoryRoot });
}
// Cursor setups do not all auto-load skills under .cursor/rules/skills, so the
// integration also installs one always-applied rule that points every agent at
// the ATM entry route; the skills keep their existing install paths.
export const cursorAlwaysOnRule = {
    relativePath: 'atm-governance.mdc',
    fileFormat: 'markdown',
    content: [
        '---',
        'description: ATM governance entry route for this repository',
        'alwaysApply: true',
        '---',
        '',
        'Before user-requested work in this repository, run `node atm.mjs next --prompt "<current user prompt>" --json` from the repository root.',
        'If the result includes `ATM_USER_NOTICE` or `evidence.userNotice`, tell the user before continuing.',
        'Read `evidence.nextAction.playbook` and edit only inside the scope ATM returns.',
        'The full ATM router skill is at `.cursor/rules/skills/atm-governance-router/SKILL.md`.',
        ''
    ].join('\n')
};
export function createCursorRuleFiles(repositoryRoot = process.cwd()) {
    return [
        ...createCursorSourceFiles(repositoryRoot).map((file) => ({ ...file, relativePath: `skills/${file.relativePath}` })),
        cursorAlwaysOnRule
    ];
}
