import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createCopilotSourceFiles } from '../../integration-copilot/dist/index.js';
export const agentPackCopilotPackage = {
    packageName: '@ai-atomic-framework/agent-pack-copilot',
    packageRole: 'copilot-agent-pack',
    packageVersion: '0.0.0'
};
const targetFiles = createPackTargetFiles('.github', createCopilotSourceFiles());
export const copilotPack = {
    packId: 'copilot',
    name: 'GitHub Copilot Agent Pack',
    version: agentPackCopilotPackage.packageVersion,
    agentTarget: 'copilot',
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
