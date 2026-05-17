import { createHash } from 'node:crypto';
import type { AgentPack, TargetFile } from '../../agent-pack-sdk/src/index.ts';
import { atmFirstCommand, charterInvariantsPlaceholder, minimumAtmEntrySkillDefinitions } from '../../integrations-core/src/index.ts';

export const agentPackWindsurfPackage = {
  packageName: '@ai-atomic-framework/agent-pack-windsurf',
  packageRole: 'windsurf-agent-pack',
  packageVersion: '0.0.0'
} as const;

const targetFiles = minimumAtmEntrySkillDefinitions.map((entry) => ({
  path: `.windsurf/workflows/${entry.id}.md`,
  template: renderWorkflow(entry),
  protected: false
}));

export const windsurfPack: AgentPack = {
  packId: 'windsurf',
  name: 'Windsurf Agent Pack',
  version: agentPackWindsurfPackage.packageVersion,
  agentTarget: 'windsurf',
  targetFiles,
  sourceHash: hashTargetFiles(targetFiles)
};

function renderWorkflow(entry: typeof minimumAtmEntrySkillDefinitions[number]): string {
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

function hashTargetFiles(files: readonly TargetFile[]): string {
  return createHash('sha256').update(files.map((file) => `${file.path}\0${file.template}`).join('\0'), 'utf8').digest('hex');
}