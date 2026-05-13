import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { relativePathFrom } from './shared.ts';

export const supportedAgentProfiles = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    executionMode: 'profile-confidence',
    workflow: 'Use the official self-host-alpha prompt and advisory confidence report.'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    executionMode: 'profile-confidence',
    workflow: 'Use the official self-host-alpha prompt without IDE-specific slash commands.'
  },
  {
    id: 'aider',
    label: 'Aider',
    executionMode: 'profile-confidence',
    workflow: 'Start from AGENTS.md and run the deterministic self-host-alpha proof as a message-driven session.'
  },
  {
    id: 'github-copilot-agent',
    label: 'GitHub Copilot Agent',
    executionMode: 'profile-confidence',
    workflow: 'Use the official self-host-alpha prompt and vendor-neutral AGENTS instructions.'
  },
  {
    id: 'openai-assistants-api',
    label: 'OpenAI Assistants API',
    executionMode: 'profile-confidence',
    workflow: 'Use the official self-host-alpha prompt through an assistants-compatible message envelope.'
  }
];

const agentAliases = new Map([
  ['claude-code', 'claude-code'],
  ['claude', 'claude-code'],
  ['cursor', 'cursor'],
  ['aider', 'aider'],
  ['github-copilot-agent', 'github-copilot-agent'],
  ['github-copilot', 'github-copilot-agent'],
  ['copilot-agent', 'github-copilot-agent'],
  ['openai-assistants-api', 'openai-assistants-api'],
  ['openai-assistants', 'openai-assistants-api'],
  ['openai-assistant', 'openai-assistants-api']
]);

const vendorSpecificMarkers = [
  '/fix',
  '/explain',
  '/terminal',
  'Cursor-specific',
  'Copilot Chat',
  'Claude Code',
  'OpenAI Assistants API',
  'slash command'
];

const templateRequiredMarkers = [
  '# ATM Bootstrap Instructions',
  '{{RECOMMENDED_PROMPT}}',
  '{{BOOTSTRAP_TASK_PATH}}',
  '{{BOOTSTRAP_PROFILE_PATH}}',
  '{{BOOTSTRAP_EVIDENCE_PATH}}'
];

const renderedRequiredMarkers = [
  '# ATM Bootstrap Instructions',
  'node atm.mjs next --json',
  '.atm/runtime/profile/default.md',
  '.atm/history/tasks/BOOTSTRAP-0001.json',
  '.atm/history/evidence/BOOTSTRAP-0001.json'
];

export function listSupportedAgentIds() {
  return supportedAgentProfiles.map((profile) => profile.id);
}

export function resolveAgentProfile(agentId: any) {
  if (typeof agentId !== 'string') {
    return null;
  }
  const normalizedId = agentAliases.get(agentId.trim().toLowerCase());
  return supportedAgentProfiles.find((profile) => profile.id === normalizedId) ?? null;
}

export function verifyAgentsMarkdown(cwd: any) {
  const renderedPath = path.join(cwd, 'AGENTS.md');
  const templatePath = path.join(cwd, 'templates', 'root-drop', 'AGENTS.md');
  const useRendered = existsSync(renderedPath);
  const filePath = useRendered ? renderedPath : templatePath;
  const mode = useRendered ? 'rendered' : 'template';

  if (!existsSync(filePath)) {
    return {
      ok: false,
      mode: 'missing',
      path: null,
      checked: [],
      issues: ['AGENTS.md or templates/root-drop/AGENTS.md is missing.']
    };
  }

  const content = readFileSync(filePath, 'utf8');
  const requiredMarkers = useRendered ? renderedRequiredMarkers : templateRequiredMarkers;
  const issues = [];

  for (const marker of requiredMarkers) {
    if (!content.includes(marker)) {
      issues.push(`missing required marker: ${marker}`);
    }
  }

  for (const marker of vendorSpecificMarkers) {
    if (content.includes(marker)) {
      issues.push(`contains vendor-specific marker: ${marker}`);
    }
  }

  return {
    ok: issues.length === 0,
    mode,
    path: relativePathFrom(cwd, filePath),
    checked: requiredMarkers,
    issues
  };
}

export function createAgentConfidenceEvidence(profile: any, criteria: any, agentsMdVerification: any) {
  const failedCriteria = Object.entries(criteria)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  const blockers = [...failedCriteria];
  if (!agentsMdVerification.ok) {
    blockers.push('agents-md');
  }

  return {
    advisory: true,
    blockingRelease: false,
    agentId: profile.id,
    agentLabel: profile.label,
    executionMode: profile.executionMode,
    workflow: profile.workflow,
    confidenceReady: blockers.length === 0,
    blockers,
    agentsMd: agentsMdVerification
  };
}
