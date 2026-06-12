import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { composeBrokerProposals } from '../packages/core/src/broker/compose.ts';
import { applyStewardPlan, planStewardApply } from '../packages/core/src/broker/steward.ts';
import { validateBrokerProposal } from '../packages/core/src/broker/proposal.ts';
import type { PatchProposal } from '../packages/core/src/broker/types.ts';

type BrokeredWriteScenarioKind = 'disjoint-same-file' | 'conflict-same-atom' | 'hash-mismatch';

interface BrokeredWriteScenarioFile {
  readonly path: string;
  readonly contents: string;
}

interface BrokeredWriteScenarioFixture {
  readonly id: BrokeredWriteScenarioKind;
  readonly description: string;
  readonly baseCommitMessage: string;
  readonly files: readonly BrokeredWriteScenarioFile[];
  readonly proposals: readonly PatchProposal[];
  readonly expected: {
    readonly composeVerdict: 'parallel-safe' | 'needs-steward' | 'blocked-cid-conflict';
    readonly stewardOk?: boolean;
    readonly fileAfter?: Record<string, string>;
    readonly validationOk?: boolean;
  };
}

interface ScenarioRuntime {
  readonly baseCommit: string;
  readonly fileBeforeHash: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';

function check(condition: unknown, message: string): void {
  assert.ok(condition, `[brokered-write:${mode}] ${message}`);
}

function readJson(relativePath: string): BrokeredWriteScenarioFixture {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as BrokeredWriteScenarioFixture;
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  check(result.status === 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return String(result.stdout ?? '').trim();
}

function createTempWorkspace(prefix: string): string {
  const tempRoot = path.join(root, '.atm', 'runtime', `${prefix}${Date.now().toString(36)}`);
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  return tempRoot;
}

function initTempRepo(tempRoot: string): void {
  runGit(tempRoot, ['init']);
  runGit(tempRoot, ['config', 'user.name', 'ATM']);
  runGit(tempRoot, ['config', 'user.email', 'atm@example.com']);
  writeFileSync(path.join(tempRoot, 'package.json'), `${JSON.stringify({ name: 'atm-brokered-write-temp', private: true, type: 'module' }, null, 2)}\n`, 'utf8');
}

function writeScenarioFiles(tempRoot: string, files: readonly BrokeredWriteScenarioFile[]): void {
  for (const file of files) {
    const absolute = path.join(tempRoot, file.path);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.contents, 'utf8');
  }
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function createHashForScenario(fileContents: string): string {
  return hashText(fileContents);
}

function hydrateProposals(
  proposals: readonly PatchProposal[],
  runtime: ScenarioRuntime
): PatchProposal[] {
  return proposals.map((proposal) => ({
    ...proposal,
    baseCommit: proposal.baseCommit === '__BASE_COMMIT__' ? runtime.baseCommit : proposal.baseCommit,
    fileBeforeHash: proposal.fileBeforeHash === '__FILE_HASH__' ? runtime.fileBeforeHash : proposal.fileBeforeHash
  }));
}

function commitSnapshot(tempRoot: string, message: string): string {
  runGit(tempRoot, ['add', '-A']);
  runGit(tempRoot, ['commit', '-m', message]);
  return runGit(tempRoot, ['rev-parse', 'HEAD']);
}

function readScenarioFixtures(): readonly BrokeredWriteScenarioFixture[] {
  return [
    readJson('scripts/fixtures/brokered-write/disjoint-same-file.scenario.json'),
    readJson('scripts/fixtures/brokered-write/conflict-same-atom.scenario.json'),
    readJson('scripts/fixtures/brokered-write/hash-mismatch.scenario.json')
  ];
}

function assertProposalValidationPasses(tempRoot: string, proposal: PatchProposal): void {
  const validation = validateBrokerProposal(proposal, { cwd: tempRoot });
  check(validation.ok === true, `proposal ${proposal.proposalId} should validate cleanly`);
}

function assertProposalValidationFails(tempRoot: string, proposal: PatchProposal, expectedKind: 'file-hash-mismatch' | 'stale-base-commit'): void {
  const validation = validateBrokerProposal(proposal, { cwd: tempRoot });
  check(validation.ok === false, `proposal ${proposal.proposalId} should fail validation`);
  check(validation.issues.some((issue) => issue.kind === expectedKind), `proposal ${proposal.proposalId} should report ${expectedKind}`);
}

function runDisjointSameFileScenario(scenario: BrokeredWriteScenarioFixture): void {
  const tempRoot = createTempWorkspace('atm-brokered-write-disjoint-');
  try {
    initTempRepo(tempRoot);
    writeScenarioFiles(tempRoot, scenario.files);
    const baseCommit = commitSnapshot(tempRoot, scenario.baseCommitMessage);
    check(baseCommit.length > 0, 'base commit must be created');
    const fileBeforeHash = createHashForScenario(scenario.files[0].contents);
    const proposals = hydrateProposals(scenario.proposals, { baseCommit, fileBeforeHash });

    for (const proposal of proposals) {
      assertProposalValidationPasses(tempRoot, proposal);
    }

    const composeResult = composeBrokerProposals(proposals);
    check(composeResult.ok === true, 'disjoint same-file proposals must compose successfully');
    check(composeResult.mergePlan.verdict === scenario.expected.composeVerdict, `expected compose verdict ${scenario.expected.composeVerdict}`);
    check(composeResult.mergePlan.applyMethod === 'patch-apply', 'parallel-safe merge plan must use patch-apply');

    const stewardPlan = planStewardApply({
      cwd: tempRoot,
      stewardId: 'neutral-write-steward',
      mergePlan: composeResult.mergePlan,
      proposals,
      scopeFiles: proposals.map((proposal) => proposal.targetFile)
    });
    check(stewardPlan.ok === true, 'steward plan must be ready for disjoint same-file proposals');

    const applyResult = applyStewardPlan({
      cwd: tempRoot,
      stewardId: 'neutral-write-steward',
      mergePlan: composeResult.mergePlan,
      proposals,
      scopeFiles: proposals.map((proposal) => proposal.targetFile)
    });
    check(applyResult.ok === true, 'steward apply must succeed for disjoint same-file proposals');

    for (const [relativePath, expectedContent] of Object.entries(scenario.expected.fileAfter ?? {})) {
      const actual = readFileSync(path.join(tempRoot, relativePath), 'utf8');
      check(actual === expectedContent, `expected ${relativePath} to match steward-applied content`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runConflictSameAtomScenario(scenario: BrokeredWriteScenarioFixture): void {
  const tempRoot = createTempWorkspace('atm-brokered-write-conflict-');
  try {
    initTempRepo(tempRoot);
    writeScenarioFiles(tempRoot, scenario.files);
    const baseCommit = commitSnapshot(tempRoot, scenario.baseCommitMessage);
    const fileBeforeHash = createHashForScenario(scenario.files[0].contents);
    const proposals = hydrateProposals(scenario.proposals, { baseCommit, fileBeforeHash });

    const composeResult = composeBrokerProposals(proposals);
    check(composeResult.ok === false, 'same-atom conflict must fail compose');
    check(composeResult.mergePlan.verdict === scenario.expected.composeVerdict, `expected compose verdict ${scenario.expected.composeVerdict}`);
    check(
      composeResult.mergePlan.conflicts.some((conflict) => conflict.kind === 'cid'),
      'same-atom conflict must report a cid conflict'
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runHashMismatchScenario(scenario: BrokeredWriteScenarioFixture): void {
  const tempRoot = createTempWorkspace('atm-brokered-write-hash-');
  try {
    initTempRepo(tempRoot);
    writeScenarioFiles(tempRoot, scenario.files);
    const baseCommit = commitSnapshot(tempRoot, scenario.baseCommitMessage);
    check(baseCommit.length > 0, 'base commit must be created for hash mismatch scenario');
    const fileBeforeHash = createHashForScenario(scenario.files[0].contents);
    const proposal = hydrateProposals(scenario.proposals, { baseCommit, fileBeforeHash })[0];

    const targetFile = path.join(tempRoot, proposal.targetFile);
    writeFileSync(targetFile, `${scenario.files[0].contents}tampered\n`, 'utf8');
    const validation = validateBrokerProposal(proposal, { cwd: tempRoot });
    check(validation.ok === false, 'hash mismatch scenario must fail proposal validation');
    check(
      validation.issues.some((issue) => issue.kind === 'file-hash-mismatch'),
      'hash mismatch scenario must report file-hash-mismatch'
    );
    check(scenario.expected.validationOk === false, 'hash mismatch scenario must be expected to fail validation');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const scenarios = readScenarioFixtures();
const disjoint = scenarios.find((scenario) => scenario.id === 'disjoint-same-file');
const conflict = scenarios.find((scenario) => scenario.id === 'conflict-same-atom');
const hashMismatch = scenarios.find((scenario) => scenario.id === 'hash-mismatch');

check(Boolean(disjoint), 'missing disjoint-same-file scenario fixture');
check(Boolean(conflict), 'missing conflict-same-atom scenario fixture');
check(Boolean(hashMismatch), 'missing hash-mismatch scenario fixture');

runDisjointSameFileScenario(disjoint!);
runConflictSameAtomScenario(conflict!);
runHashMismatchScenario(hashMismatch!);

console.log(`[brokered-write:${mode}] ok`);
