import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createCursorSourceFiles } from '../../integration-cursor/dist/index.js';
export const agentPackCursorPackage = {
    packageName: '@ai-atomic-framework/agent-pack-cursor',
    packageRole: 'cursor-agent-pack',
    packageVersion: '0.0.0'
};
const targetFiles = createPackTargetFiles('.cursor/rules/skills', createCursorSourceFiles());
export const cursorPack = {
    packId: 'cursor',
    name: 'Cursor Agent Pack',
    version: agentPackCursorPackage.packageVersion,
    agentTarget: 'cursor',
    targetFiles,
    sourceHash: hashTargetFiles(targetFiles)
};
function createPackTargetFiles(targetDir, sourceFiles) {
    return sourceFiles.map((sourceFile) => ({
        path: `${targetDir}/${sourceFile.relativePath}`,
        template: sourceContentToText(sourceFile.content),
        protected: false
    }));
}
function sourceContentToText(content) {
    return typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
}
function hashTargetFiles(files) {
    return createHash('sha256').update(files.map((file) => `${file.path}\0${file.template}`).join('\0'), 'utf8').digest('hex');
}
