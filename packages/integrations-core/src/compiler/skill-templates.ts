/**
 * compiler/skill-templates.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * ATM skill template parser, loader, and minimum entry skill definitions.
 * No dependencies on manifest or verify submodules.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Private: repo root is 4 levels above packages/integrations-core/src/compiler/
const integrationsCoreRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const defaultSkillTemplateDirectory = path.join(integrationsCoreRepoRoot, 'templates', 'skills');

export type SkillTemplateAdapterTarget = 'claude-code' | 'copilot' | 'cursor' | 'gemini' | 'codex';

export interface AtmSkillTemplateFrontmatter {
  readonly schemaId: 'atm.skillTemplate';
  readonly specVersion: '0.1.0';
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly command: string;
  readonly firstCommand: string;
  readonly 'charter-invariants-injected': boolean;
  readonly handoffs: string;
}

export interface SkillProviderProvenance {
  readonly providerId: string;
  readonly version: string;
  readonly provenance: {
    readonly upstreamUrl: string;
    readonly upstreamCommit: string;
    readonly sourceDigest: `sha256:${string}`;
  };
  readonly license: string;
}

export interface AtmSkillDefinitionVNext {
  readonly schemaId: 'atm.skillDefinition.vNext';
  readonly specVersion: '0.1.0';
  readonly provider: SkillProviderProvenance;
  readonly capabilities: readonly string[];
  readonly compatibility: { readonly atmContractVersions: readonly string[] };
  readonly fallbackPolicy: 'deny' | 'degrade-with-evidence' | 'legacy-compatible';
  readonly rollbackPolicy: 'provider-only' | 'manifest-only' | 'full-revert';
  readonly shadowRun?: boolean;
  readonly promotion?: 'manual-review' | 'measured-promotion' | 'disabled';
}

export interface SkillCapabilityManifestInput {
  readonly provider: SkillProviderProvenance;
  readonly capabilities: readonly string[];
  readonly atmContractVersions: readonly string[];
  readonly fallbackPolicy?: AtmSkillDefinitionVNext['fallbackPolicy'];
  readonly rollbackPolicy?: AtmSkillDefinitionVNext['rollbackPolicy'];
  readonly shadowRun?: boolean;
  readonly promotion?: AtmSkillDefinitionVNext['promotion'];
}

export function createSkillDefinitionVNext(input: SkillCapabilityManifestInput): AtmSkillDefinitionVNext {
  const capabilities = [...new Set(input.capabilities.map((value) => value.trim()).filter(Boolean))].sort();
  const atmContractVersions = [...new Set(input.atmContractVersions.map((value) => value.trim()).filter(Boolean))].sort();
  if (capabilities.length === 0) throw new Error('skill definition requires at least one capability');
  if (atmContractVersions.length === 0) throw new Error('skill definition requires an ATM contract version');
  return {
    schemaId: 'atm.skillDefinition.vNext',
    specVersion: '0.1.0',
    provider: input.provider,
    capabilities,
    compatibility: { atmContractVersions },
    fallbackPolicy: input.fallbackPolicy ?? 'degrade-with-evidence',
    rollbackPolicy: input.rollbackPolicy ?? 'provider-only',
    shadowRun: input.shadowRun ?? true,
    promotion: input.promotion ?? 'manual-review'
  };
}

export function projectSkillDefinition(
  template: AtmSkillTemplate,
  manifest: SkillCapabilityManifestInput
): AtmSkillDefinitionVNext & { readonly skillId: string; readonly legacyReadable: true } {
  return {
    ...createSkillDefinitionVNext(manifest),
    skillId: template.frontmatter.id,
    legacyReadable: true
  };
}

export interface AtmSkillTemplate {
  readonly frontmatter: AtmSkillTemplateFrontmatter;
  readonly body: string;
  readonly sourcePath: string;
}

export interface CompileSkillTemplateOptions {
  readonly repositoryRoot?: string;
}

export const minimumAtmEntrySkillDefinitions = [
  {
    id: 'atm-next',
    title: 'ATM Next',
    summary: 'Recommend the next official ATM guidance action from current state.',
    command: 'node atm.mjs next --prompt "$ARGUMENTS" --json'
  },
  {
    id: 'atm-task-intent-resolver',
    title: 'ATM Task Intent Resolver',
    summary: 'Resolve the current user prompt into an atm.taskIntent.v1 proposal before next-action routing.',
    command: 'node atm.mjs next --intent .atm/runtime/task-intent.json --json'
  },
  {
    id: 'atm-orient',
    title: 'ATM Orient',
    summary: 'Inspect a repository and emit a guidance orientation report.',
    command: 'node atm.mjs orient --cwd . --json'
  },
  {
    id: 'atm-governance-router',
    title: 'ATM Governance Router',
    summary: 'Route natural-language cleanup, refactor, migration, and candidate ranking goals through ATM before local analysis.',
    command: 'node atm.mjs guide --goal "$ARGUMENTS" --cwd . --json'
  },
  {
    id: 'atm-dispatch',
    title: 'ATM Dispatch',
    summary: 'ATM Captain dispatch routing for task cards, sidecars, subagents, condition review, mailbox work, and closeout coordination.',
    command: 'node atm.mjs next --prompt "$ARGUMENTS" --json'
  },
  {
    id: 'atm-create',
    title: 'ATM Create',
    summary: 'Create and register an atom through the provisioning facade.',
    command: 'node atm.mjs create --bucket CORE --title "$ARGUMENTS" --dry-run --json'
  },
  {
    id: 'atm-lock',
    title: 'ATM Lock',
    summary: 'Check, acquire, or release a governed scope lock.',
    command: 'node atm.mjs lock check --json'
  },
  {
    id: 'atm-evidence',
    title: 'ATM Evidence',
    summary: 'Explain missing evidence or blocked guidance before proceeding.',
    command: 'node atm.mjs explain --why blocked --json'
  },
  {
    id: 'atm-error-code-resolver',
    title: 'ATM Error Code Resolver',
    summary: 'Resolve ATM_* error codes from CLI JSON, logs, or user reports into canonical meaning, remediation, retryability, and approval guidance.',
    command: 'node atm.mjs next --prompt "$ARGUMENTS" --json'
  },
  {
    id: 'atm-plan-authoring',
    title: 'ATM Plan Authoring',
    summary: 'Create registered planning families, plan documents, and task cards through the tool-first plan CLI.',
    command: 'node atm.mjs plan card create $ARGUMENTS --dry-run --json'
  },
  {
    id: 'atm-upgrade-scan',
    title: 'ATM Upgrade Scan',
    summary: 'Scan evidence reports and draft governed upgrade proposals.',
    command: 'node atm.mjs upgrade --scan --input "$ARGUMENTS" --json'
  },
  {
    id: 'atm-handoff',
    title: 'ATM Handoff',
    summary: 'Write a continuation summary for governed work.',
    command: 'node atm.mjs handoff summarize --task "$ARGUMENTS" --json'
  },
  {
    id: 'mailbox-worker-execution',
    title: 'Mailbox Worker Execution',
    summary: 'Mailbox worker execution workflow for agents that claim dispatch cards, complete scoped work, run required checks, and report done or blocked with evidence.',
    command: 'node atm.mjs next --prompt "$ARGUMENTS" --json'
  },
  {
    id: 'atm-internal-build-sync',
    title: 'ATM Internal Build Sync',
    summary: 'Build the ATM framework runner and sync it to explicit internal adopter repositories with skip/exclude controls.',
    command: 'node atm.mjs internal-release sync $ARGUMENTS --json'
  },
  {
    id: 'atm-framework-temp-claim',
    title: 'ATM Framework Temp Claim',
    summary: 'Governed, tool-first route for scoped ATM framework quickfix work — dedicated skill for framework-mode claim, runner-sync queue-head reservation, sealed runner rebuild, and release, with CLI fallback that stays copy-paste runnable.',
    command: 'node atm.mjs next --prompt "$ARGUMENTS" --json'
  },
  {
    id: 'atm-atom-map-refactor',
    title: 'ATM Atom Map Refactor',
    summary: 'Plan ATM framework refactors by preserving atom/map semantics before splitting large governance modules.',
    command: 'node atm.mjs next --prompt "$ARGUMENTS" --json'
  },
  {
    id: 'atm-memory-consolidate',
    title: 'ATM Memory Consolidate',
    summary: "Reflective consolidation pass over a repository's keep-memory notes — merge duplicates, retire stale entries, rebuild the summary index.",
    command: 'node atm.mjs next --prompt "$ARGUMENTS" --json'
  }
] as const;

export function parseSkillTemplate(content: string, sourcePath = '<inline>'): AtmSkillTemplate {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error(`skill template missing frontmatter: ${sourcePath}`);
  }
  const frontmatter = parseSkillTemplateFrontmatter(frontmatterMatch[1], sourcePath);
  return {
    frontmatter,
    body: frontmatterMatch[2],
    sourcePath
  };
}

export function loadSkillTemplates(templateDirectory = defaultSkillTemplateDirectory): readonly AtmSkillTemplate[] {
  return readdirSync(templateDirectory)
    .filter((entryName) => entryName.endsWith('.skill.md'))
    .sort((left, right) => left.localeCompare(right))
    .map((entryName) => {
      const templatePath = path.join(templateDirectory, entryName);
      return parseSkillTemplate(readFileSync(templatePath, 'utf8'), path.relative(integrationsCoreRepoRoot, templatePath).replace(/\\/g, '/'));
    });
}

export function loadMinimumAtmSkillTemplates(templateDirectory = defaultSkillTemplateDirectory): readonly AtmSkillTemplate[] {
  const templatesById = new Map(loadSkillTemplates(templateDirectory).map((template) => [template.frontmatter.id, template]));
  return minimumAtmEntrySkillDefinitions.map((entryDefinition) => {
    const template = templatesById.get(entryDefinition.id);
    if (!template) {
      throw new Error(`missing ATM skill template: ${entryDefinition.id}`);
    }
    return template;
  });
}

// ─── Private helpers ───────────────────────────────────────────────────────

function parseSkillTemplateFrontmatter(frontmatterSource: string, sourcePath: string): AtmSkillTemplateFrontmatter {
  const frontmatter = Object.fromEntries(frontmatterSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex < 0) {
        throw new Error(`invalid skill template frontmatter line in ${sourcePath}: ${line}`);
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = parseFrontmatterScalar(line.slice(separatorIndex + 1).trim());
      return [key, value];
    }));
  return frontmatter as unknown as AtmSkillTemplateFrontmatter;
}

function parseFrontmatterScalar(value: string): string | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value.replace(/^['"]|['"]$/g, '');
}
