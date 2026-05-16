import { createValidator } from './lib/validator-harness.ts';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace } from './temp-root.ts';
import { classifyGuidanceIntent } from '../packages/core/src/guidance/index.ts';

const validator = createValidator('guide');
const { assert, requireFile, runAtmJson, ok, readText, root } = validator;

for (const relativePath of [
  'atm.mjs',
  'packages/cli/src/commands/guide.ts',
  'packages/core/src/guidance/intent-classifier.ts',
  'packages/cli/src/commands/glossary-data.ts',
  'packages/cli/src/commands/command-specs.ts',
  'integrations/codex-skills/atm-legacy-atomization-guidance/SKILL.md'
]) {
  requireFile(relativePath, `missing guide dependency: ${relativePath}`);
}

const glossary = runAtmJson(['guide', 'glossary', '--json']);
assert(glossary.exitCode === 0, 'guide glossary must exit 0');
assert(glossary.parsed.ok === true, 'guide glossary must report ok=true');
assert(Array.isArray(glossary.parsed.evidence?.terms), 'guide glossary must return evidence.terms array');
assert((glossary.parsed.evidence?.terms as unknown[]).length >= 10, 'guide glossary must expose at least 10 terms');

const guideHelp = runAtmJson(['guide', 'help', 'next', '--json']);
assert(guideHelp.exitCode === 0, 'guide help next must exit 0');
assert(guideHelp.parsed.ok === true, 'guide help next must report ok=true');
assert(guideHelp.parsed.evidence?.usage?.command === 'next', 'guide help next must target next command');

const commandHelp = runAtmJson(['next', '--help', '--json']);
assert(commandHelp.exitCode === 0, 'next --help must exit 0');
assert(commandHelp.parsed.ok === true, 'next --help must report ok=true');
assert(
  JSON.stringify(guideHelp.parsed.evidence?.usage ?? null) === JSON.stringify(commandHelp.parsed.evidence?.usage ?? null),
  'guide help next usage must equal next --help usage'
);

for (const goal of [
  '把 legacy parser 原子化',
  '感染既有 atom 到舊 helper',
  '轉化舊流程',
  'split old hotspot helper',
  'migrate inherited formatter into atom',
  'refactor monolith function safely'
]) {
  const classification = classifyGuidanceIntent(goal, { adapterStatus: 'available' });
  assert(classification.matchedIntent === 'legacy-atomization', `classifier must catch legacy atomization intent: ${goal}`);
  assert(classification.blockedAntiPatterns.includes('direct trunk rewrite'), `classifier must block trunk rewrite for: ${goal}`);
}

for (const [goal, expectedIntent] of [
  ['整理 README 文件', 'docs-spec'],
  ['create new atom for a greenfield capability', 'atom-create'],
  ['clean up package whitespace', 'unknown']
] as const) {
  const classification = classifyGuidanceIntent(goal, { adapterStatus: 'available' });
  assert(classification.matchedIntent === expectedIntent, `classifier must route "${goal}" to ${expectedIntent}`);
}

const skill = readText('integrations/codex-skills/atm-legacy-atomization-guidance/SKILL.md');
for (const requiredText of [
  'legacy',
  'atomize',
  'infect',
  'transform',
  'split',
  '原子化',
  '感染',
  '轉化',
  '分裂',
  'atm guide --goal',
  'atm start --legacy-flow',
  'atm next',
  'dry-run proposal',
  'human review'
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
  const blankGuide = runAtmJson(['guide', '--cwd', blankRepo, '--goal', '把 legacy parser 原子化', '--json'], root);
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
  const adaptedGuide = runAtmJson(['guide', '--cwd', adaptedRepo, '--goal', '感染既有 atom 到舊 helper', '--json'], root);
  assert(adaptedGuide.exitCode === 0, 'guide --goal must exit 0 in an adapted repo');
  assert(adaptedGuide.parsed.evidence?.matchedIntent === 'legacy-atomization', 'adapted guide must classify legacy atomization');
  assert(adaptedGuide.parsed.evidence?.routeIntent === 'legacy-atomization', 'adapted guide must route to legacy atomization');
  assert(String(adaptedGuide.parsed.evidence?.nextCommand ?? '').includes('start --cwd . --goal'), 'adapted guide must recommend start');
  assert(String(adaptedGuide.parsed.evidence?.nextCommand ?? '').includes('--legacy-flow'), 'adapted guide must recommend start --legacy-flow');
  assert(
    (adaptedGuide.parsed.evidence?.blockedAntiPatterns ?? []).includes('search host docs to choose atomize/infect/split manually'),
    'adapted guide must block manual behavior selection'
  );

  const learnOne = runAtmJson([
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

  const learnDuplicate = runAtmJson([
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

  const learnedGuide = runAtmJson(['guide', '--cwd', adaptedRepo, '--goal', 'brown path washing the formatter', '--json'], root);
  assert(learnedGuide.exitCode === 0, 'learned phrase guide must exit 0');
  assert(learnedGuide.parsed.evidence?.matchedIntent === 'legacy-atomization', 'active host phrase must classify as legacy atomization');
  assert((learnedGuide.parsed.evidence?.lexiconSources ?? []).includes('host-local'), 'learned classification must expose host-local lexicon source');

  const hostSkillInstall = runAtmJson(['guide', 'install-skill', '--cwd', adaptedRepo, '--target', 'host', '--json'], root);
  assert(hostSkillInstall.exitCode === 0, 'guide install-skill --target host must exit 0');
  assert(hostSkillInstall.parsed.evidence?.installed === true, 'host skill install must report installed=true');
  assert(
    existsSync(path.join(adaptedRepo, '.agents', 'skills', 'atm-legacy-atomization-guidance', 'SKILL.md')),
    'host skill install must write .agents/skills skill file'
  );

  const codexSkillsRoot = path.join(tempRoot, 'codex-skills');
  const codexSkillInstall = runAtmJson([
    'guide', 'install-skill',
    '--cwd', adaptedRepo,
    '--target', 'codex',
    '--skills-root', codexSkillsRoot,
    '--json'
  ], root);
  assert(codexSkillInstall.exitCode === 0, 'guide install-skill --target codex must exit 0 with explicit skills root');
  assert(
    existsSync(path.join(codexSkillsRoot, 'atm-legacy-atomization-guidance', 'SKILL.md')),
    'codex skill install must write skill under the configured skills root'
  );

  const blockedPromotion = runAtmJson([
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

ok('glossary depth, guide help parity, free-text intent routing, skill neutrality, and host-local learning verified');
