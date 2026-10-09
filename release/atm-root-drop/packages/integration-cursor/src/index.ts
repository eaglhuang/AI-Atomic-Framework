import {
  compileSkillTemplatesForAdapter,
  createStaticIntegrationAdapter,
  resolveDefaultSkillSourceCoverage,
  type IntegrationAdapter,
  type IntegrationSourceFile
} from '../../integrations-core/src/index.ts';

export const integrationCursorPackage = {
  packageName: '@ai-atomic-framework/integration-cursor',
  packageRole: 'cursor-integration-adapter',
  packageVersion: '0.0.0'
} as const;

export interface CursorIntegrationAdapterOptions {
  readonly adapterVersion?: string;
  readonly targetDir?: string;
}

export function createCursorIntegrationAdapter(options: CursorIntegrationAdapterOptions = {}): IntegrationAdapter {
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

export function createCursorSourceFiles(repositoryRoot = process.cwd()): readonly IntegrationSourceFile[] {
  return compileSkillTemplatesForAdapter('cursor', undefined, { repositoryRoot });
}

// Cursor setups do not all auto-load skills under .cursor/rules/skills, so the
// integration also installs one always-applied rule that points every agent at
// the ATM entry route; the skills keep their existing install paths.
export const cursorAlwaysOnRule: IntegrationSourceFile = {
  relativePath: 'atm-governance.mdc',
  fileFormat: 'markdown',
  content: [
    '---',
    'description: ATM governance entry route for this repository',
    'alwaysApply: true',
    '---',
    '',
    'Before user-requested work, read `.cursor/rules/skills/atm-governance-router/SKILL.md` and follow its first-run runtime/target inspection.',
    'Use the selected project and verified runner; do not infer framework identity or unsupported commands from a package or model name.',
    'If the result includes `ATM_USER_NOTICE` or `evidence.userNotice`, tell the user before continuing.',
    'Read `evidence.nextAction.playbook` and edit only inside the scope ATM returns.',
    'The full ATM router skill is at `.cursor/rules/skills/atm-governance-router/SKILL.md`.',
    ''
  ].join('\n')
};

export function createCursorRuleFiles(repositoryRoot = process.cwd()): readonly IntegrationSourceFile[] {
  return [
    ...createCursorSourceFiles(repositoryRoot).map((file) => ({ ...file, relativePath: `skills/${file.relativePath}` })),
    cursorAlwaysOnRule
  ];
}
