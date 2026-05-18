import {
  compileSkillTemplatesForAdapter,
  createStaticIntegrationAdapter,
  type IntegrationAdapter,
  type IntegrationSourceFile
} from '../../integrations-core/src/index.ts';

export const integrationCodexPackage = {
  packageName: '@ai-atomic-framework/integration-codex',
  packageRole: 'codex-integration-adapter',
  packageVersion: '0.0.0'
} as const;

export interface CodexIntegrationAdapterOptions {
  readonly adapterVersion?: string;
  readonly targetDir?: string;
}

export function createCodexIntegrationAdapter(options: CodexIntegrationAdapterOptions = {}): IntegrationAdapter {
  return createStaticIntegrationAdapter({
    id: 'codex',
    displayName: 'Codex skills',
    adapterVersion: options.adapterVersion ?? integrationCodexPackage.packageVersion,
    targetDir: options.targetDir ?? 'integrations/codex-skills',
    fileFormat: 'skill',
    placeholderStyle: '$ARGUMENTS',
    sourceFiles: createCodexSourceFiles()
  });
}

export function createCodexSourceFiles(): readonly IntegrationSourceFile[] {
  return compileSkillTemplatesForAdapter('codex');
}
