import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ATM_BACKLOG_GENERATED_MARKER,
  ATM_BACKLOG_ITEMS_DIR,
  ATM_BACKLOG_PROJECTION_PATH,
  parseBacklogItemsFromProjection,
  rebuildProjectionFromItems,
  renderBacklogProjection,
  validateGovernanceProjections,
  writeGovernanceBacklogItems,
  type GovernanceBacklogItem
} from '../../scripts/validate-governance-projections.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-governance-hotfile-'));

try {
  const governanceDir = path.join(repo, 'docs', 'governance');
  mkdirSync(governanceDir, { recursive: true });
  const prefix = [
    '# ATM Bug and Optimization Backlog',
    '',
    'This Markdown file is a generated projection for existing readers.',
    ''
  ].join('\n');
  writeFileSync(path.join(repo, ATM_BACKLOG_PROJECTION_PATH), prefix, 'utf8');

  const later: GovernanceBacklogItem = {
    schemaId: 'atm.governanceBacklogItem.v1',
    id: 'ATM-BUG-2099-01-02-002',
    date: '2099-01-02',
    repo: 'AI-Atomic-Framework',
    type: 'Optimization',
    severity: 'Medium',
    status: 'Open',
    area: 'Hotfile sharding',
    finding: 'Shared Markdown table edits cause avoidable merge pressure.',
    expectedBehavior: 'Agents write owned item files and rebuild the projection.',
    evidenceOrRepro: 'ATM-GOV-0134 fixture.',
    followUp: 'Keep projection validation in close gates.'
  };
  const earlier: GovernanceBacklogItem = {
    ...later,
    id: 'ATM-BUG-2099-01-01-001',
    date: '2099-01-01',
    type: 'Bug',
    finding: 'Projection can become stale when item files change.'
  };

  writeGovernanceBacklogItems(repo, [later, earlier]);
  rebuildProjectionFromItems(repo);
  const projection = readFileSync(path.join(repo, ATM_BACKLOG_PROJECTION_PATH), 'utf8');
  assert.ok(projection.includes(ATM_BACKLOG_GENERATED_MARKER), 'projection must include generated marker');
  assert.ok(projection.indexOf(earlier.id) < projection.indexOf(later.id), 'projection rows must be deterministic by id');
  assert.ok(projection.includes('Mandatory Global Hotfile Inventory'), 'projection must inventory other global hotfiles');
  assert.equal(validateGovernanceProjections(repo).ok, true, 'fresh projection must validate');

  writeFileSync(path.join(repo, ATM_BACKLOG_PROJECTION_PATH), `${projection}\n<!-- stale edit -->\n`, 'utf8');
  const stale = validateGovernanceProjections(repo);
  assert.equal(stale.ok, false, 'stale projection must fail validation');
  assert.ok(stale.errors.some((entry) => entry.includes('projection is stale')), 'stale error must explain rebuild command');

  const legacyProjection = [
    '| ID | Date | Repo | Type | Severity | Status | Area | Finding | Expected behavior | Evidence / Repro | Follow-up |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| ATM-BUG-2099-01-03-003 | 2099-01-03 | AI-Atomic-Framework | Optimization | Medium | Identity provenance | Missing status in legacy row. | Expected behavior. | Evidence. | Follow-up. |'
  ].join('\n');
  const migrated = parseBacklogItemsFromProjection(legacyProjection);
  assert.equal(migrated.length, 1, 'legacy 10-column row must migrate');
  assert.equal(migrated[0].status, 'Open', 'legacy missing status row must receive Open status');
  assert.equal(migrated[0].area, 'Identity provenance', 'legacy area must be preserved');

  const rendered = renderBacklogProjection(`${prefix}${legacyProjection}`, [earlier]);
  assert.equal((rendered.match(/ATM-BUG-2099/g) ?? []).length, 1, 'rendering must remove legacy table from prefix');

  const skillText = readFileSync(path.resolve('.agents/skills/atm-bug-backlog/SKILL.md'), 'utf8');
  assert.ok(skillText.includes('atm-bug-and-optimization-backlog.items/<ATM-BUG-YYYY-MM-DD-NNN>.json'), 'skill must route ATM backlog authority to item files');
  assert.ok(skillText.includes('Do not directly author new ATM backlog rows in the Markdown projection'), 'skill must forbid direct Markdown row authoring');

  console.log('[governance-hotfile-sharding.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
