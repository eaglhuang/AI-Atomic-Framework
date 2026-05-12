import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { supportedAgentProfiles } from '../packages/cli/src/commands/agent-confidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message) {
  console.error(`[multi-agent-confidence:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runAtm(args, cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
    parsed = {};
  }
  return {
    exitCode: result.status ?? 0,
    parsed
  };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

for (const relativePath of [
  'docs/multi-agent-compatibility-matrix.md',
  'docs/multi-agent-results.md',
  'tests/agents/results/latest-batch.json',
  'tests/agents/openai-assistant.test.js'
]) {
  assert(existsSync(path.join(root, relativePath)), `missing multi-agent confidence file: ${relativePath}`);
}

const verifyAgentsMd = runAtm(['verify', '--agents-md'], root);
assert(verifyAgentsMd.exitCode === 0, 'verify --agents-md must exit 0 in framework root');
assert(verifyAgentsMd.parsed.ok === true, 'verify --agents-md must report ok=true in framework root');

const resultsDoc = readFileSync(path.join(root, 'docs/multi-agent-results.md'), 'utf8');
const matrixDoc = readFileSync(path.join(root, 'docs/multi-agent-compatibility-matrix.md'), 'utf8');
const batch = readJson('tests/agents/results/latest-batch.json');
assert(Array.isArray(batch.reports) && batch.reports.length === supportedAgentProfiles.length, 'latest-batch.json must cover all supported agent profiles');

for (const profile of supportedAgentProfiles) {
  const result = runAtm(['self-host-alpha', '--verify', '--agent', profile.id], root);
  assert(result.exitCode === 0, `self-host-alpha --verify --agent ${profile.id} must exit 0`);
  assert(result.parsed.ok === true, `self-host-alpha --verify --agent ${profile.id} must report ok=true`);
  assert(result.parsed.evidence.confidence?.agentId === profile.id, `confidence report must preserve agentId=${profile.id}`);
  assert(result.parsed.evidence.confidence?.blockingRelease === false, `${profile.id} confidence report must remain advisory`);

  const reportEntry = batch.reports.find((entry) => entry.agentId === profile.id);
  assert(Boolean(reportEntry), `latest-batch.json missing ${profile.id}`);
  assert(existsSync(path.join(root, reportEntry.reportPath)), `missing report file for ${profile.id}: ${reportEntry.reportPath}`);

  const reportDocument = readJson(reportEntry.reportPath);
  assert(reportDocument.agentId === profile.id, `${profile.id} report file must preserve agentId`);
  assert(reportDocument.result?.ok === true, `${profile.id} report file must preserve ok=true`);
  assert(reportDocument.result?.evidence?.confidence?.advisory === true, `${profile.id} report file must mark advisory=true`);

  assert(resultsDoc.includes(profile.label), `multi-agent results doc must mention ${profile.label}`);
  assert(matrixDoc.includes(profile.label), `multi-agent compatibility matrix must mention ${profile.label}`);
}

const openAiAssistant = runAtm(['self-host-alpha', '--verify', '--agent', 'openai-assistants-api'], root);
assert(openAiAssistant.exitCode === 0, 'openai-assistants-api confidence probe must exit 0');
assert(openAiAssistant.parsed.ok === true, 'openai-assistants-api confidence probe must report ok=true');

const openAiAssistantScript = spawnSync(process.execPath, [path.join(root, 'tests/agents/openai-assistant.test.js')], {
  cwd: root,
  encoding: 'utf8'
});
const openAiAssistantPayload = (openAiAssistantScript.stdout || openAiAssistantScript.stderr || '').trim();
assert((openAiAssistantScript.status ?? 1) === 0, 'tests/agents/openai-assistant.test.js must exit 0');
assert(openAiAssistantPayload.includes('openai-assistants-api'), 'tests/agents/openai-assistant.test.js must emit the openai-assistants-api report payload');

if (!process.exitCode) {
  console.log(`[multi-agent-confidence:${mode}] ok (${supportedAgentProfiles.length} advisory agent profiles verified)`);
}
