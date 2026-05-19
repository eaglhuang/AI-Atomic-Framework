import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { BehaviorRegistry } from '../packages/plugin-sdk/src/behavior-registry.ts';
import {
  createMemoryNudges,
  createExperienceHumanReviewProposalSnapshot,
  createSkillAmendmentProposal,
  defaultExperienceLoopThresholds,
  extractSkillCandidate,
  pluginExperienceLoopPackage,
  registerExperienceLoopBehaviors
} from '../packages/plugin-experience-loop/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

let failed = false;

function fail(message: string) {
  console.error(`[experience-loop:${mode}] ${message}`);
  failed = true;
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

for (const relativePath of [
  'docs/EXPERIENCE_LOOP.md',
  'packages/plugin-experience-loop/package.json',
  'packages/plugin-experience-loop/src/index.ts',
  'packages/plugin-experience-loop/schemas/skill-candidate.schema.json',
  'packages/plugin-experience-loop/schemas/skill-amendment.schema.json',
  'packages/plugin-experience-loop/schemas/memory-nudge.schema.json',
  'packages/cli/src/commands/experience.ts',
  'fixtures/experience-loop/task-evidence.json'
]) {
  assert(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const plan = readText('docs/EXPERIENCE_LOOP.md');
for (const phrase of ['## 8. Milestones', '## 9. Implementation Checklist', '@ai-atomic-framework/plugin-experience-loop', 'MemoryStoreAdapter']) {
  assert(plan.includes(phrase), `experience loop plan missing phrase: ${phrase}`);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSkillCandidate = ajv.compile(readJson('packages/plugin-experience-loop/schemas/skill-candidate.schema.json'));
const validateSkillAmendment = ajv.compile(readJson('packages/plugin-experience-loop/schemas/skill-amendment.schema.json'));
const validateMemoryNudge = ajv.compile(readJson('packages/plugin-experience-loop/schemas/memory-nudge.schema.json'));
const validateReviewAdvisory = ajv.compile(readJson('schemas/review-advisory/review-advisory-report.schema.json'));

assert(pluginExperienceLoopPackage.packageName === '@ai-atomic-framework/plugin-experience-loop', 'package descriptor name mismatch');
assert(defaultExperienceLoopThresholds.extractSkillConfidenceThreshold === 0.6, 'default extraction threshold must stay conservative');

const fixture = readJson('fixtures/experience-loop/task-evidence.json');
const report = extractSkillCandidate(fixture);
assert(report.ok === true, 'fixture skill candidate must cross threshold');
assert(report.candidate.schemaVersion === 'atm.skillCandidate.v0.1', 'candidate schema version mismatch');
assert(report.candidate.lifecycleMode === 'birth', 'candidate lifecycle mode must be birth');
assert(report.candidate.review.route.includes('plugin-human-review'), 'candidate must require human review route');
assert(report.candidate.patternTags.includes('missing-adapter'), 'candidate must preserve detected pattern tag');
assert(validateSkillCandidate(report.candidate) === true, `candidate schema validation failed: ${JSON.stringify(validateSkillCandidate.errors)}`);

const amendment = createSkillAmendmentProposal({
  targetSkillId: 'skill.adapter-boundary',
  triggeringEvidence: fixture.evidence,
  usageHistory: [
    { ok: false, summary: 'first corrective run' },
    { ok: false, summary: 'second corrective run' },
    { ok: false, summary: 'third corrective run' }
  ]
});
assert(amendment.status === 'candidate', 'amendment proposal must become candidate after repeated failures');
assert(amendment.lifecycleMode === 'evolution', 'amendment lifecycle mode must be evolution');
assert(validateSkillAmendment(amendment) === true, `amendment schema validation failed: ${JSON.stringify(validateSkillAmendment.errors)}`);

const nudges = createMemoryNudges({ workItemId: fixture.sourceTaskId, evidence: fixture.evidence });
assert(nudges.length >= 1, 'fixture must produce at least one memory nudge');
assert(nudges.every((nudge) => nudge.scope === 'repo'), 'memory nudges default to repo scope');
assert(validateMemoryNudge(nudges[0]) === true, `memory nudge schema validation failed: ${JSON.stringify(validateMemoryNudge.errors)}`);

const proposalSnapshot = createExperienceHumanReviewProposalSnapshot({
  kind: 'skill-candidate',
  atomId: 'ATM-EXP-0001',
  candidate: report.candidate,
  automatedGatePassed: report.ok
});
assert(proposalSnapshot.reviewRoute.includes('plugin-human-review'), 'experience proposal snapshot must preserve review route');
assert(proposalSnapshot.decompositionDecision === 'atom-extract', 'skill candidate proposal must use atom-extract review decision');

const registry = new BehaviorRegistry();
registerExperienceLoopBehaviors(registry);
for (const action of ['experience.extract-skill', 'experience.amend-skill', 'experience.memory-nudge']) {
  assert(registry.resolve(action as any) !== null, `experience behavior registry must resolve ${action}`);
}
const behaviorOutput = await registry.executeGuarded({ repositoryRoot: root }, {
  entryType: 'atom',
  atomId: 'ATM-EXP-0001',
  action: 'experience.extract-skill',
  requestedBy: 'experience-loop-validator',
  payload: fixture
});
assert(behaviorOutput.ok === true, 'experience.extract-skill behavior must pass for fixture');
assert(behaviorOutput.evidence[0]?.details?.proposalSnapshot, 'experience behavior evidence must include proposal snapshot');

const cliResult = spawnSync(process.execPath, [
  path.join(root, 'atm.mjs'),
  'experience',
  'extract',
  '--input',
  'fixtures/experience-loop/task-evidence.json',
  '--json'
], {
  cwd: root,
  encoding: 'utf8'
});
assert(cliResult.status === 0, `experience CLI must exit 0: ${cliResult.stderr || cliResult.stdout}`);
const cliPayload = JSON.parse(cliResult.stdout);
assert(cliPayload.ok === true, 'experience CLI must report ok=true');
assert(cliPayload.evidence?.report?.candidate?.schemaVersion === 'atm.skillCandidate.v0.1', 'experience CLI must emit candidate report');
assert(validateReviewAdvisory(cliPayload.evidence?.advisoryReport) === true, `CLI advisory report schema validation failed: ${JSON.stringify(validateReviewAdvisory.errors)}`);

const outputRoot = path.join(os.tmpdir(), 'atm-experience-loop-validator');
rmSync(outputRoot, { recursive: true, force: true });
const candidateOut = path.join(outputRoot, 'candidate.json');
const advisoryOut = path.join(outputRoot, 'advisory.json');
const queueOut = path.join(outputRoot, 'experience-proposals.json');
const projectionOut = path.join(outputRoot, 'experience-proposals.md');
const cliWriteResult = spawnSync(process.execPath, [
  path.join(root, 'atm.mjs'),
  'experience',
  'extract',
  '--input',
  path.join(root, 'fixtures/experience-loop/task-evidence.json'),
  '--out',
  candidateOut,
  '--advisory-out',
  advisoryOut,
  '--queue',
  queueOut,
  '--projection',
  projectionOut,
  '--json'
], {
  cwd: root,
  encoding: 'utf8'
});
assert(cliWriteResult.status === 0, `experience CLI with --out must exit 0: ${cliWriteResult.stderr || cliWriteResult.stdout}`);
assert(existsSync(candidateOut), 'experience CLI must write output candidate');
assert(existsSync(advisoryOut), 'experience CLI must write advisory output');
assert(existsSync(queueOut), 'experience CLI must write human-review queue output');
assert(existsSync(projectionOut), 'experience CLI must write queue markdown projection');
const queuePayload = JSON.parse(readFileSync(queueOut, 'utf8'));
assert(queuePayload.entries?.[0]?.proposal?.experienceKind === 'skill-candidate', 'queue proposal must preserve experienceKind');
assert(queuePayload.entries?.[0]?.proposal?.reviewRoute?.includes('plugin-human-review'), 'queue proposal must preserve human-review route');
rmSync(outputRoot, { recursive: true, force: true });

if (failed) {
  process.exit(1);
}

console.log(`[experience-loop:${mode}] ok (candidate extraction, amendment proposal, memory nudge, and CLI smoke verified)`);
