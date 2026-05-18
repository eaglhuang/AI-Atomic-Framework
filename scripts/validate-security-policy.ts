import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const failures: Array<{ code: string; message: string }> = [];

function fail(code: string, message: string) {
  failures.push({ code, message });
  console.error(`[security-policy:${mode}] FAIL code=${code} message=${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, code: string, message: string) {
  if (!condition) fail(code, message);
}

function readText(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function fileExists(relativePath: string) {
  return existsSync(path.join(root, relativePath));
}

const requiredFiles = [
  'SECURITY.md',
  'docs/SECURITY.md',
  '.github/dependabot.yml',
  '.github/workflows/dependency-scan.yml',
  'scripts/validate-security-policy.ts',
  'scripts/validators.config.json'
];

for (const file of requiredFiles) {
  assert(fileExists(file), 'SECURITY_FILE_MISSING', `${file} must exist`);
}

const securityPolicy = fileExists('SECURITY.md') ? readText('SECURITY.md') : '';
const securityOps = fileExists('docs/SECURITY.md') ? readText('docs/SECURITY.md') : '';
const dependabot = fileExists('.github/dependabot.yml') ? readText('.github/dependabot.yml') : '';
const workflow = fileExists('.github/workflows/dependency-scan.yml') ? readText('.github/workflows/dependency-scan.yml') : '';
const validatorsConfig = fileExists('scripts/validators.config.json')
  ? JSON.parse(readText('scripts/validators.config.json'))
  : { profiles: {}, validators: [] };

validateRootSecurityPolicy(securityPolicy);
validateSecurityOps(securityOps);
validateDependabot(dependabot);
validateDependencyWorkflow(workflow);
validateStandardProfile(validatorsConfig);

if (!process.exitCode) {
  console.log(`[security-policy:${mode}] ok — SECURITY.md, advisory SOP, Dependabot, dependency scan, and standard profile verified`);
}

function validateRootSecurityPolicy(input: string) {
  assert(/^# Security Policy/m.test(input), 'SECURITY_ROOT_TITLE_MISSING', 'SECURITY.md must start with a Security Policy heading');
  for (const heading of [
    '## Supported Scope',
    '## Reporting a Vulnerability',
    '## Encryption',
    '## Response SLA',
    '## Advisory Branch SOP',
    '## Dependency Scanning'
  ]) {
    assert(input.includes(heading), 'SECURITY_ROOT_SECTION_MISSING', `SECURITY.md must include ${heading}`);
  }

  assert(/GitHub Private Vulnerability Reporting/i.test(input), 'SECURITY_PRIVATE_REPORTING_MISSING', 'SECURITY.md must name GitHub Private Vulnerability Reporting');
  assert(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(input), 'SECURITY_EMAIL_MISSING', 'SECURITY.md must include a backup email disclosure channel');
  assert(/72\s*(hours|h)/i.test(input), 'SECURITY_SLA_ACK_MISSING', 'SECURITY.md must define acknowledgement within 72 hours');
  assert(/Critical[\s\S]*7 days/i.test(input), 'SECURITY_CRITICAL_TARGET_MISSING', 'SECURITY.md must define a Critical fix target');
  assert(/High[\s\S]*14 days/i.test(input), 'SECURITY_HIGH_TARGET_MISSING', 'SECURITY.md must define a High fix target');
  assert(/Medium[\s\S]*30 days/i.test(input), 'SECURITY_MEDIUM_TARGET_MISSING', 'SECURITY.md must define a Medium fix target');
  assert(/Low[\s\S]*(minor|maintenance)/i.test(input), 'SECURITY_LOW_TARGET_MISSING', 'SECURITY.md must define a Low fix target');
  assert(/PGP fingerprint:\s*`?[0-9A-F]{4}(\s[0-9A-F]{4}){9}`?/i.test(input), 'SECURITY_PGP_FINGERPRINT_MISSING', 'SECURITY.md must include a 40-hex PGP fingerprint');
  assert(/security\/<advisory-id>/i.test(input), 'SECURITY_ADVISORY_BRANCH_MISSING', 'SECURITY.md must document the security/<advisory-id> branch pattern');
  assert(/coordinated disclosure/i.test(input), 'SECURITY_DISCLOSURE_TIMELINE_MISSING', 'SECURITY.md must document coordinated disclosure');
}

function validateSecurityOps(input: string) {
  assert(/^# Security Operations/m.test(input), 'SECURITY_OPS_TITLE_MISSING', 'docs/SECURITY.md must include a Security Operations heading');
  assert(/## Internal Review Checklist/.test(input), 'SECURITY_OPS_CHECKLIST_MISSING', 'docs/SECURITY.md must include an internal review checklist');
  assert(/security\/<advisory-id>/i.test(input), 'SECURITY_OPS_BRANCH_MISSING', 'docs/SECURITY.md must include the advisory branch runbook');
  assert(/Disclosure Record Template/.test(input), 'SECURITY_OPS_TEMPLATE_MISSING', 'docs/SECURITY.md must include a disclosure record template');
}

function validateDependabot(input: string) {
  assert(/version:\s*2/.test(input), 'SECURITY_DEPENDABOT_VERSION_MISSING', '.github/dependabot.yml must use version: 2');
  assert(/package-ecosystem:\s*npm/.test(input), 'SECURITY_DEPENDABOT_NPM_MISSING', '.github/dependabot.yml must enable npm updates');
  assert(/directory:\s*\/?\s*$/m.test(input), 'SECURITY_DEPENDABOT_ROOT_MISSING', '.github/dependabot.yml must scan the repository root');
  assert(/interval:\s*weekly/.test(input), 'SECURITY_DEPENDABOT_WEEKLY_MISSING', '.github/dependabot.yml must use weekly scheduling');
  assert(/open-pull-requests-limit:\s*[1-9]/.test(input), 'SECURITY_DEPENDABOT_AUTO_PR_MISSING', '.github/dependabot.yml must allow Dependabot pull requests');
}

function validateDependencyWorkflow(input: string) {
  assert(/name:\s*Dependency scan/.test(input), 'SECURITY_WORKFLOW_NAME_MISSING', 'dependency-scan workflow must be named');
  assert(/npm ci/.test(input), 'SECURITY_WORKFLOW_NPM_CI_MISSING', 'dependency-scan workflow must install dependencies with npm ci');
  assert(/npm audit --omit=dev --audit-level=high/.test(input), 'SECURITY_WORKFLOW_NPM_AUDIT_MISSING', 'dependency-scan workflow must run npm audit --omit=dev --audit-level=high');
  assert(/osv-scanner/i.test(input), 'SECURITY_WORKFLOW_OSV_MISSING', 'dependency-scan workflow must run osv-scanner');
  assert(/HIGH/.test(input) && /CRITICAL/.test(input), 'SECURITY_WORKFLOW_SEVERITY_MISSING', 'dependency-scan workflow must block HIGH and CRITICAL severity findings');
  assert(/scripts\/validate-security-policy\.ts --mode validate/.test(input), 'SECURITY_WORKFLOW_VALIDATOR_MISSING', 'dependency-scan workflow must run validate-security-policy.ts');
}

function validateStandardProfile(input: any) {
  const standardValidators = input.profiles?.standard?.validators;
  assert(Array.isArray(standardValidators), 'SECURITY_STANDARD_PROFILE_MISSING', 'validators.config.json must define profiles.standard.validators');
  assert(standardValidators?.includes('validate-security-policy'), 'SECURITY_STANDARD_PROFILE_NOT_REGISTERED', 'standard profile must include validate-security-policy');

  const validator = Array.isArray(input.validators)
    ? input.validators.find((entry: any) => entry?.name === 'validate-security-policy')
    : null;
  assert(Boolean(validator), 'SECURITY_VALIDATOR_ENTRY_MISSING', 'validators.config.json must define validate-security-policy entry');
  assert(validator?.entry === 'scripts/validate-security-policy.ts', 'SECURITY_VALIDATOR_ENTRY_INVALID', 'validate-security-policy entry must point at scripts/validate-security-policy.ts');
  assert((validator?.tags ?? []).includes('security'), 'SECURITY_VALIDATOR_TAG_MISSING', 'validate-security-policy entry must include the security tag');
}
