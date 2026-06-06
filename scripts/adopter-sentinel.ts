import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') ?? 'validate';
const fixture = readArg('--fixture') ?? 'default';

interface SentinelStep {
  readonly name: string;
  readonly exitCode: number;
  readonly ok: boolean;
}

interface SentinelProfileResult {
  readonly profile: string;
  readonly ok: boolean;
  readonly workspace: string;
  readonly steps: readonly SentinelStep[];
}

const profiles = ['vscode', 'cursor', 'claude-code'];

if (fixture === 'broken') {
  const broken = runSentinelProfile('broken-fixture', { breakBeforeWelcome: true });
  emitSummary([broken]);
  process.exitCode = broken.ok ? 1 : 2;
  process.exit();
}

const results = profiles.map((profile) => runSentinelProfile(profile, { breakBeforeWelcome: false }));
const brokenProbe = runSentinelProfile('broken-fixture-probe', { breakBeforeWelcome: true });
if (brokenProbe.ok) {
  results.push({ ...brokenProbe, ok: false, steps: [...brokenProbe.steps, { name: 'broken-fixture-detection', exitCode: 1, ok: false }] });
}

emitSummary(results);
if (results.some((entry) => !entry.ok) || brokenProbe.ok) {
  process.exitCode = 1;
} else {
  console.log(`[adopter-sentinel:${mode}] ok — ${profiles.length} adopter host smoke profile(s) passed and broken fixture failed as expected`);
}

function runSentinelProfile(profile: string, options: { breakBeforeWelcome: boolean }): SentinelProfileResult {
  const workspace = mkdtempSync(path.join(os.tmpdir(), `atm-sentinel-${profile}-`));
  mkdirSync(workspace, { recursive: true });
  const steps: SentinelStep[] = [];
  if (!options.breakBeforeWelcome) {
    steps.push(runAtmStep('bootstrap', ['bootstrap', '--cwd', workspace, '--json']));
    steps.push(runAtmStep('atm-chart render', ['atm-chart', 'render', '--cwd', workspace, '--json']));
  }
  steps.push(runAtmStep('welcome dry-run', ['welcome', '--cwd', workspace, '--dry-run', '--json']));
  steps.push(runAtmStep('telemetry status', ['telemetry', '--cwd', workspace, '--status', '--json']));
  const ok = steps.every((step) => step.ok);
  return { profile, ok, workspace, steps };
}

function runAtmStep(name: string, args: readonly string[]): SentinelStep {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  return {
    name,
    exitCode: result.status ?? 1,
    ok: (result.status ?? 1) === 0 && isJson(result.stdout || result.stderr)
  };
}

function isJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function emitSummary(results: readonly SentinelProfileResult[]) {
  const summary = {
    schemaVersion: 'atm.adopterSentinelSummary.v0.1',
    mode,
    ok: results.every((entry) => entry.ok),
    profiles: results.map((entry) => ({
      profile: entry.profile,
      ok: entry.ok,
      workspaceCreated: existsSync(entry.workspace),
      steps: entry.steps
    }))
  };
  console.log(JSON.stringify(summary, null, 2));
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}
