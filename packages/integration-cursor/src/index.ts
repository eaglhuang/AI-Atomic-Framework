import {
  compileSkillTemplatesForAdapter,
  createStaticIntegrationAdapter,
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
    targetDir: options.targetDir ?? '.cursor/rules/skills',
    fileFormat: 'markdown',
    placeholderStyle: '$ARGUMENTS',
    sourceFiles: createCursorSourceFiles()
  });
}

export function createCursorSourceFiles(): readonly IntegrationSourceFile[] {
  return compileSkillTemplatesForAdapter('cursor');
}
