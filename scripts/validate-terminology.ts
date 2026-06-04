import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const terminologyFiles = [
  'README.md',
  'AGENTS.md',
  'docs/AGENT_PACK_ONBOARDING.md',
  'docs/HOST_GOVERNANCE_INTEGRATION.md',
  '.agents/skills/atm-dispatch/SKILL.md',
  'integrations/codex-skills/atm-dispatch/SKILL.md'
];

function fail(message: string) {
  console.error(`[terminology:${mode}] ${message}`);
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

function lineAllowsAafBoundary(line: string): boolean {
  return /do not call ATM [`"]?AAF[`"]?/i.test(line) || line.includes('不得把 ATM 叫成 AAF');
}

for (const relativePath of terminologyFiles) {
  const absolutePath = path.join(root, relativePath);
  check(existsSync(absolutePath), `missing terminology file: ${relativePath}`);
  if (!existsSync(absolutePath)) {
    continue;
  }

  const content = readText(relativePath);
  check(content.includes('Terminology boundary:'), `${relativePath} must declare the terminology boundary`);
  check(
    content.includes('ATM is the product, framework, CLI, and governance workflow')
      || content.includes('ATM 是產品、框架、CLI 與治理工作流'),
    `${relativePath} must define ATM as product/framework/CLI/workflow`
  );
  check(
    content.includes('AI-Atomic-Framework is only this repository name')
      || content.includes('AI-Atomic-Framework 只是 repo 名稱'),
    `${relativePath} must define AI-Atomic-Framework as the repository name only`
  );
  check(
    /do not call ATM [`"]?AAF[`"]?/i.test(content) || content.includes('不得把 ATM 叫成 AAF'),
    `${relativePath} must explicitly forbid calling ATM AAF`
  );
  check(!content.includes('AI-Atomic-Framework (ATM)'), `${relativePath} must not equate the repository name with ATM`);

  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (/\bAAF\b/.test(line) && !lineAllowsAafBoundary(line)) {
      fail(`${relativePath}:${index + 1} uses AAF outside the allowed terminology-boundary sentence`);
    }
  }
}

const packageJson = readJson('package.json') as {
  scripts?: Record<string, string>;
};
check(
  packageJson.scripts?.['validate:terminology'] === 'node --strip-types scripts/validate-terminology.ts --mode validate',
  'package.json must expose validate:terminology'
);

const validatorsConfig = readJson('scripts/validators.config.json') as {
  profiles?: Record<string, { validators?: string[] }>;
  validators?: Array<{ name?: string; entry?: string; tags?: string[]; slow?: boolean }>;
};
const validator = validatorsConfig.validators?.find((entry) => entry.name === 'validate-terminology');
check(Boolean(validator), 'validators.config.json must register validate-terminology');
check(validator?.entry === 'scripts/validate-terminology.ts', 'validate-terminology entry path mismatch');
check(validator?.slow === false, 'validate-terminology must be a fast validator');
check(
  validatorsConfig.profiles?.quick?.validators?.includes('validate-terminology') === true,
  'quick profile must include validate-terminology'
);
check(
  validatorsConfig.profiles?.standard?.validators?.includes('validate-terminology') === true,
  'standard profile must include validate-terminology'
);

if (!process.exitCode) {
  console.log(`[terminology:${mode}] ok (${terminologyFiles.length} files)`);
}
