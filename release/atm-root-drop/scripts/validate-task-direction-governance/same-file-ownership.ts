import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  assert,
  initializeGit,
  makeAdopterRepo,
  runGit,
  runHook,
  runNext,
  runTasks,
  writeEvidence,
  writeJson,
  writeLedgerTask
} from './context.ts';

/**
 * TASK-CID-0024:
 * next --claim 銝????瑼???atom ???葉????停銝敺?????
 * - 甇?? 1嚗?瑼? atom ??雿??孵撠鋡?claim ???嚗dvisory only嚗?
 * - ??嚗??孵撌脰◤?嗡? actor 隞?write intent 銝餃? claim ??隞?鋡?
 *   ATM_NEXT_CLAIM_BLOCKED ????
 * - 甇?? 2嚗loseout-only / no-more-mutation claim intent ?典?璅??瘣餉?銵?
 *   銝???claim嚗? intent ???task ledger claim.intent??
 */
export async function validateSameFileParallelClaimAdmission(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-same-file-parallel-claim');
  writeFileSync(path.join(repo, 'src', 'shared.ts'), 'export const shared = 1;\n', 'utf8');
  for (const [taskId, ownFile] of [['TASK-PAR-0001', 'src/one.ts'], ['TASK-PAR-0002', 'src/two.ts']] as const) {
    writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: taskId,
      title: `Same-file parallel fixture ${taskId}`,
      status: 'ready',
      dependencies: [],
      scopePaths: [ownFile, 'src/shared.ts'],
      source: {
        planPath: 'docs/plan.md',
        sectionTitle: taskId,
        headingLine: 1,
        hash: taskId
      }
    });
    writeEvidence(repo, taskId);
  }
  writeJson(path.join(repo, 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), {
    mappings: [
      { path_pattern: 'src/shared.ts', atom_id: 'atom-shared-fixture', capability: 'fixture-shared-surface' }
    ]
  });
  initializeGit(repo);

  // 甇?? 1嚗ASK-PAR-0001 隞??嚗 claim嚗???atom ??銝??餅? claim??
  const queuedOverlapClaim = await runNext(['--cwd', repo, '--claim', '--actor', 'agent-other', '--prompt', 'TASK-PAR-0002']);
  assert(queuedOverlapClaim.ok === true, 'same-file parallel claim: CID/atom overlap with a queued (unclaimed) task must not block next --claim');
  const claimedTask = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-PAR-0002.json'), 'utf8')) as Record<string, any>;
  assert(claimedTask.claim?.state === 'active' && claimedTask.claim?.actorId === 'agent-other', 'same-file parallel claim: TASK-PAR-0002 must hold an active claim after admission');
  assert((claimedTask.claim?.intent ?? 'write') === 'write', 'same-file parallel claim: default claim intent must be write');

  // ??嚗ASK-PAR-0002 撌脰◤?虫? actor 隞?write intent 銝餃? claim嚗?
  // ??atom ??TASK-PAR-0001 write claim 敹?隞◤????
  let activeConflictBlocked: any = null;
  let activeConflictClaim: any = null;
  try {
    activeConflictClaim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-PAR-0001']);
  } catch (error) {
    activeConflictBlocked = error;
  }
  assert(activeConflictBlocked?.code === 'ATM_NEXT_CLAIM_BLOCKED', 'same-file parallel claim: unresolved active shared-atom write overlap must block next --claim. Got: ' + JSON.stringify(activeConflictBlocked));
  assert(activeConflictBlocked?.details?.requiredResolutionArtifact === 'atm.brokerConflictResolution.v1', 'same-file parallel claim: block must request broker conflict resolution artifact');
  assert(String(activeConflictBlocked?.details?.requiredCommand ?? '').includes('team broker resolve'), 'same-file parallel claim: block must include a broker resolve command');

  // 甇?? 2嚗loseout-only claim intent ?典?璅??瘣餉?銵?銝?? claim??
  const closeoutOnlyClaim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-PAR-0001', '--claim-intent', 'closeout-only']);
  assert(closeoutOnlyClaim.ok === true, 'same-file parallel claim: closeout-only claim intent must be admitted despite an active same-atom write claim');
  assert((closeoutOnlyClaim.evidence as any).claimIntent === 'closeout-only', 'same-file parallel claim: next --claim evidence must surface claimIntent=closeout-only');
  const closeoutTask = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-PAR-0001.json'), 'utf8')) as Record<string, any>;
  assert(closeoutTask.claim?.state === 'active' && closeoutTask.claim?.intent === 'closeout-only', 'same-file parallel claim: ledger claim.intent must persist closeout-only');
}

