import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { atmFirstCommand, charterInvariantsPlaceholder } from '../../packages/integrations-core/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const adapterPlans = [
  { agentLabel: 'Claude Code', adapterId: 'claude-code' },
  { agentLabel: 'Cursor', adapterId: 'cursor' },
  { agentLabel: 'GitHub Copilot Agent', adapterId: 'copilot' }
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[example:agent-onboarding-flow] ${message}`);
  }
}

function runAtm(args: readonly string[], cwd = root, options: { readonly allowNonZero?: boolean } = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(payload);
  } catch (error: any) {
    throw new Error(`[example:agent-onboarding-flow] ATM output is not JSON for ${args.join(' ')}: ${payload || error.message}`);
  }
  if (options.allowNonZero !== true) {
    assert((result.status ?? 1) === 0, `ATM command failed: ${args.join(' ')}`);
  }
  return parsed;
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function detectCharterConflict() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = readJson('schemas/charter/charter-invariants.schema.json');
  const conflictFixture = readJson('fixtures/charter/charter-conflict.json');
  const validate = ajv.compile(schema);
  const valid = validate(conflictFixture);
  return {
    detected: valid === false,
    errorKeywords: (validate.errors || []).map((error) => error.keyword)
  };
}

function readInstalledManifest(hostRoot: string, adapterId: string) {
  const manifestPath = path.join(hostRoot, '.atm', 'integrations', `${adapterId}.manifest.json`);
  assert(existsSync(manifestPath), `${adapterId} install manifest is missing`);
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function readInstalledFile(hostRoot: string, filePath: string) {
  return readFileSync(path.join(hostRoot, filePath), 'utf8');
}

const startedAt = Date.now();
const tempRoot = mkdtempSync(path.join(tmpdir(), 'atm-agent-onboarding-'));
const hostRoot = path.join(tempRoot, 'host');
mkdirSync(hostRoot, { recursive: true });

try {
  const adapterReports = adapterPlans.map((plan) => {
    const init = runAtm(['init', '--cwd', hostRoot, '--integration', plan.adapterId, '--json']);
    assert(init.ok === true, `${plan.adapterId} init --integration must succeed`);
    assert(init.evidence?.integrationInstall?.adapter?.id === plan.adapterId, `${plan.adapterId} init evidence must preserve adapter id`);

    const verify = runAtm(['integration', 'verify', plan.adapterId, '--cwd', hostRoot, '--json']);
    assert(verify.ok === true, `${plan.adapterId} integration verify must succeed`);

    const atmChart = runAtm(['atm-chart', 'render', '--cwd', hostRoot, '--json']);
    assert(atmChart.ok === true, `${plan.adapterId} atm-chart render must succeed`);

    const welcome = runAtm(['welcome', '--cwd', hostRoot, '--json']);
    assert(welcome.ok === true, `${plan.adapterId} welcome must succeed`);
    assert(welcome.evidence?.welcomeLineage?.welcomeCount >= 1, `${plan.adapterId} welcome must record lineage`);

    const manifest = readInstalledManifest(hostRoot, plan.adapterId);
    assert(manifest.adapterId === plan.adapterId, `${plan.adapterId} manifest adapterId mismatch`);
    assert(Array.isArray(manifest.files) && manifest.files.length > 0, `${plan.adapterId} manifest must record installed files`);

    const installedContents = manifest.files.map((fileRecord: any) => readInstalledFile(hostRoot, fileRecord.path));
    assert(installedContents.some((content: string) => content.includes(atmFirstCommand)), `${plan.adapterId} installed files must include the first command`);
    assert(installedContents.some((content: string) => content.includes(charterInvariantsPlaceholder)), `${plan.adapterId} installed files must include charter invariants placeholder`);

    const firstCommand = runAtm(['next', '--cwd', hostRoot, '--json'], root, { allowNonZero: true });
    assert(firstCommand.command === 'next', `${plan.adapterId} first command route must return a next report`);
    assert(firstCommand.evidence?.nextAction?.status !== 'needs-onboarding-refresh', `${plan.adapterId} first command must not be blocked by onboarding freshness`);

    return {
      agentLabel: plan.agentLabel,
      adapterId: plan.adapterId,
      manifestPath: `.atm/integrations/${plan.adapterId}.manifest.json`,
      installedFileCount: manifest.files.length,
      verified: verify.ok === true,
      firstCommand: atmFirstCommand,
      welcomeRecorded: true,
      charterInjected: true
    };
  });

  const charterConflict = detectCharterConflict();
  assert(charterConflict.detected === true, 'charter conflict fixture must be detected');

  const durationMs = Date.now() - startedAt;
  assert(durationMs < 300000, `example must finish within five minutes; got ${durationMs}ms`);

  const report = {
    ok: true,
    example: 'agent-onboarding-flow',
    durationMs,
    firstCommand: atmFirstCommand,
    adapters: adapterReports,
    charterConflict
  };

  console.log(JSON.stringify(report, null, 2));
  console.log('[example:agent-onboarding-flow] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}