import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBroker } from '../packages/cli/src/commands/broker.ts';
import {
  defaultBrokerProposalStoreRelativePath,
  findBrokerProposal,
  listBrokerProposalSummaries,
  loadBrokerProposalStore,
  saveBrokerProposalStore,
  upsertBrokerProposalStore,
  validateBrokerProposal
} from '../packages/core/src/broker/proposal.ts';
import type { PatchProposal } from '../packages/core/src/broker/types.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function check(condition: unknown, message: string) {
  assert.ok(condition, `[broker-proposal:${mode}] ${message}`);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runAtm(args: string[], cwd = root) {
  const normalizedArgs = args.filter((arg) => arg !== 'broker' && arg !== '--json');
  try {
    const parsed = await runBroker([...normalizedArgs, '--cwd', cwd]);
    return { exitCode: 0, parsed, stdout: '', stderr: '' };
  } catch (error: any) {
    return {
      exitCode: typeof error?.exitCode === 'number' ? error.exitCode : 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed: { ok: false, error: String(error?.message ?? error), evidence: {} as any },
      stdout: '',
      stderr: ''
    };
  }
}

function commitText(cwd: string, message: string) {
  const add = spawnSync('git', ['-C', cwd, 'add', '-A'], {
    encoding: 'utf8'
  });
  check(add.status === 0, `git add failed: ${add.stderr || add.stdout}`);
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=ATM', '-c', 'user.email=atm@example.com', 'commit', '-m', message], {
    encoding: 'utf8'
  });
  check(result.status === 0, `git commit failed: ${result.stderr || result.stdout}`);
  const sha = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  check(sha.status === 0, `git rev-parse HEAD failed: ${sha.stderr || sha.stdout}`);
  return String(sha.stdout ?? '').trim();
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function ensureRequiredFiles() {
  for (const relativePath of [
    'package.json',
    'scripts/validators.config.json',
    'packages/core/src/broker/proposal.ts',
    'packages/cli/src/commands/broker.ts',
    'packages/cli/src/commands/command-specs/broker.spec.ts',
    'tests/cli-fixtures/help-snapshots/broker.json'
  ]) {
    check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
  }
}

function ensureConfigWiring() {
  const packageJson = readJson('package.json');
  check(
    packageJson.scripts?.['validate:broker-proposal'] === 'node --strip-types scripts/validate-broker-proposal.ts --mode validate',
    'package.json must expose validate:broker-proposal'
  );

  const validatorsConfig = readJson('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry: any) => entry.name === 'validate-broker-proposal');
  check(Boolean(validatorDef), 'validators.config.json must register validate-broker-proposal');
  check(validatorDef?.entry === 'scripts/validate-broker-proposal.ts', 'validate-broker-proposal entry path mismatch');
  check(validatorDef?.slow === false, 'validate-broker-proposal should be a fast validator');
  check(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-broker-proposal') === true,
    'standard profile must include validate-broker-proposal'
  );
}

function makeProposal(baseCommit: string, fileBeforeHash: string, targetFile = 'src/target.ts', proposalId = 'proposal.atm-core.0018.valid'): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'baseline' },
    proposalId,
    taskId: 'TASK-CID-0018',
    actorId: '007',
    baseCommit,
    fileBeforeHash,
    targetFile,
    atomRefs: [{ atomId: 'ATM-CORE-0018', atomCid: 'cid-0018' }],
    anchors: [{ kind: 'line', hint: 'export const target = "alpha";' }],
    intent: 'Prepare proposal runtime validation surface.',
    patch: '--- a/src/target.ts\n+++ b/src/target.ts\n@@\n-export const target = "alpha";\n+export const target = "beta";\n',
    validators: ['npm run typecheck', 'npm run validate:cli'],
    rollback: 'Revert the proposal and restore target.ts.'
  };
}

ensureRequiredFiles();
ensureConfigWiring();

