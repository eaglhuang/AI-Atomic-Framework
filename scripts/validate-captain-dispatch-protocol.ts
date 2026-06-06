import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const skillFiles = [
  '.agents/skills/atm-dispatch/SKILL.md',
  'integrations/codex-skills/atm-dispatch/SKILL.md'
];

const entryGateFiles = [
  'README.md',
  'AGENTS.md',
  'docs/AGENT_PACK_ONBOARDING.md',
  'templates/root-drop/AGENTS.md',
  'templates/skills/atm-governance-router.skill.md',
  'integrations/codex-skills/atm-governance-router/SKILL.md'
];

const requiredPhrases = [
  'Skill used: atm-dispatch',
  'Delegation mode',
  'Terminology boundary:',
  'Internal sidecar is the default',
  'External dispatch is opt-in',
  'External write is forbidden',
  '審稿 / planning-only / checklist',
  'Captain must apply atm-dispatch before any dispatch, sidecar delegation, review, condition review, or closeout'
];

const requiredEntryGatePhrases = [
  'Captain/dispatch entry gate',
  'ai-role-router',
  'atm-dispatch',
  'Skill used: atm-dispatch',
  'Delegation mode',
  'Internal sidecar is the default',
  'External dispatch is opt-in',
  'external write is forbidden'
];

const forbiddenPhrases = [
  '預設外包優先',
  '預設外部 AI',
  '外部 AI 可轉貼 OR',
  '啟用後你是 AAF',
  'AI-Atomic-Framework (AAF)',
  '### AAF',
  'AAF-only',
  'AAF commit',
  'AAF git log'
];

function fail(message: string) {
  console.error(`[captain-dispatch-protocol:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath: string): unknown {
  return JSON.parse(readText(relativePath));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').toLowerCase();
}

function hasPhrase(content: string, phrase: string): boolean {
  return normalizeText(content).includes(normalizeText(phrase));
}

const skillContents: string[] = [];

for (const relativePath of skillFiles) {
  const absolutePath = path.join(root, relativePath);
  check(existsSync(absolutePath), `missing atm-dispatch skill file: ${relativePath}`);
  if (!existsSync(absolutePath)) {
    continue;
  }

  const content = readText(relativePath);
  skillContents.push(content);
  for (const phrase of requiredPhrases) {
    check(hasPhrase(content, phrase), `${relativePath} missing required dispatch protocol phrase: ${phrase}`);
  }
  for (const phrase of forbiddenPhrases) {
    check(!content.includes(phrase), `${relativePath} must not contain forbidden dispatch protocol phrase: ${phrase}`);
  }
}

for (const relativePath of entryGateFiles) {
  const absolutePath = path.join(root, relativePath);
  check(existsSync(absolutePath), `missing Captain/dispatch entry gate file: ${relativePath}`);
  if (!existsSync(absolutePath)) {
    continue;
  }

  const content = readText(relativePath);
  for (const phrase of requiredEntryGatePhrases) {
    check(hasPhrase(content, phrase), `${relativePath} missing Captain/dispatch entry gate phrase: ${phrase}`);
  }
}

if (skillContents.length === skillFiles.length) {
  check(skillContents[0] === skillContents[1], 'atm-dispatch local skill and Codex integration copy must stay byte-identical');
}

const packageJson = readJson('package.json') as {
  scripts?: Record<string, string>;
};
check(
  packageJson.scripts?.['validate:captain-dispatch-protocol'] === 'node --strip-types scripts/validate-captain-dispatch-protocol.ts --mode validate',
  'package.json must expose validate:captain-dispatch-protocol'
);

const validatorsConfig = readJson('scripts/validators.config.json') as {
  profiles?: Record<string, { validators?: string[] }>;
  validators?: Array<{ name?: string; entry?: string; tags?: string[]; slow?: boolean }>;
};
const validator = validatorsConfig.validators?.find((entry) => entry.name === 'validate-captain-dispatch-protocol');
check(Boolean(validator), 'validators.config.json must register validate-captain-dispatch-protocol');
check(validator?.entry === 'scripts/validate-captain-dispatch-protocol.ts', 'validate-captain-dispatch-protocol entry path mismatch');
check(validator?.slow === false, 'validate-captain-dispatch-protocol must be a fast validator');
check(
  validatorsConfig.profiles?.quick?.validators?.includes('validate-captain-dispatch-protocol') === true,
  'quick profile must include validate-captain-dispatch-protocol'
);
check(
  validatorsConfig.profiles?.standard?.validators?.includes('validate-captain-dispatch-protocol') === true,
  'standard profile must include validate-captain-dispatch-protocol'
);

if (!process.exitCode) {
  console.log(`[captain-dispatch-protocol:${mode}] ok (${skillFiles.length} skill files)`);
}