/**
 * TASK-CID-0024:
 * hook pre-commit 銝????銝 staged 瑼?憭?active claim?停憭望???
 * - 甇?? 1嚗??write claim 閬???瑼?雿?committing task ?芸楛??閰脫? ??????
 * - ?? 1嚗taged 瑼鋡怠??active write claim 閬?嚗ixed staged content嚗?
 *   銝 steward/broker 霅? ??ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS??
 * - 甇?? 2嚗?璅?? staged 瑼??neutral-steward broker intent 閬? ??????
 * - ?? 2嚗loseout-only claim ??staged ?芸楛 scope ??source mutation ??
 *   ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION??
 */
export async function validateSameFilePreCommitOwnership(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-same-file-precommit');
  writeFileSync(path.join(repo, 'src', 'shared.ts'), 'export const shared = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'c.ts'), 'export const c = 1;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-MIX-0001', 'Same-file pre-commit fixture one', 'src/a.ts');
  writeLedgerTask(repo, 'TASK-MIX-0002', 'Same-file pre-commit fixture two', 'src/b.ts');
  writeLedgerTask(repo, 'TASK-MIX-0003', 'Closeout-only pre-commit fixture', 'src/c.ts');
  writeEvidence(repo, 'TASK-MIX-0001');
  writeEvidence(repo, 'TASK-MIX-0002');
  writeEvidence(repo, 'TASK-MIX-0003');
  initializeGit(repo);

  const claimOne = await runTasks(['claim', '--cwd', repo, '--task', 'TASK-MIX-0001', '--actor', 'adopter-agent', '--files', 'src/a.ts,src/shared.ts', '--json']);
  assert(claimOne.ok === true, 'same-file pre-commit: TASK-MIX-0001 claim must succeed');
  const claimTwo = await runTasks(['claim', '--cwd', repo, '--task', 'TASK-MIX-0002', '--actor', 'adopter-agent', '--files', 'src/b.ts,src/shared.ts', '--json']);
  assert(claimTwo.ok === true, 'same-file pre-commit: TASK-MIX-0002 same-file claim must succeed alongside TASK-MIX-0001');
  const claimThree = await runTasks(['claim', '--cwd', repo, '--task', 'TASK-MIX-0003', '--actor', 'adopter-agent', '--files', 'src/c.ts', '--claim-intent', 'closeout-only', '--json']);
  assert(claimThree.ok === true, 'same-file pre-commit: closeout-only claim must succeed');
  assert((claimThree.evidence as any).claimIntent === 'closeout-only', 'same-file pre-commit: tasks claim evidence must surface claimIntent');

  const runPreCommitAs = (taskId: string) => {
    process.env.ATM_COMMIT_ACTOR_ID = 'adopter-agent';
    process.env.ATM_COMMIT_TASK_ID = taskId;
    process.env.GIT_AUTHOR_NAME = 'ATM Test';
    process.env.GIT_AUTHOR_EMAIL = 'atm-test@example.invalid';
    try {
      return runHook(['pre-commit', '--cwd', repo]);
    } finally {
      delete process.env.ATM_COMMIT_ACTOR_ID;
      delete process.env.ATM_COMMIT_TASK_ID;
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_AUTHOR_EMAIL;
    }
  };

  const writeStewardReceipt = (files: string[]) => {
    const head = runGit(repo, ['rev-parse', 'HEAD']).trim();
    const fileDigests = Object.fromEntries(files.map((file) => [
      file,
      `git-blob:${runGit(repo, ['rev-parse', `:${file}`]).trim()}`
    ]));
    writeJson(path.join(repo, '.atm', 'history', 'evidence', 'steward.shared-write-provenance.json'), {
      schemaId: 'atm.sharedWriteProvenanceReceipt.v1',
      receiptId: 'receipt-same-file-precommit',
      canonicalRoot: repo.replace(/\\/g, '/'),
      baseSha: head,
      headSha: head,
      compositionPlanDigest: `sha256:${'1'.repeat(64)}`,
      candidateOutputDigest: `sha256:${'2'.repeat(64)}`,
      serializabilityProofDigest: `sha256:${'3'.repeat(64)}`,
      stewardId: 'steward-fixture',
      stewardRole: 'neutral-steward',
      memberTaskIds: ['TASK-MIX-0001', 'TASK-MIX-0002'],
      fileDigests,
      canonicalWriteCount: 1,
      semanticAuthorization: {
        schemaId: 'atm.stewardSemanticValidationReceipt.v1',
        candidateDigest: `sha256:${'1'.repeat(64)}`,
        outputDigest: `sha256:${'2'.repeat(64)}`,
        decisionVerdict: 'pass',
        ok: true
      },
      semanticBaseHeadSha: head,
      semanticSealedSelectionSourceDigest: `sha256:${'4'.repeat(64)}`,
      semanticRunnerBuildDigest: `sha256:${'5'.repeat(64)}`,
      issuedAt: new Date().toISOString(),
      consumedAt: null
    });
  };

  // 甇?? 1嚗ommitting task ?? staged ?? ??憭? same-file claim 銝??餅???
  writeFileSync(path.join(repo, 'src', 'shared.ts'), 'export const shared = 2;\n', 'utf8');
  runGit(repo, ['add', 'src/shared.ts']);
  const ownedMultiClaim = runPreCommitAs('TASK-MIX-0001');
  assert(ownedMultiClaim.ok === false, 'same-file pre-commit: multiple active same-file claims must fail closed without a consumed neutral-steward receipt');
  const ownedReport = (ownedMultiClaim.evidence as any).sameFileClaimReport;
  assert(ownedReport?.ok === false, 'same-file pre-commit: sameFileClaimReport must fail closed without a steward receipt');
  assert((ownedReport?.multiClaimFiles ?? []).some((entry: any) => entry.file === 'src/shared.ts'), 'same-file pre-commit: sameFileClaimReport must record the same-file multi-claim coverage');
  assert((ownedReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_BROKER_STEWARD_RECEIPT_REQUIRED' && entry.file === 'src/shared.ts'), 'same-file pre-commit: multi-claim writes without a receipt must require a neutral-steward receipt');

  // ?? 1嚗taged 瑼撅祆?虫???active write claim ??ambiguous嚗????
  writeFileSync(path.join(repo, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
  runGit(repo, ['add', 'src/b.ts']);
  const ambiguous = runPreCommitAs('TASK-MIX-0001');
  assert(ambiguous.ok === false, 'same-file pre-commit: mixed staged content owned by another active write claim must block');
  const ambiguousFindings = ((ambiguous.evidence as any).sameFileClaimReport?.findings ?? []) as Array<Record<string, any>>;
  assert(ambiguousFindings.some((entry) => entry.code === 'ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS' && entry.file === 'src/b.ts'), 'same-file pre-commit: ambiguous staged ownership must emit ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS for the foreign-claimed file');

  // 甇?? 2嚗?璅?? staged 瑼??neutral-steward broker intent 閬? ??????
  writeJson(path.join(repo, '.atm', 'runtime', 'write-broker.registry.json'), {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'local-repo',
    workspaceId: 'main',
    activeIntents: [
      {
        intentId: 'intent-fixture-steward',
        taskId: 'TASK-MIX-0002',
        teamRunId: null,
        actorId: 'steward-fixture',
        baseCommit: 'HEAD',
        resourceKeys: {
          files: ['src/b.ts'],
          atomIds: [],
          atomCids: [],
          generators: [],
          projections: [],
          registries: [],
          validators: [],
          artifacts: []
        },
        leaseEpoch: 1,
        lane: 'neutral-steward',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }
    ]
  });
  const intentOnly = runPreCommitAs('TASK-MIX-0001');
  assert(intentOnly.ok === false, 'same-file pre-commit: broker intent alone must not authorize a canonical multi-claim write');
  const intentOnlyFindings = ((intentOnly.evidence as any).sameFileClaimReport?.findings ?? []) as Array<Record<string, any>>;
  assert(intentOnlyFindings.some((entry) => entry.code === 'ATM_BROKER_STEWARD_RECEIPT_REQUIRED'), 'same-file pre-commit: broker intent without a consumed receipt must remain fail-closed');

  writeStewardReceipt(['src/shared.ts', 'src/b.ts']);
  const stewardCovered = runPreCommitAs('TASK-MIX-0001');
  assert(stewardCovered.ok === true, `same-file pre-commit: an exact digest-bound neutral-steward receipt must resolve staged ownership ambiguity. Got: ${JSON.stringify((stewardCovered.evidence as any).blockingFindings ?? [])}`);
  rmSync(path.join(repo, '.atm', 'runtime', 'write-broker.registry.json'), { force: true });
  rmSync(path.join(repo, '.atm', 'history', 'evidence', 'steward.shared-write-provenance.json'), { force: true });
  runGit(repo, ['reset', '--', 'src/b.ts']);
  runGit(repo, ['checkout', '--', 'src/b.ts']);
  runGit(repo, ['reset', '--', 'src/shared.ts']);
  runGit(repo, ['checkout', '--', 'src/shared.ts']);

  // ?? 2嚗loseout-only claim 銝? staged ?芸楛 scope ??source mutation??
  writeFileSync(path.join(repo, 'src', 'c.ts'), 'export const c = 2;\n', 'utf8');
  runGit(repo, ['add', 'src/c.ts']);
  const closeoutMutation = runPreCommitAs('TASK-MIX-0003');
  assert(closeoutMutation.ok === false, 'same-file pre-commit: closeout-only claim must not ship new source mutations');
  const closeoutFindings = ((closeoutMutation.evidence as any).sameFileClaimReport?.findings ?? []) as Array<Record<string, any>>;
  assert(closeoutFindings.some((entry) => entry.code === 'ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION' && entry.file === 'src/c.ts'), 'same-file pre-commit: closeout-only mutation must emit ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION');
}

