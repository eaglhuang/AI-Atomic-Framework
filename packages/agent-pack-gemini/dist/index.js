import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createGeminiSourceFiles } from '../../integration-gemini/dist/index.js';
export const agentPackGeminiPackage = {
    packageName: '@ai-atomic-framework/agent-pack-gemini',
    packageRole: 'gemini-agent-pack',
    packageVersion: '0.0.0'
};
const targetFiles = createPackTargetFiles('.gemini/commands', createGeminiSourceFiles());
export const geminiPack = {
    packId: 'gemini',
    name: 'Gemini Agent Pack',
    version: agentPackGeminiPackage.packageVersion,
    agentTarget: 'gemini',
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
