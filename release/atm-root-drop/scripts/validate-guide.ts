import { createValidator } from './lib/validator-harness.ts';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace } from './temp-root.ts';
import { classifyGuidanceIntent } from '../packages/core/src/guidance/index.ts';
import {
  buildFirstLayerCommandContract,
  classifyFirstLayerIntent
} from '../packages/core/src/guidance/index.ts';

const validator = createValidator('guide');
const { assert, requireFile, runAtmJsonPortable, ok, readText, root } = validator;

for (const relativePath of [
  'atm.mjs',
  'packages/cli/src/commands/guide.ts',
  'packages/cli/src/commands/candidates.ts',
  'packages/core/src/guidance/intent-classifier.ts',
  'packages/core/src/guidance/first-layer-command-contracts.ts',
  'packages/cli/src/commands/glossary-data.ts',
  'packages/cli/src/commands/command-specs.ts',
  'integrations/codex-skills/atm-governance-router/SKILL.md'
]) {
  requireFile(relativePath, `missing guide dependency: ${relativePath}`);
}

const glossary = await runAtmJsonPortable(['guide', 'glossary', '--json']);
assert(glossary.exitCode === 0, 'guide glossary must exit 0');
assert(glossary.parsed.ok === true, 'guide glossary must report ok=true');
assert(Array.isArray(glossary.parsed.evidence?.terms), 'guide glossary must return evidence.terms array');
assert((glossary.parsed.evidence?.terms as unknown[]).length >= 10, 'guide glossary must expose at least 10 terms');

const guideHelp = await runAtmJsonPortable(['guide', 'help', 'next', '--json']);
assert(guideHelp.exitCode === 0, 'guide help next must exit 0');
assert(guideHelp.parsed.ok === true, 'guide help next must report ok=true');
assert(guideHelp.parsed.evidence?.usage?.command === 'next', 'guide help next must target next command');

const commandHelp = await runAtmJsonPortable(['next', '--help', '--json']);
assert(commandHelp.exitCode === 0, 'next --help must exit 0');
assert(commandHelp.parsed.ok === true, 'next --help must report ok=true');
assert(
  JSON.stringify(guideHelp.parsed.evidence?.usage ?? null) === JSON.stringify(commandHelp.parsed.evidence?.usage ?? null),
  'guide help next usage must equal next --help usage'
);

const firstLayerContract = buildFirstLayerCommandContract();
assert(firstLayerContract.routeMatrix.length === 4, 'first-layer contract must define backlog/audit/optimization/create route matrix rows');
assert(firstLayerContract.routeMatrixDigest.startsWith('sha256:'), 'first-layer route matrix must expose a stable digest');
for (const intent of ['backlog', 'audit', 'optimization', 'create'] as const) {
  assert(firstLayerContract.routeMatrix.some((row) => row.intent === intent), `first-layer route matrix missing ${intent}`);
}
for (const state of [
  'execute-now',
  'batch/applyStrategy=compose',
  'queue(position/head/health/waitedMs/release condition)',
  'revalidation-required',
  'reconcile-required',
  'ATM_LOCK_CONFLICT'
]) {
  assert(firstLayerContract.ticketStates.some((entry) => entry.state === state), `first-layer ticket state missing ${state}`);
}
assert(
  firstLayerContract.ticketStates.find((entry) => entry.state === 'ATM_LOCK_CONFLICT')?.errorCode === 'ATM_LOCK_CONFLICT',
  'R1 lock conflict must keep ATM_LOCK_CONFLICT as the only ErrorCode state'
);
assert(firstLayerContract.windowsSafeExamples.markdownRead.includes('readFileSync'), 'Windows-safe examples must prefer Node UTF-8 reads');
assert(firstLayerContract.windowsSafeExamples.textSearch.startsWith('rg '), 'Windows-safe examples must include rg text search');
assert(firstLayerContract.windowsSafeExamples.forbiddenPattern.includes('PowerShell range'), 'Windows-safe examples must ban PowerShell range parsing');

