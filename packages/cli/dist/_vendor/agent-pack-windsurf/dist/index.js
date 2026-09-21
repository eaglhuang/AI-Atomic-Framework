import { createHash } from 'node:crypto';
import { atmFirstCommand, charterInvariantsPlaceholder, minimumAtmEntrySkillDefinitions } from '../../integrations-core/dist/index.js';
export const agentPackWindsurfPackage = {
    packageName: '@ai-atomic-framework/agent-pack-windsurf',
    packageRole: 'windsurf-agent-pack',
    packageVersion: '0.0.0'
};
const targetFiles = minimumAtmEntrySkillDefinitions.map((entry) => ({
    path: `.windsurf/workflows/${entry.id}.md`,
    template: renderWorkflow(entry),
    protected: false
}));
export const windsurfPack = {
    packId: 'windsurf',
    name: 'Windsurf Agent Pack',
    version: agentPackWindsurfPackage.packageVersion,
    agentTarget: 'windsurf',
    targetFiles,
    sourceHash: hashTargetFiles(targetFiles)
};
function renderWorkflow(entry) {
    return `---
name: ${entry.id}
description: ${entry.summary}
---

# ${entry.title}

Start with the official ATM route:

\`\`\`bash
${atmFirstCommand}
\`\`\`

For this workflow, use the deterministic ATM command below when its input is available:

\`\`\`bash
${entry.command}
\`\`\`

## Charter Invariants

${charterInvariantsPlaceholder}

## Operating Rules

- Keep governed work inside ATM CLI routing.
- Do not create a second registry, task state, or approval workflow.
- Preserve host edits; manifest hashes decide uninstall safety.
`;
}
function hashTargetFiles(files) {
    return createHash('sha256').update(files.map((file) => `${file.path}\0${file.template}`).join('\0'), 'utf8').digest('hex');
}
