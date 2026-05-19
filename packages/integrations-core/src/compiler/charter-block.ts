/**
 * Charter invariants block renderer for integration skills.
 *
 * Extracted from `packages/integrations-core/src/index.ts` per the
 * `SPLIT_PLAN.md` Layer 3 split. The smallest, lowest-coupling
 * extraction — a single render function + its private line helper.
 *
 * Surface contract: the rendered text appears inside compiled skill
 * templates and contributes to manifest hashes (invariant I5, hash
 * stability). Output is byte-identical with the original.
 *
 * The default `repositoryRoot` resolution remains owned by index.ts
 * (`integrationsCoreRepoRoot`); callers may pass an explicit root.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface RenderedCharterInvariants {
  readonly text: string;
  readonly sourcePath: string | null;
  readonly invariantCount: number;
  readonly fallbackReason: 'missing' | 'unreadable' | 'invalid' | null;
}

export function renderCharterInvariantsBlock(repositoryRoot: string): RenderedCharterInvariants {
  const invariantsPath = path.join(repositoryRoot, '.atm', 'charter', 'charter-invariants.json');
  if (!existsSync(invariantsPath)) {
    return {
      text: 'Charter invariants are unavailable in this repository yet. Restore `.atm/charter/charter-invariants.json` and rerun `node atm.mjs integration add <editor-id> --force --json` to inject the current repo charter.',
      sourcePath: null,
      invariantCount: 0,
      fallbackReason: 'missing'
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(invariantsPath, 'utf8')) as {
      invariants?: Array<{
        id?: unknown;
        title?: unknown;
        rule?: unknown;
        enforcement?: unknown;
        breakingChange?: unknown;
      }>;
    };
    const invariants = Array.isArray(parsed.invariants)
      ? parsed.invariants
        .filter((entry) => typeof entry?.id === 'string' && typeof entry?.title === 'string' && typeof entry?.rule === 'string')
        .map((entry) => ({
          id: entry.id as string,
          title: entry.title as string,
          rule: entry.rule as string,
          enforcement: typeof entry.enforcement === 'string' ? entry.enforcement : 'unknown',
          breakingChange: entry.breakingChange === true
        }))
      : [];
    if (invariants.length === 0) {
      return {
        text: 'Charter invariants are unreadable in this repository. Repair `.atm/charter/charter-invariants.json` and rerun `node atm.mjs integration add <editor-id> --force --json`.',
        sourcePath: path.relative(repositoryRoot, invariantsPath).replace(/\\/g, '/'),
        invariantCount: 0,
        fallbackReason: 'invalid'
      };
    }
    return {
      text: invariants.map((entry) => renderCharterInvariantLine(entry)).join('\n'),
      sourcePath: path.relative(repositoryRoot, invariantsPath).replace(/\\/g, '/'),
      invariantCount: invariants.length,
      fallbackReason: null
    };
  } catch {
    return {
      text: 'Charter invariants could not be read in this repository. Repair `.atm/charter/charter-invariants.json` and rerun `node atm.mjs integration add <editor-id> --force --json`.',
      sourcePath: path.relative(repositoryRoot, invariantsPath).replace(/\\/g, '/'),
      invariantCount: 0,
      fallbackReason: 'unreadable'
    };
  }
}

function renderCharterInvariantLine(entry: {
  readonly id: string;
  readonly title: string;
  readonly rule: string;
  readonly enforcement: string;
  readonly breakingChange: boolean;
}) {
  const breakingChange = entry.breakingChange ? 'yes' : 'no';
  return `- \`${entry.id}\` — **${entry.title}** (enforcement: \`${entry.enforcement}\`, breaking change: ${breakingChange})\n  Rule: ${entry.rule}`;
}
