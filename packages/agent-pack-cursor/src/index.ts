import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { AgentPack, TargetFile } from '../../agent-pack-sdk/src/index.ts';
import { createCursorSourceFiles } from '../../integration-cursor/src/index.ts';
import type { IntegrationSourceFile } from '../../integrations-core/src/index.ts';

export const agentPackCursorPackage = {
  packageName: '@ai-atomic-framework/agent-pack-cursor',
  packageRole: 'cursor-agent-pack',
  packageVersion: '0.0.0'
} as const;

const targetFiles = createPackTargetFiles('.cursor/rules/skills', createCursorSourceFiles());

export const cursorPack: AgentPack = {
  packId: 'cursor',
  name: 'Cursor Agent Pack',
  version: agentPackCursorPackage.packageVersion,
  agentTarget: 'cursor',
  targetFiles,
  sourceHash: hashTargetFiles(targetFiles)
};

function createPackTargetFiles(targetDir: string, sourceFiles: readonly IntegrationSourceFile[]): TargetFile[] {
  return sourceFiles.map((sourceFile) => ({
    path: `${targetDir}/${sourceFile.relativePath}`,
    template: sourceContentToText(sourceFile.content),
    protected: false
  }));
}

function sourceContentToText(content: string | Uint8Array): string {
  return typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
}

function hashTargetFiles(files: readonly TargetFile[]): string {
  return createHash('sha256').update(files.map((file) => `${file.path}\0${file.template}`).join('\0'), 'utf8').digest('hex');
}