const tempRoot = createTempWorkspace('atm-broker-proposal-');
try {
  initializeGitRepository(tempRoot);

  writeFileSync(
    path.join(tempRoot, 'package.json'),
    `${JSON.stringify({ name: 'atm-broker-proposal-temp', private: true, type: 'module' }, null, 2)}\n`,
    'utf8'
  );

  const targetDir = path.join(tempRoot, 'src');
  const targetFile = path.join(targetDir, 'target.ts');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(targetFile, 'export const target = "alpha";\n', 'utf8');
  const baseCommit = commitText(tempRoot, 'base target');

  const proposal = makeProposal(baseCommit, hashFile(targetFile));
  const proposalFile = path.join(tempRoot, 'proposal.json');
  writeJson(proposalFile, proposal);

  const create = await runAtm(['broker', 'proposal', 'create', '--proposal-file', proposalFile, '--json'], tempRoot);
  check(create.exitCode === 0, `broker proposal create failed: ${JSON.stringify(create.parsed)}`);
  check(create.parsed.ok === true, 'proposal create must report ok=true');
  check(create.parsed.evidence?.proposal?.proposalId === proposal.proposalId, 'proposal create must return proposalId');

  const storePath = path.join(tempRoot, defaultBrokerProposalStoreRelativePath);
  check(existsSync(storePath), 'proposal store must be written on create');
  const store = loadBrokerProposalStore(storePath);
  check(store.proposals.length === 1, 'proposal store should contain one proposal');
  check(findBrokerProposal(store, proposal.proposalId)?.proposalId === proposal.proposalId, 'proposal must be findable in store');

  const list = await runAtm(['broker', 'proposal', 'list', '--json'], tempRoot);
  check(list.exitCode === 0, `broker proposal list failed: ${JSON.stringify(list.parsed)}`);
  check(list.parsed.evidence?.proposals?.some((entry: any) => entry.proposalId === proposal.proposalId), 'proposal list must include created proposal');

  const show = await runAtm(['broker', 'proposal', 'show', proposal.proposalId, '--json'], tempRoot);
  check(show.exitCode === 0, `broker proposal show failed: ${JSON.stringify(show.parsed)}`);
  check(show.parsed.evidence?.proposal?.proposalId === proposal.proposalId, 'proposal show must return the requested proposal');

  const validate = await runAtm(['broker', 'proposal', 'validate', proposal.proposalId, '--json'], tempRoot);
  check(validate.exitCode === 0, `broker proposal validate failed: ${JSON.stringify(validate.parsed)}`);
  check(validate.parsed.evidence?.validation?.ok === true, 'broker proposal validate must report ok=true');

  const directValidation = validateBrokerProposal(proposal, { cwd: tempRoot });
  check(directValidation.ok, `direct validate must pass: ${JSON.stringify(directValidation.issues)}`);

  const missingAtomRefs = validateBrokerProposal({ ...proposal, proposalId: 'proposal.atm-core.0018.missing-refs', atomRefs: [] }, { cwd: tempRoot });
  check(!missingAtomRefs.ok, 'proposal with missing atom refs must fail');
  check(missingAtomRefs.issues.some((issue) => issue.kind === 'missing-atom-refs'), 'missing atom refs must be reported');

  const ambiguousAnchors = validateBrokerProposal({
    ...proposal,
    proposalId: 'proposal.atm-core.0018.ambiguous-anchors',
    anchors: [
      { kind: 'line', hint: 'export const target = "alpha";' },
      { kind: 'line', hint: 'export const target = "alpha";' }
    ]
  }, { cwd: tempRoot });
  check(!ambiguousAnchors.ok, 'proposal with ambiguous anchors must fail');
  check(ambiguousAnchors.issues.some((issue) => issue.kind === 'ambiguous-anchors'), 'ambiguous anchors must be reported');

  const outOfScope = validateBrokerProposal({ ...proposal, proposalId: 'proposal.atm-core.0018.out-of-scope', targetFile: '../outside.ts' }, { cwd: tempRoot });
  check(!outOfScope.ok, 'proposal with out-of-scope target file must fail');
  check(outOfScope.issues.some((issue) => issue.kind === 'out-of-scope-target-file'), 'out-of-scope target file must be reported');

  writeFileSync(targetFile, 'export const target = "gamma";\n', 'utf8');
  const fileMismatch = validateBrokerProposal({ ...proposal, proposalId: 'proposal.atm-core.0018.file-mismatch' }, { cwd: tempRoot });
  check(!fileMismatch.ok, 'proposal with file hash mismatch must fail');
  check(fileMismatch.issues.some((issue) => issue.kind === 'file-hash-mismatch'), 'file hash mismatch must be reported');

  writeFileSync(targetFile, 'export const target = "alpha";\n', 'utf8');
  commitText(tempRoot, 'advance head without changing target');
  const stale = validateBrokerProposal(proposal, { cwd: tempRoot });
  check(!stale.ok, 'proposal with stale base commit must fail');
  check(stale.issues.some((issue) => issue.kind === 'stale-base-commit'), 'stale base commit must be reported');

  const updatedStore = upsertBrokerProposalStore(store, proposal);
  saveBrokerProposalStore(storePath, updatedStore);
  check(listBrokerProposalSummaries(updatedStore).length === 1, 'summary listing should remain stable after save');

  console.log(`[broker-proposal:${mode}] ok`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
