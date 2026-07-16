import { existsSync } from 'node:fs';
import path from 'node:path';
import { createClaudeCodeIntegrationAdapter } from '../../../../integration-claude-code/src/index.ts';
import { createCopilotIntegrationAdapter } from '../../../../integration-copilot/src/index.ts';
import { createCodexIntegrationAdapter } from '../../../../integration-codex/src/index.ts';
import { createCursorIntegrationAdapter } from '../../../../integration-cursor/src/index.ts';
import { createAntigravityIntegrationAdapter, createGeminiIntegrationAdapter } from '../../../../integration-gemini/src/index.ts';
import type { IntegrationAdapter } from '../../../../integrations-core/src/index.ts';
import { CliError } from '../shared.ts';
import type { InstallIntegrationOptions } from './types.ts';

export type IntegrationHooksModule = typeof import('../integration-hooks.ts');

export const integrationAdapterFactories = Object.freeze({
  'claude-code': createClaudeCodeIntegrationAdapter,
  codex: createCodexIntegrationAdapter,
  copilot: createCopilotIntegrationAdapter,
  cursor: createCursorIntegrationAdapter,
  gemini: createGeminiIntegrationAdapter,
  antigravity: createAntigravityIntegrationAdapter
});

export const primaryEntryPathByAdapterId = Object.freeze({
  'claude-code': '.claude/skills/atm-governance-router/SKILL.md',
  codex: 'integrations/codex-skills/atm-governance-router/SKILL.md',
  copilot: '.github/instructions/atm-governance-router.instructions.md',
  cursor: '.cursor/rules/skills/atm-governance-router/SKILL.md',
  gemini: '.gemini/commands/atm-governance-router.toml',
  antigravity: 'GEMINI.md'
} satisfies Record<KnownCliIntegrationId, string>);

export type KnownCliIntegrationId = keyof typeof integrationAdapterFactories;
export type EditorDetectionSource = 'ATM_EDITOR_ID' | 'ATM_ACTOR_ID' | 'AGENT_IDENTITY' | 'CODEX_HOME';

interface DetectedCurrentEditor {
  readonly id: KnownCliIntegrationId | null;
  readonly source: EditorDetectionSource | null;
  readonly rawValue: string | null;
}

export function availableAdapters(repositoryRoot: string) {
  return Object.keys(integrationAdapterFactories).map((adapterId) => describeAdapter(createIntegrationAdapter(adapterId), repositoryRoot));
}

export function detectCurrentEditorIntegrationId(env: NodeJS.ProcessEnv = process.env): DetectedCurrentEditor {
  const explicitCandidates: Array<{ readonly source: EditorDetectionSource; readonly value: string | undefined }> = [
    { source: 'ATM_EDITOR_ID', value: env.ATM_EDITOR_ID },
    { source: 'ATM_ACTOR_ID', value: env.ATM_ACTOR_ID },
    { source: 'AGENT_IDENTITY', value: env.AGENT_IDENTITY }
  ];
  for (const candidate of explicitCandidates) {
    const normalizedId = normalizeDetectedEditorId(candidate.value);
    if (normalizedId) {
      return {
        id: normalizedId,
        source: candidate.source,
        rawValue: candidate.value ?? null
      };
    }
  }
  if (typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim().length > 0) {
    return {
      id: 'codex',
      source: 'CODEX_HOME',
      rawValue: env.CODEX_HOME
    };
  }
  return {
    id: null,
    source: null,
    rawValue: null
  };
}

export function describeAdapter(adapter: IntegrationAdapter, repositoryRoot: string) {
  const manifestPath = manifestPathForIntegration(adapter.id);
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    adapterVersion: adapter.adapterVersion,
    targetDir: adapter.targetDir({ repositoryRoot, manifestPath }),
    fileFormat: adapter.fileFormat,
    placeholderStyle: adapter.placeholderStyle,
    manifestPath,
    installed: existsSync(path.join(repositoryRoot, manifestPath))
  };
}

function normalizeDetectedEditorId(value: string | undefined): KnownCliIntegrationId | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (Object.hasOwn(integrationAdapterFactories, normalized)) {
    return normalized as KnownCliIntegrationId;
  }
  if (normalized.includes('copilot')) return 'copilot';
  if (normalized.includes('claude')) return 'claude-code';
  if (normalized.includes('codex')) return 'codex';
  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('antigravity')) return 'antigravity';
  return null;
}

export function createIntegrationContext(repositoryRoot: string, adapter: IntegrationAdapter, options: InstallIntegrationOptions) {
  return {
    repositoryRoot,
    actor: options.actor,
    now: options.now,
    dryRun: options.dryRun,
    manifestPath: manifestPathForIntegration(adapter.id)
  };
}

export function manifestPathForIntegration(adapterId: string) {
  return `.atm/integrations/${adapterId}.manifest.json`;
}

export function createIntegrationAdapter(adapterId: string): IntegrationAdapter {
  const factory = integrationAdapterFactories[adapterId as KnownCliIntegrationId];
  if (!factory) {
    throw new CliError('ATM_INTEGRATION_UNKNOWN_ADAPTER', `Unknown integration adapter: ${adapterId}`, {
      exitCode: 2,
      details: {
        availableAdapters: Object.keys(integrationAdapterFactories)
      }
    });
  }
  return factory();
}

export function isKnownIntegrationAdapter(adapterId: string) {
  return Object.hasOwn(integrationAdapterFactories, adapterId);
}

export function requireAdapterId(adapterId: string | undefined, action: string) {
  if (!adapterId) {
    throw new CliError('ATM_CLI_USAGE', `integration ${action} requires an adapter id`, { exitCode: 2 });
  }
  return adapterId;
}

export function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
