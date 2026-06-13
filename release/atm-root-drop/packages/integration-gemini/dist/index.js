import { atmFirstCommand, compileSkillTemplatesForAdapter, createStaticIntegrationAdapter, renderCharterInvariantsBlock } from '../../integrations-core/dist/index.js';
export const integrationGeminiPackage = {
    packageName: '@ai-atomic-framework/integration-gemini',
    packageRole: 'gemini-integration-adapter',
    packageVersion: '0.0.0'
};
export function createGeminiIntegrationAdapter(options = {}) {
    return createStaticIntegrationAdapter({
        id: 'gemini',
        displayName: 'Gemini commands',
        adapterVersion: options.adapterVersion ?? integrationGeminiPackage.packageVersion,
        targetDir: options.targetDir ?? '.gemini/commands',
        fileFormat: 'toml',
        placeholderStyle: 'toml-fields',
        sourceFiles: (context) => createGeminiSourceFiles(context.repositoryRoot)
    });
}
export function createAntigravityIntegrationAdapter(options = {}) {
    return createStaticIntegrationAdapter({
        id: 'antigravity',
        displayName: 'Antigravity workflows',
        adapterVersion: options.adapterVersion ?? integrationGeminiPackage.packageVersion,
        targetDir: '.',
        fileFormat: 'markdown',
        placeholderStyle: '$ARGUMENTS',
        sourceFiles: (context) => createAntigravitySourceFiles(context.repositoryRoot)
    });
}
export function createGeminiSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('gemini', undefined, { repositoryRoot });
}
export function createAntigravitySourceFiles(repositoryRoot = process.cwd()) {
    const skillFiles = compileSkillTemplatesForAdapter('codex', undefined, { repositoryRoot })
        .map((sourceFile) => ({
        relativePath: `.agents/skills/${sourceFile.relativePath}`,
        content: sourceFile.content,
        fileFormat: sourceFile.fileFormat,
        source: sourceFile.source
    }));
    const charter = renderCharterInvariantsBlock(repositoryRoot);
    const geminiRoot = [
        '# ATM Antigravity Onboarding',
        '',
        'First command:',
        '',
        '```bash',
        atmFirstCommand,
        '```',
        '',
        'Antigravity adapter entry routes through `GEMINI.md` and delegates detailed command skills to `.agents/skills/atm-*/SKILL.md`.',
        '',
        'After every `next --prompt` or `next --claim` response, read `evidence.nextAction.playbook` before editing, closing, or committing. The playbook is the channel-specific work order.',
        '',
        'Batch requests must stay in batch: claim the original prompt, deliver only the current queue head, add command-backed evidence, run `node atm.mjs batch checkpoint --actor <id> --json`, then commit only after checkpoint succeeds.',
        '',
        'Do not manually loop over `tasks reserve`, `tasks promote`, `tasks claim`, or `tasks close`; do not commit before `batch checkpoint` during an active batch.',
        '',
        '## Skill Directory',
        '',
        '- `.agents/skills/atm-next/SKILL.md`',
        '- `.agents/skills/atm-orient/SKILL.md`',
        '- `.agents/skills/atm-governance-router/SKILL.md`',
        '- `.agents/skills/atm-create/SKILL.md`',
        '- `.agents/skills/atm-lock/SKILL.md`',
        '- `.agents/skills/atm-evidence/SKILL.md`',
        '- `.agents/skills/atm-upgrade-scan/SKILL.md`',
        '- `.agents/skills/atm-handoff/SKILL.md`',
        '- `.agents/skills/atm-atom-map-refactor/SKILL.md`',
        '',
        '## Charter Invariants',
        '',
        charter.text,
        '',
        '## Notes',
        '',
        '- Antigravity differs from the Gemini CLI adapter: it uses `GEMINI.md` as the primary entry and `.agents/skills` for ATM command skills.',
        '- Governance logic stays in ATM CLI; this adapter only provides host-native entry files.'
    ].join('\n');
    return [
        {
            relativePath: 'GEMINI.md',
            content: `${geminiRoot}\n`,
            fileFormat: 'markdown',
            source: 'generated'
        },
        ...skillFiles
    ];
}
