import { atmFirstCommand, compileSkillTemplatesForAdapter, loadSkillCorpusSourceSnapshot, createStaticIntegrationAdapter, renderCharterInvariantsBlock } from '../../integrations-core/dist/index.js';
import path from 'node:path';
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
        sourceFiles: (context) => createGeminiSourceFiles(context.repositoryRoot),
        sourceCoverage: (context) => ({ sourceFileCount: loadSkillCorpusSourceSnapshot(path.join(context.repositoryRoot, 'templates', 'skills')).templateCount })
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
        sourceFiles: (context) => createAntigravitySourceFiles(context.repositoryRoot),
        sourceCoverage: (context) => ({ sourceFileCount: loadSkillCorpusSourceSnapshot(path.join(context.repositoryRoot, 'templates', 'skills')).templateCount })
    });
}
export function createGeminiSourceFiles(repositoryRoot = process.cwd()) {
    return compileSkillTemplatesForAdapter('gemini', undefined, { repositoryRoot });
}
export function createAntigravitySourceFiles(repositoryRoot = process.cwd()) {
    const skillFiles = compileSkillTemplatesForAdapter('codex', undefined, { repositoryRoot })
        .map(({ relativePath, ...sourceFile }) => ({
        ...sourceFile,
        relativePath: `.agents/skills/${relativePath}`
    }));
    const sourceProvenance = skillFiles.find((sourceFile) => sourceFile.sourceCatalogDigest && sourceFile.installProfileId);
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
        'If governance-router friction appears, do not load a monolithic lesson log.',
        'Read `.agents/skills/atm-governance-router/references/index.md` first, then',
        'open only the single matching shard.',
        '',
        'After every `next --prompt` or `next --claim` response, read `evidence.nextAction.playbook` before editing, closing, or committing. The playbook is the channel-specific work order.',
        '',
        'For first-layer backlog, audit, optimization, create, ticket-state, and Windows-safe command contracts, run `node atm.mjs guide first-layer --json` before falling back to broad CLI discovery.',
        'Preserve distinct ticket states: `execute-now`, `batch/applyStrategy=compose`, `queue(position/head/health/waitedMs/release condition)`, `revalidation-required`, `reconcile-required`, and `ATM_LOCK_CONFLICT`.',
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
        '- Use `node atm.mjs write-ticket ... --json` before governed editor writes; scope amendments must use the ATM task route.',
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
            source: 'generated',
            sourceCatalogDigest: sourceProvenance?.sourceCatalogDigest,
            installProfileId: sourceProvenance?.installProfileId
        },
        ...skillFiles
    ];
}
