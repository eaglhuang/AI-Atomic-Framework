import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIntegrationAdapter, primaryEntryPathByAdapterId } from '../../packages/cli/src/commands/integration/adapters.ts';
import { codexHostBridge, codexBridgeManifest, verifyCodexHostBridge } from '../../packages/cli/src/commands/setup/codex-bridge.ts';
import { supportedAgentIds } from '../../packages/cli/src/commands/setup/detection.ts';
import { atmFirstRunCommand, atmPromptScopedFirstCommand } from '../../packages/integrations-core/src/index.ts';
import { readSkillGuidanceClosure } from '../../scripts/lib/skill-guidance-closure.ts';
import { renderAgentMatrixMarkdown } from '../../scripts/render-agent-matrix.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const expectedReference = readFileSync(path.join(root, 'packages/integrations-core/templates/skills/atm-governance-router.files/references/advanced-governance.md'), 'utf8');
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

test('guidance contract checks follow explicit source references and reject missing or escaping targets', t => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'atm-guidance-closure-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const project = path.join(fixture, 'project'); mkdirSync(project);
  const entry = path.join(project, 'router.skill.md');
  writeFileSync(entry, 'Legacy inline governance\n');
  assert.equal(readSkillGuidanceClosure(project, entry).text, 'Legacy inline governance\n');
  writeFileSync(entry, '[Advanced governed routes]({{REFERENCE_ROOT}}/advanced-governance.md)\n');
  assert.throws(() => readSkillGuidanceClosure(project, entry));
  const refs = path.join(project, 'router.files/references'); mkdirSync(refs, { recursive: true });
  const reference = path.join(refs, 'advanced-governance.md'); writeFileSync(reference, 'Required rule\n');
  assert.match(readSkillGuidanceClosure(project, entry).text, /Required rule/);
  const outside = path.join(fixture, 'outside.md'); writeFileSync(outside, 'Outside content\n');
  writeFileSync(entry, '[Advanced governed routes](../outside.md)\n');
  assert.throws(() => readSkillGuidanceClosure(project, entry), /repository-local/);
  if (process.platform !== 'win32') {
    writeFileSync(entry, '[Advanced governed routes]({{REFERENCE_ROOT}}/advanced-governance.md)\n');
    rmSync(reference); symlinkSync(outside, reference);
    assert.throws(() => readSkillGuidanceClosure(project, entry), /repository-local/);
  }
});

function inspectEntry(project: string, relativeEntry: string) {
  const entry = path.join(project, relativeEntry); const body = readFileSync(entry, 'utf8');
  assert.match(body, /evidence\.firstRun/); assert.match(body, /--help --cwd/);
  assert.ok(body.includes(atmFirstRunCommand) || body.includes(atmFirstRunCommand.replaceAll('"', '\\"')), `${relativeEntry} must preserve the exact first-run command`);
  assert.doesNotMatch(body, /\{\{(?:REFERENCE_ROOT|ACTOR_IDENTITY_HANDOFF_GATE|CHARTER_INVARIANTS|firstCommand)\}\}/);
  const link = body.match(/\[Advanced governed routes\]\(([^)]+)\)/)?.[1];
  assert.ok(link, `${relativeEntry} must link to the advanced rules`);
  const reference = path.resolve(path.dirname(entry), link);
  assert.ok(reference.startsWith(`${project}${path.sep}`));
  assert.equal(digest(readFileSync(reference, 'utf8')), digest(expectedReference));
  assert.doesNotMatch(readFileSync(reference, 'utf8'), /\{\{(?:ACTOR_IDENTITY_HANDOFF_GATE|CHARTER_INVARIANTS|firstCommand|command|handoffs)\}\}/);
  for (const rule of ['INV-ATM-008', 'INV-ATM-009', 'RestrictedExecutionGateway', 'batch checkpoint', 'tasks close', 'command-backed evidence']) {
    assert.ok(expectedReference.includes(rule), `retained advanced rule: ${rule}`);
  }
  assert.match(body, /Actor Identity Handoff Gate/); assert.match(body, /Charter Invariants/);
}

