import {
  compileSkillTemplatesForAdapter,
  loadSkillCorpusSourceSnapshot,
  createStaticIntegrationAdapter,
  type IntegrationAdapter,
  type IntegrationSourceFile
} from '../../integrations-core/src/index.ts';
import path from 'node:path';

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
    sourceFiles: (context) => createCursorSourceFiles(context.repositoryRoot),
    sourceCoverage: (context) => ({ sourceFileCount: loadSkillCorpusSourceSnapshot(path.join(context.repositoryRoot, 'templates', 'skills')).templateCount })
  });
}

export function createCursorSourceFiles(repositoryRoot = process.cwd()): readonly IntegrationSourceFile[] {
  return compileSkillTemplatesForAdapter('cursor', undefined, { repositoryRoot });
}