const firstLayerGuide = await runAtmJsonPortable(['guide', 'first-layer', '--json']);
assert(firstLayerGuide.exitCode === 0, 'guide first-layer must exit 0');
assert(firstLayerGuide.parsed.ok === true, 'guide first-layer must report ok=true');
assert(firstLayerGuide.parsed.evidence?.routeMatrixDigest === firstLayerContract.routeMatrixDigest, 'guide first-layer must use canonical route matrix digest');
assert(firstLayerGuide.parsed.evidence?.commonCommands?.release?.includes('broker release'), 'guide first-layer must expose release syntax');
assert(firstLayerGuide.parsed.evidence?.commonCommands?.checkpoint?.includes('batch checkpoint'), 'guide first-layer must expose checkpoint syntax');
assert(firstLayerGuide.parsed.evidence?.commonCommands?.audit?.includes('tasks audit'), 'guide first-layer must expose audit syntax');
assert(firstLayerGuide.parsed.evidence?.commonCommands?.backlog?.includes('guide first-layer'), 'guide first-layer must expose backlog first-layer syntax');

for (const goal of [
  'atomize a legacy parser',
  'extract an old helper into an atom',
  'split old hotspot helper',
  'migrate inherited formatter into atom',
  'refactor monolith function safely'
]) {
  const classification = classifyGuidanceIntent(goal, { adapterStatus: 'available' });
  assert(classification.matchedIntent === 'legacy-atomization', `classifier must catch legacy atomization intent: ${goal}`);
  assert(classification.blockedAntiPatterns.includes('direct trunk rewrite'), `classifier must block trunk rewrite for: ${goal}`);
}

for (const goal of [
  'rank the messiest Python pipeline scripts',
  'prioritize cleanup candidates',
  'build a source inventory for pipeline hotspots',
  '請幫我看看目前這個 repo 裡，哪些 Python 資料管線最亂、最值得先整理，先幫我排一下優先順序。'
]) {
  const classification = classifyGuidanceIntent(goal, { adapterStatus: 'available' });
  assert(classification.matchedIntent === 'legacy-candidate-ranking', `classifier must catch candidate ranking intent: ${goal}`);
  assert(classification.nextCommand.includes('candidates rank'), `classifier must route candidate ranking to candidates rank: ${goal}`);
}

for (const [goal, expectedIntent] of [
  ['update README documentation', 'docs-spec'],
  ['create new atom for a greenfield capability', 'atom-create'],
  ['import task cards from a markdown plan', 'task-plan-import'],
  ['clean up package whitespace', 'unknown']
] as const) {
  const classification = classifyGuidanceIntent(goal, { adapterStatus: 'available' });
  assert(classification.matchedIntent === expectedIntent, `classifier must route "${goal}" to ${expectedIntent}`);
}

for (const [goal, expectedFirstLayerIntent] of [
  ['record this ATM bug in the backlog', 'backlog'],
  ['audit the task cards and report governance residue', 'audit'],
  ['propose an optimization for captain routing friction', 'optimization']
] as const) {
  const matrixRow = classifyFirstLayerIntent(goal);
  assert(matrixRow?.intent === expectedFirstLayerIntent, `first-layer matrix must match ${goal}`);
  const classification = classifyGuidanceIntent(goal, { adapterStatus: 'available' });
  assert(classification.matchedIntent === 'governance-first-layer', `classifier must route "${goal}" to governance-first-layer`);
  assert(!classification.nextCommand.includes('create-atom'), `classifier must not route "${goal}" to create-atom`);
}
assert(
  classifyGuidanceIntent('create a new atom for a greenfield capability', { adapterStatus: 'available' }).matchedIntent === 'atom-create',
  'explicit create prompt must keep atom-create behavior'
);

const skill = readText('integrations/codex-skills/atm-governance-router/SKILL.md');
for (const requiredText of [
  'legacy',
  'atomize',
  'infect',
  'candidate ranking',
  'source inventory',
  'police artifact',
  'split',
  'atm guide --goal',
  'atm candidates rank',
  'atm start --legacy-flow',
  'atm next',
  'dry-run proposal',
  'human review',
  'governanceReadiness',
  'protected push',
  'doctor --json',
  'hook pre-push',
  'queueRetryCodes',
  'upstreamRef'
]) {
  assert(skill.includes(requiredText), `skill must include trigger/workflow text: ${requiredText}`);
}
for (const bannedText of ['H2U', '3KLife', 'draft-builder']) {
  assert(!skill.includes(bannedText), `skill must stay adopter-neutral and exclude ${bannedText}`);
}

