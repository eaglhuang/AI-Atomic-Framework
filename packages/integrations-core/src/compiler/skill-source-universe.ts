/**
 * compiler/skill-source-universe.ts
 *
 * TASK-SKL-0038 — sealed skill source universe
 *
 * Version control is an audit-stage fact, not a compile-stage one. This module
 * is where that fact is captured: a caller in the audit or seal stage probes
 * the repository once, hands the result here as plain data, and everything
 * downstream reasons about the sealed record instead of re-asking the local
 * workstation what it tracks, ignores, or excludes.
 *
 * Nothing in this module reads Git, and nothing that consumes its output may
 * either. That is what keeps a projection meaning the same thing on two
 * machines holding the same bytes.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Private: repo root is 4 levels above packages/integrations-core/src/compiler/
export const integrationsCoreRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const defaultSkillTemplateDirectory = path.join(integrationsCoreRepoRoot, 'templates', 'skills');

export function sha256Text(content: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export type SkillSourceTrackingState = 'tracked' | 'untracked' | 'ignored';

/**
 * Tracking state gathered by the audit/seal stage. Paths may be given relative
 * to the repository root or to the template directory; both are normalised
 * against the sealed source root.
 */
export interface SkillSourceTrackingProbe {
  readonly trackedPaths: readonly string[];
  readonly ignoredPaths: readonly string[];
}

export interface SkillSourceUniverseEntry {
  readonly sourcePath: string;
  readonly trackingState: SkillSourceTrackingState;
  readonly sourceDigest: `sha256:${string}`;
}

export interface SkillSourceUniverse {
  readonly schemaId: 'atm.skillSourceUniverse.v1';
  readonly specVersion: '0.1.0';
  readonly sealedAt: string;
  readonly sourceRoot: string;
  readonly entries: readonly SkillSourceUniverseEntry[];
  readonly universeDigest: `sha256:${string}`;
}

export interface SkillSourceUniverseFinding {
  readonly sourcePath: string;
  readonly trackingState: 'untracked' | 'ignored';
  readonly recovery: string;
}

export function sealSkillSourceUniverse(input: {
  readonly templateDirectory?: string;
  readonly probe: SkillSourceTrackingProbe;
  readonly sealedAt?: string;
}): SkillSourceUniverse {
  const templateDirectory = input.templateDirectory ?? defaultSkillTemplateDirectory;
  const sourceRoot = path.relative(integrationsCoreRepoRoot, templateDirectory).replace(/\\/g, '/');
  const tracked = normalizeProbePaths(input.probe.trackedPaths, sourceRoot);
  const ignored = normalizeProbePaths(input.probe.ignoredPaths, sourceRoot);
  const entries = readdirSync(templateDirectory)
    .filter((entryName) => entryName.endsWith('.skill.md'))
    .sort((left, right) => left.localeCompare(right))
    .map((entryName) => {
      const sourcePath = sourceRoot ? `${sourceRoot}/${entryName}` : entryName;
      // Ignored wins over tracked: a file that is both is the exact incident
      // TASK-SKL-0027 recorded, and it must not be reported as healthy.
      const trackingState: SkillSourceTrackingState = ignored.has(sourcePath)
        ? 'ignored'
        : tracked.has(sourcePath)
          ? 'tracked'
          : 'untracked';
      return {
        sourcePath,
        trackingState,
        sourceDigest: sha256Text(readFileSync(path.join(templateDirectory, entryName), 'utf8'))
      };
    });
  return {
    schemaId: 'atm.skillSourceUniverse.v1',
    specVersion: '0.1.0',
    sealedAt: input.sealedAt ?? new Date(0).toISOString(),
    sourceRoot,
    entries,
    universeDigest: sha256Text(JSON.stringify(entries))
  };
}

/**
 * Every formal source template that is not under version control, paired with
 * the command that repairs it. These are hard findings: a corpus holding one
 * cannot be reproduced by anyone else, so it must not reach a projection.
 */
export function collectSkillSourceUniverseFindings(
  universe: SkillSourceUniverse
): readonly SkillSourceUniverseFinding[] {
  return universe.entries
    .filter((entry) => entry.trackingState !== 'tracked')
    .map((entry) => ({
      sourcePath: entry.sourcePath,
      trackingState: entry.trackingState as 'untracked' | 'ignored',
      recovery: entry.trackingState === 'untracked'
        ? `Bring ${entry.sourcePath} under version control before it may be sealed into the corpus: git add -- ${entry.sourcePath}`
        : `${entry.sourcePath} is excluded from version control. Remove the rule that ignores it from .gitignore or .git/info/exclude, then track it normally — a formal source template must never be forced past its own ignore rule.`
    }));
}

function normalizeProbePaths(paths: readonly string[], sourceRoot: string): ReadonlySet<string> {
  return new Set(paths.map((entry) => {
    const normalized = entry.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!sourceRoot || normalized.startsWith(`${sourceRoot}/`)) return normalized;
    return `${sourceRoot}/${normalized}`;
  }));
}
