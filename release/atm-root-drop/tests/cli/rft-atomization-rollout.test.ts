import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAtomizationLinePolicy } from '../../packages/cli/src/commands/tasks/task-import-validators.ts';

type RankedOversizedFile = {
  readonly file: string;
  readonly lines: number;
  readonly bugDensityScore: number;
  readonly sharedSurfaceScore: number;
  readonly extractionReadinessScore: number;
  readonly totalScore: number;
  readonly suggestedFollowUpPrefix: string;
};

const root = process.cwd();
const policy = resolveAtomizationLinePolicy({ config: readRepoConfig(root) });
const scanRoots = ['packages/cli/src/commands', 'scripts'] as const;
const oversized = scanOversizedFiles(root, scanRoots, policy.maxLines);
const teamValidatorPath = path.join(root, 'scripts', 'validate-team-agents.ts');
const teamValidatorAtoms = walkTsFiles(path.join(root, 'scripts', 'validators', 'team-agents'));

assert.equal(policy.maxLines, 600, 'framework default atomization maxLines should stay 600 unless explicitly lowered');
assert.equal(oversized.length, 0, 'RFT rollout inventory should have zero hard line-budget violations');
assert.ok(
  countLines(teamValidatorPath) <= policy.maxLines,
  'RFT rollout should keep scripts/validate-team-agents.ts below the atomization line bound after extraction'
);
assert.ok(teamValidatorAtoms.length >= 50, 'RFT rollout should preserve extracted Team validator atom files');
assert.ok(
  teamValidatorAtoms.every((file) => countLines(file) <= policy.maxLines),
  'extracted Team validator atoms must stay below the atomization line bound'
);
assert.ok(
  !oversized.some((entry) => entry.file === 'scripts/validate-team-agents.ts'),
  'RFT rollout inventory should no longer include the extracted Team validator harness as oversized'
);
assert.ok(oversized.every((entry) => entry.lines > policy.maxLines), 'inventory must only include files over configured line bound');

const ranked = rankOversizedFiles(oversized);
for (let index = 1; index < ranked.length; index += 1) {
  assert.ok(ranked[index - 1].totalScore >= ranked[index].totalScore, 'candidate ranking must be descending by total score');
}

const top = ranked.slice(0, 10);
assert.ok(top.every((entry) => entry.suggestedFollowUpPrefix === 'TASK-RFT'), 'follow-up cards must stay in the RFT family');
assert.ok(top.every((entry) => !entry.file.startsWith('.atm/')), 'rollout must not treat ATM runtime or history files as split candidates');

console.log(`[rft-atomization-rollout] ok (oversized=0, maxLines=${policy.maxLines})`);

function scanOversizedFiles(cwd: string, roots: readonly string[], maxLines: number): RankedOversizedFile[] {
  const files = roots.flatMap((entry) => walkTsFiles(path.join(cwd, entry)).map((file) => path.relative(cwd, file).replace(/\\/g, '/')));
  return files
    .map((file) => ({ file, lines: countLines(path.join(cwd, file)) }))
    .filter((entry) => entry.lines > maxLines)
    .map((entry) => {
      const scores = scoreFile(entry.file);
      return {
        ...entry,
        ...scores,
        totalScore: entry.lines + scores.bugDensityScore + scores.sharedSurfaceScore + scores.extractionReadinessScore,
        suggestedFollowUpPrefix: 'TASK-RFT'
      };
    });
}

function rankOversizedFiles(files: readonly RankedOversizedFile[]): RankedOversizedFile[] {
  return [...files].sort((left, right) => right.totalScore - left.totalScore || left.file.localeCompare(right.file));
}

function scoreFile(file: string) {
  const sharedSurfaceScore = /(?:tasks|team|batch|git|hook|next|broker|taskflow)/.test(file) ? 300 : 0;
  const extractionReadinessScore = /(?:validate|commands|orchestrator|facade|map)/.test(file) ? 150 : 0;
  const bugDensityScore = /(?:git|hook|task|team|broker)/.test(file) ? 100 : 0;
  return { bugDensityScore, sharedSurfaceScore, extractionReadinessScore };
}

function walkTsFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTsFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolute] : [];
  });
}

function countLines(filePath: string): number {
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function readRepoConfig(cwd: string): { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } } | null {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, 'utf8')) as { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } };
}