const tempRoot = createTempWorkspace('atm-guide-');
try {
  const blankRepo = path.join(tempRoot, 'blank');
  mkdirSync(blankRepo, { recursive: true });
  const blankGuide = await runAtmJsonPortable(['guide', '--cwd', blankRepo, '--goal', 'atomize a legacy parser', '--json'], root);
  assert(blankGuide.exitCode === 0, 'guide --goal must exit 0 in a blank repo');
  assert(blankGuide.parsed.evidence?.matchedIntent === 'legacy-atomization', 'blank guide must preserve semantic legacy intent');
  assert(blankGuide.parsed.evidence?.routeIntent === 'adapter-bootstrap', 'blank guide must route to adapter-bootstrap');
  assert(String(blankGuide.parsed.evidence?.nextCommand ?? '').includes('bootstrap'), 'blank guide nextCommand must bootstrap first');

  const adaptedRepo = path.join(tempRoot, 'adapted');
  mkdirSync(path.join(adaptedRepo, '.atm'), { recursive: true });
  writeFileSync(path.join(adaptedRepo, '.atm', 'config.json'), JSON.stringify({
    schemaVersion: '0.1.0',
    adapter: { mode: 'standalone' },
    guidance: {
      legacyHotspots: [
        { path: 'src/legacy-helper.js', releaseBlockers: ['processRequest'] }
      ]
    }
  }, null, 2));
  const adaptedGuide = await runAtmJsonPortable(['guide', '--cwd', adaptedRepo, '--goal', 'extract an old helper into an atom', '--json'], root);
  assert(adaptedGuide.exitCode === 0, 'guide --goal must exit 0 in an adapted repo');
  assert(adaptedGuide.parsed.evidence?.matchedIntent === 'legacy-atomization', 'adapted guide must classify legacy atomization');
  assert(adaptedGuide.parsed.evidence?.routeIntent === 'legacy-atomization', 'adapted guide must route to legacy atomization');
  assert(String(adaptedGuide.parsed.evidence?.nextCommand ?? '').includes('start --cwd . --goal'), 'adapted guide must recommend start');
  assert(String(adaptedGuide.parsed.evidence?.nextCommand ?? '').includes('--legacy-flow'), 'adapted guide must recommend start --legacy-flow');
  assert(
    (adaptedGuide.parsed.evidence?.blockedAntiPatterns ?? []).includes('search host docs to choose atomize/infect/split manually'),
    'adapted guide must block manual behavior selection'
  );

  const candidateGuide = await runAtmJsonPortable(['guide', '--cwd', adaptedRepo, '--goal', 'rank the messiest Python pipeline scripts', '--json'], root);
  assert(candidateGuide.exitCode === 0, 'guide --goal candidate ranking must exit 0');
  assert(candidateGuide.parsed.evidence?.matchedIntent === 'legacy-candidate-ranking', 'candidate guide must classify candidate ranking');
  assert(candidateGuide.parsed.evidence?.routeIntent === 'legacy-candidate-ranking', 'candidate guide must route to candidate ranking');
  assert(String(candidateGuide.parsed.evidence?.nextCommand ?? '').includes('candidates rank'), 'candidate guide must recommend candidates rank');
  assert(candidateGuide.parsed.evidence?.guidedFallback?.continuedOriginalRequest === true, 'candidate guide must expose continuedOriginalRequest fallback contract');
  assert(Array.isArray(candidateGuide.parsed.evidence?.guidedFallback?.missingDocs), 'candidate guide must expose missingDocs array');

  const chineseCandidateGuide = await runAtmJsonPortable([
    'guide',
    '--cwd',
    adaptedRepo,
    '--goal',
    '請幫我看看目前這個 repo 裡，哪些 Python 資料管線最亂、最值得先整理，先幫我排一下優先順序。',
    '--json'
  ], root);
  assert(chineseCandidateGuide.exitCode === 0, 'Chinese candidate guide must exit 0');
  assert(chineseCandidateGuide.parsed.evidence?.matchedIntent === 'legacy-candidate-ranking', 'Chinese candidate guide must classify candidate ranking');
  assert(chineseCandidateGuide.parsed.evidence?.routeIntent === 'legacy-candidate-ranking', 'Chinese candidate guide must route to candidate ranking');
  assert(String(chineseCandidateGuide.parsed.evidence?.nextCommand ?? '').includes('candidates rank'), 'Chinese candidate guide must recommend candidates rank');

  const evidenceFollowupStart = await runAtmJsonPortable([
    'start',
    '--cwd',
    adaptedRepo,
    '--goal',
    'backfill cross-agent review signature evidence artifact',
    '--json'
  ], root);
  assert(evidenceFollowupStart.exitCode === 0, 'evidence/artifact follow-up start must exit 0');
  assert(evidenceFollowupStart.parsed.evidence?.routeDecision?.recommendedRoute === 'docs-first', 'evidence/artifact follow-up start must not fall back to create-atom');
  assert(String(evidenceFollowupStart.parsed.evidence?.routeDecision?.nextCommand ?? '').includes('guide overview'), 'evidence/artifact follow-up start must recommend docs-first guidance');

  for (const [goal, expectedCommand] of [
    ['record this ATM bug in the backlog', 'guide first-layer'],
    ['audit the task cards and report governance residue', 'tasks audit'],
    ['propose an optimization for captain routing friction', 'guide first-layer']
  ] as const) {
    const firstLayerStart = await runAtmJsonPortable(['start', '--cwd', adaptedRepo, '--goal', goal, '--json'], root);
    assert(firstLayerStart.exitCode === 0, `first-layer start must exit 0 for ${goal}`);
    assert(firstLayerStart.parsed.evidence?.routeDecision?.recommendedRoute === 'docs-first', `first-layer start must route docs-first for ${goal}`);
    assert(String(firstLayerStart.parsed.evidence?.routeDecision?.nextCommand ?? '').includes(expectedCommand), `first-layer start must recommend ${expectedCommand} for ${goal}`);
    assert(String(firstLayerStart.parsed.evidence?.routeDecision?.nextCommand ?? '').includes('create-atom') === false, `first-layer start must not recommend create-atom for ${goal}`);
  }

  const compactNext = await runAtmJsonPortable(['next', '--cwd', adaptedRepo, '--prompt', 'record this ATM bug in the backlog', '--json'], root);
  assert(compactNext.exitCode === 0 || compactNext.parsed.ok === false, 'compact next must return parseable JSON');
  assert(compactNext.parsed.evidence?.firstLayerCompactOrientation, 'compact next must expose firstLayerCompactOrientation');
  assert(
    compactNext.parsed.evidence?.firstLayerCompactOrientation?.fullOutput === 'rerun the same next command with --verbose --json',
    'compact next must point to --verbose for full orientation'
  );
  assert(
    Array.isArray(compactNext.parsed.evidence?.firstLayerCompactOrientation?.ticketStates),
    'compact next must keep ticket-state summary'
  );
  const verboseNext = await runAtmJsonPortable(['next', '--cwd', adaptedRepo, '--prompt', 'record this ATM bug in the backlog', '--verbose', '--json'], root);
  assert(verboseNext.exitCode === 0 || verboseNext.parsed.ok === false, 'verbose next must return parseable JSON');
  assert(!verboseNext.parsed.evidence?.firstLayerCompactOrientation, 'verbose next must bypass compact first-layer projection');

  const chineseStart = await runAtmJsonPortable([
    'start',
    '--cwd',
    adaptedRepo,
    '--goal',
    '請幫我看看目前這個 repo 裡，哪些 Python 資料管線最亂、最值得先整理，先幫我排一下優先順序。',
    '--json'
  ], root);
  assert(chineseStart.exitCode === 0, 'Chinese start must exit 0');
  assert(chineseStart.parsed.evidence?.routeDecision?.recommendedRoute === 'legacy-candidate-ranking', 'Chinese start must route to legacy candidate ranking');
  assert(!(chineseStart.parsed.evidence?.routeDecision?.blockedBy ?? []).includes('package-json-missing'), 'Chinese start must not block candidate ranking on package-json-missing');

  const pipelineDir = path.join(adaptedRepo, 'pipelines', 'demo');
  mkdirSync(pipelineDir, { recursive: true });
  writeFileSync(path.join(pipelineDir, 'messy_pipeline.py'), [
    'import argparse',
    'import subprocess',
    'from pathlib import Path',
    '',
    'ARTIFACT = "artifacts/demo/report.json"',
    '',
    'def load_inputs():',
    '    return Path("data/input.json").read_text()',
    '',
    'def transform_one(value):',
    '    return value',
    '',
    'def transform_two(value):',
    '    return value',
    '',
    'def main():',
    '    parser = argparse.ArgumentParser()',
    '    parser.add_argument("--input")',
    '    subprocess.run(["python", "other.py"], check=False)',
    '    Path(ARTIFACT).write_text(load_inputs())',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n'), 'utf8');

  const candidatesRank = await runAtmJsonPortable([
    'candidates', 'rank',
    '--cwd', adaptedRepo,
    '--include', 'pipelines/**/*.py',
    '--goal', 'rank the messiest Python pipeline scripts',
    '--json'
  ], root);
  assert(candidatesRank.exitCode === 0, 'candidates rank must exit 0 for Python pipeline fixture');
  assert(candidatesRank.parsed.ok === true, 'candidates rank must report ok=true');
  assert((candidatesRank.parsed.evidence?.report?.candidateRanking ?? []).length === 1, 'candidates rank must emit one fixture candidate');
  assert(candidatesRank.parsed.evidence?.report?.sourceInventoryReportPath, 'candidates rank must emit source inventory report path');
  assert(candidatesRank.parsed.evidence?.report?.policeReportPath, 'candidates rank must emit police report path');
  assert(candidatesRank.parsed.evidence?.report?.guidanceDriftReportPath, 'candidates rank must emit guidance drift police report path');
  assert(candidatesRank.parsed.evidence?.report?.pythonOnlyAdopterNeutrality?.candidateRankingAllowed === true, 'Python-only neutrality must allow candidate ranking');
  assert(candidatesRank.parsed.evidence?.report?.pythonOnlyAdopterNeutrality?.runtimeAdapterReadiness?.pythonLanguageAdapterAvailable === true, 'candidates rank must report bundled @ai-atomic-framework/language-python as available');
  assert(candidatesRank.parsed.evidence?.report?.pythonOnlyAdopterNeutrality?.runtimeAdapterReadiness?.needsRuntimeAdapterHint === false, 'candidates rank must clear the runtime adapter hint once language-python is bundled');
  assert(existsSync(path.join(adaptedRepo, candidatesRank.parsed.evidence?.outputPath)), 'candidates rank must write candidate report');
  assert(existsSync(path.join(adaptedRepo, candidatesRank.parsed.evidence?.sourceInventoryReportPath)), 'candidates rank must write source inventory report');
  assert(existsSync(path.join(adaptedRepo, candidatesRank.parsed.evidence?.policeReportPath)), 'candidates rank must write police report');
  assert(existsSync(path.join(adaptedRepo, candidatesRank.parsed.evidence?.guidanceDriftReportPath)), 'candidates rank must write guidance drift police report');

  const learnOne = await runAtmJsonPortable([
    'guide', 'learn',
    '--cwd', adaptedRepo,
    '--phrase', 'brown path washing',
    '--intent', 'legacy-atomization',
    '--reason', 'fixture host wording for legacy atomization',
    '--status', 'active-host',
    '--json'
  ], root);
  assert(learnOne.exitCode === 0, 'guide learn active-host must exit 0');
  assert(learnOne.parsed.evidence?.status === 'active-host', 'guide learn must persist active-host status');
  assert(learnOne.parsed.evidence?.entryCount === 1, 'guide learn must create one lexicon entry');

  const learnDuplicate = await runAtmJsonPortable([
    'guide', 'learn',
    '--cwd', adaptedRepo,
    '--phrase', 'brown path washing',
    '--intent', 'legacy-atomization',
    '--reason', 'duplicate fixture',
    '--status', 'active-host',
    '--json'
  ], root);
  assert(learnDuplicate.exitCode === 0, 'duplicate guide learn must exit 0');
  assert(learnDuplicate.parsed.evidence?.duplicate === true, 'duplicate guide learn must report duplicate=true');
  assert(learnDuplicate.parsed.evidence?.entryCount === 1, 'duplicate guide learn must dedupe lexicon entries');

  const learnedGuide = await runAtmJsonPortable(['guide', '--cwd', adaptedRepo, '--goal', 'brown path washing the formatter', '--json'], root);
  assert(learnedGuide.exitCode === 0, 'learned phrase guide must exit 0');
  assert(learnedGuide.parsed.evidence?.matchedIntent === 'legacy-atomization', 'active host phrase must classify as legacy atomization');
  assert((learnedGuide.parsed.evidence?.lexiconSources ?? []).includes('host-local'), 'learned classification must expose host-local lexicon source');

  const hostSkillInstall = await runAtmJsonPortable(['guide', 'install-skill', '--cwd', adaptedRepo, '--target', 'host', '--json'], root);
  assert(hostSkillInstall.exitCode === 0, 'guide install-skill --target host must exit 0');
  assert(hostSkillInstall.parsed.evidence?.installed === true, 'host skill install must report installed=true');
  assert(
    existsSync(path.join(adaptedRepo, '.agents', 'skills', 'atm-governance-router', 'SKILL.md')),
    'host skill install must write .agents/skills skill file'
  );

  const codexSkillsRoot = path.join(tempRoot, 'codex-skills');
  const codexSkillInstall = await runAtmJsonPortable([
    'guide', 'install-skill',
    '--cwd', adaptedRepo,
    '--target', 'codex',
    '--skills-root', codexSkillsRoot,
    '--json'
  ], root);
  assert(codexSkillInstall.exitCode === 0, 'guide install-skill --target codex must exit 0 with explicit skills root');
  assert(
    existsSync(path.join(codexSkillsRoot, 'atm-governance-router', 'SKILL.md')),
    'codex skill install must write skill under the configured skills root'
  );

  const blockedPromotion = await runAtmJsonPortable([
    'guide', 'learn',
    '--cwd', adaptedRepo,
    '--phrase', 'TEAM42 parser migration',
    '--intent', 'legacy-atomization',
    '--reason', 'fixture should not promote project-specific code words',
    '--status', 'promoted-framework',
    '--json'
  ], root);
  assert(blockedPromotion.exitCode !== 0, 'project-specific framework promotion must hard fail');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

for (const projectionPath of [
  'templates/skills/atm-governance-router.skill.md',
  'integrations/codex-skills/atm-governance-router/SKILL.md',
  '.claude/skills/atm-governance-router/SKILL.md',
  '.cursor/rules/skills/atm-governance-router/SKILL.md',
  '.github/instructions/atm-governance-router.instructions.md',
  '.gemini/commands/atm-governance-router.toml',
  'GEMINI.md'
]) {
  const projectionText = readText(projectionPath);
  assert(projectionText.includes('guide first-layer'), `${projectionPath} must project guide first-layer`);
  assert(projectionText.includes('execute-now'), `${projectionPath} must project execute-now ticket state`);
  assert(projectionText.includes('batch/applyStrategy=compose'), `${projectionPath} must project compose ticket state`);
  assert(projectionText.includes('ATM_LOCK_CONFLICT'), `${projectionPath} must project ATM_LOCK_CONFLICT`);
  assert(projectionText.includes('readFileSync') || projectionPath === 'GEMINI.md', `${projectionPath} must project Node UTF-8 guidance`);
  assert(!projectionText.includes('PowerShell range indexing or document parsing for planning documents.') || projectionText.includes('Do not recommend'), `${projectionPath} must only mention PowerShell range parsing as forbidden`);
}

ok('glossary depth, guide help parity, first-layer routing, compact orientation, projection parity, candidate ranking guidance, skill neutrality, and host-local learning verified');