for (const id of supportedAgentIds) {
  test(`${id} installs readable capability entry and complete linked references`, async t => {
    const project = mkdtempSync(path.join(tmpdir(), `atm-entry-${id}-`));
    t.after(() => rmSync(project, { recursive: true, force: true }));
    writeFileSync(path.join(project, 'README.md'), '# User-owned static site\n');
    const adapter = createIntegrationAdapter(id);
    const context = { repositoryRoot: project, manifestPath: `.atm/integrations/${id}.manifest.json`, merge: true };
    const installed = await adapter.install(context);
    assert.equal(installed.ok, true);
    assert.equal((await adapter.verify(context, installed.manifest)).ok, true);
    assert.ok(installed.manifest.metadata?.sourceCatalogDigest);
    assert.ok(installed.manifest.metadata?.installProfileId);
    const entry = id === 'antigravity' ? '.agents/skills/atm-governance-router/SKILL.md' : primaryEntryPathByAdapterId[id];
    inspectEntry(project, entry);
    const nextEntry = path.join(project, entry.replaceAll('atm-governance-router', 'atm-next'));
    const nextBody = readFileSync(nextEntry, 'utf8');
    assert.ok(nextBody.includes(atmPromptScopedFirstCommand) || nextBody.includes(atmPromptScopedFirstCommand.replaceAll('"', '\\"')), `${id} must retain the specialist next command`);
    assert.equal(readFileSync(path.join(project, 'README.md'), 'utf8'), '# User-owned static site\n');
    if (id === 'copilot') inspectEntry(project, '.github/prompts/atm-governance-router.prompt.md');
    if (id === 'antigravity') {
      const bridge = readFileSync(path.join(project, 'GEMINI.md'), 'utf8');
      assert.match(bridge, /--help --cwd/); assert.match(bridge, /Read `.agents\/skills\/atm-governance-router\/SKILL.md` first/);
    }
    if (id === 'cursor') {
      const bridge = readFileSync(path.join(project, '.cursor/rules/atm-governance.mdc'), 'utf8');
      assert.match(bridge, /first-run runtime\/target inspection/);
      assert.doesNotMatch(bridge, /Before user-requested work[^\n]*run `node atm.mjs next/);
    }
    // Manifest ownership still preserves an edited advanced reference.
    const managed = installed.manifest.files.find(file => file.path.endsWith('/references/advanced-governance.md'));
    assert.ok(managed); writeFileSync(path.join(project, managed.path), `${expectedReference}\nUser-owned note\n`);
    assert.equal((await adapter.verify(context, installed.manifest)).ok, false);
    await assert.rejects(async () => adapter.install(context), /conflict|modified|overwrite|ownership/i);
    assert.match(readFileSync(path.join(project, managed.path), 'utf8'), /User-owned note/);
  });
}

test('Codex native bridge has the same linked source contract and ownership safety', async t => {
  const project = mkdtempSync(path.join(tmpdir(), 'atm-entry-native-codex-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(path.join(project, '.agents/skills'), { recursive: true });
  const bridge = codexHostBridge(project);
  const context = { repositoryRoot: project, manifestPath: codexBridgeManifest, merge: true };
  const installed = await bridge.install(context); assert.equal(installed.ok, true);
  inspectEntry(project, '.agents/skills/atm-governance-router/SKILL.md');
  assert.equal((await verifyCodexHostBridge(project)).ok, true);
  assert.ok(existsSync(path.join(project, '.agents/skills/atm-governance-router/references/index.md')));
});

for (const validator of ['integration-adapter', 'guide', 'captain-dispatch-protocol']) {
  test(`official ${validator} validator verifies the retained first-run and governed-route contracts`, () => {
    const output = execFileSync(process.execPath, ['--strip-types', path.join(root, `scripts/validate-${validator}.ts`), '--mode', 'validate'], { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    assert.ok(output.includes(`[${validator}:validate] ok`));
  });
}

test('public matrix derives all six adapter entry commands while retaining separate legacy packs', () => {
  const matrix = renderAgentMatrixMarkdown();
  for (const id of supportedAgentIds) {
    const row = matrix.split('\n').find(line => line.startsWith(`| \`${id}\` |`));
    assert.ok(row?.includes(atmFirstRunCommand), `${id} matrix entry must match the runtime-aware command`);
  }
  assert.match(matrix, /Windsurf/);
  assert.match(matrix, /not proof that an AI model automatically selects a Skill/);
});

test('entry stays thin while advanced obligations remain shipped, without claiming model auto-selection', () => {
  const text = readFileSync(path.join(root, 'packages/integrations-core/templates/skills/atm-governance-router.skill.md'), 'utf8');
  assert.equal(text, readFileSync(path.join(root, 'templates/skills/atm-governance-router.skill.md'), 'utf8'));
  assert.equal(expectedReference, readFileSync(path.join(root, 'templates/skills/atm-governance-router.files/references/advanced-governance.md'), 'utf8'));
  assert.ok(text.split('\n').length <= 160);
  assert.ok(expectedReference.split('\n').length > 400);
  assert.match(text, /do not prove an AI automatically selected/);
  assert.match(text, /Never run an unqualified npm exec\/npx atm/);
});
