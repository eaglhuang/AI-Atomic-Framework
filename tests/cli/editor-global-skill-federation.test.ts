import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  federateExternalSkillCatalog,
  loadExternalSkillCatalog,
  type ProjectedSkillCatalog
} from '../../packages/integrations-core/src/index.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-skl-0032-federation-'));
const codexRoot = path.join(tempRoot, 'codex-global');
const claudeRoot = path.join(tempRoot, 'claude-global');
const incompleteRoot = path.join(tempRoot, 'incomplete-source');

writeSkill(codexRoot, 'helper', {
  name: 'external-helper',
  title: 'External Helper',
  summary: 'External helper skill',
  installProfiles: ['framework-full', 'role-oriented']
}, 'Use external helper.');
writeFileSync(path.join(codexRoot, 'helper', 'reference.md'), 'companion file');
writeSkill(codexRoot, 'shadow-atm-next', {
  name: 'atm-next',
  title: 'Shadow ATM Next'
}, 'Bad override.');
writeSkill(codexRoot, 'reserved', {
  name: 'atm-third-party-reserved',
  title: 'Reserved Namespace'
}, 'Bad reserved namespace.');
writeSkill(claudeRoot, 'helper-copy', {
  name: 'external-helper',
  title: 'External Helper Duplicate'
}, 'Duplicate helper.');
mkdirSync(incompleteRoot, { recursive: true });

const baseCatalog: ProjectedSkillCatalog = {
  schemaId: 'atm.projectedSkillCatalog.v1',
  adapterId: 'codex',
  sourceDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  entries: [{
    id: 'atm-next',
    title: 'ATM Next',
    summary: 'ATM-owned next skill',
    command: 'atm-next',
    firstCommand: 'node atm.mjs next --json',
    owner: 'atm',
    tier: 'entry',
    installProfiles: ['adopter-bootstrap', 'framework-full'],
    invocationPolicy: 'model-or-user',
    companionFiles: [],
    adapterCapabilityRequirements: [],
    sourcePath: 'templates/skills/atm-next.skill.md',
    sourceDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  }],
  files: [{
    skillId: 'atm-next',
    relativePath: 'atm-next/SKILL.md',
    content: 'ATM next',
    fileFormat: 'skill',
    sourceDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    managed: true
  }]
};

const externalCatalog = loadExternalSkillCatalog({
  sources: [
    {
      sourceId: 'codex-global-fixture',
      providerId: 'codex-global',
      rootDir: codexRoot,
      sourceRootRef: 'codex-global-profile',
      sourceFormat: 'codex-skill-directory',
      priority: 10,
      provenance: 'fixture:codex-global',
      license: 'MIT'
    },
    {
      sourceId: 'claude-global-fixture',
      providerId: 'claude-code-global',
      rootDir: claudeRoot,
      sourceRootRef: 'claude-global-profile',
      sourceFormat: 'claude-skill-directory',
      priority: 20,
      provenance: 'fixture:claude-global'
    },
    {
      sourceId: 'incomplete-fixture',
      providerId: 'third-party',
      rootDir: incompleteRoot,
      sourceRootRef: 'incomplete-profile',
      priority: 30
    }
  ]
});

assert.equal(externalCatalog.schemaId, 'atm.externalSkillCatalog.v1');
assert.equal(externalCatalog.sources.length, 3);
assert(externalCatalog.sources.every((source) => !source.sourceRootRef.includes(tempRoot)), 'catalog descriptors must not embed machine paths');
assert(externalCatalog.entries.some((entry) => entry.id === 'external-helper' && entry.license === 'MIT'));
assert(externalCatalog.files.some((file) => file.relativePath === 'external-helper/reference.md'), 'companion files must be projected');
assert(externalCatalog.skippedInvalidSources.some((skip) => skip.sourceId === 'incomplete-fixture'));

const federated = federateExternalSkillCatalog({ baseCatalog, externalCatalog });
assert.equal(federated.schemaId, 'atm.federatedSkillCatalog.v1');
assert(federated.projectedCatalog.entries.some((entry) => entry.id === 'external-helper'), 'external helper should be selected');
assert.equal(federated.projectedCatalog.entries.filter((entry) => entry.id === 'external-helper').length, 1, 'duplicate external ids select one winner');
assert(federated.decisions.some((decision) => decision.skillId === 'atm-next' && decision.decision === 'preserve-atm'));
assert(federated.decisions.some((decision) => decision.skillId === 'atm-third-party-reserved' && decision.decision === 'fail-closed'));
assert(federated.decisions.some((decision) => decision.skillId === 'external-helper' && decision.decision === 'preserve-first-external'));

console.log(JSON.stringify({
  marker: '[editor-global-skill-federation.test] ok',
  sources: externalCatalog.sources.length,
  entries: externalCatalog.entries.length,
  selected: federated.projectedCatalog.entries.map((entry) => entry.id).sort()
}));

function writeSkill(root: string, dirName: string, frontmatter: Record<string, string | readonly string[]>, body: string) {
  const skillDir = path.join(root, dirName);
  mkdirSync(skillDir, { recursive: true });
  const yaml = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((item) => `  - ${item}`).join('\n')}`;
    }
    return `${key}: ${value}`;
  }).join('\n');
  writeFileSync(path.join(skillDir, 'SKILL.md'), `---\n${yaml}\n---\n\n${body}\n`);
}
