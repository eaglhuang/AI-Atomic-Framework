import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { composeBrokerProposals } from '../../packages/core/src/broker/index.ts';
import {
  check,
  mode,
  root,
  runAtm,
  writeJson,
  writeProposalFile
} from './context.ts';

interface ProposalGatedHotFlowInput {
  tempRoot: string;
  hotSharedFile: string;
  hotFirstTaskId: string;
  hotDisjointTaskId: string;
  hotOverlapTaskId: string;
  hotDisjointLane: any;
  hotOverlapLane: any;
  parkJoinLane: any;
  sameOwnerJoinLane: any;
  sameOwnerBlockLane: any;
  firstWriterAdmission: Record<string, unknown> | undefined;
  retainedArtifactsDir: string | null;
}

export async function runProposalGatedHotFlow(input: ProposalGatedHotFlowInput) {
  const {
    tempRoot,
    hotSharedFile,
    hotFirstTaskId,
    hotDisjointTaskId,
    hotOverlapTaskId,
    hotDisjointLane,
    hotOverlapLane,
    parkJoinLane,
    sameOwnerJoinLane,
    sameOwnerBlockLane,
    firstWriterAdmission,
    retainedArtifactsDir
  } = input;
  const baseHotFile = readFileSync(path.join(tempRoot, hotSharedFile), 'utf8');
  const hotBaseHash = `sha256:${createHash('sha256').update(baseHotFile).digest('hex')}`;
  const hotBaseCommit = spawnSync('git', ['-C', tempRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  check(hotBaseCommit.status === 0, `git rev-parse HEAD failed for proposal-gated hot flow: ${hotBaseCommit.stderr || hotBaseCommit.stdout}`);
  const hotBaseCommitSha = String(hotBaseCommit.stdout ?? '').trim();
  const firstProposalPath = writeProposalFile(tempRoot, 'proposal-first-hot.json', {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'proposal-gated hot writer first region' },
    proposalId: 'proposal-hot-first',
    taskId: hotFirstTaskId,
    actorId: 'coordinator-1',
    targetFile: hotSharedFile,
    baseCommit: hotBaseCommitSha,
    fileBeforeHash: hotBaseHash,
    atomRefs: [{ atomId: 'atom-hot-first', atomCid: 'cid-hot-first', operation: 'modify' }],
    anchors: [{ kind: 'line-range', hint: 'first-region' }],
    intent: 'Replace the first writer bounded region after proposal-first admission.',
    patch: '@@ -4,3 +4,3 @@\n-    \'line-02\',\n-    \'line-03\',\n-    \'line-04\',\n+    \'line-02-first\',\n+    \'line-03-first\',\n+    \'line-04-first\',\n',
    validators: ['node --strip-types scripts/validate-team-brokered-write.ts --mode validate'],
    rollback: 'Restore the original broker hot fixture lines 2-4.'
  });
  const secondProposalPath = writeProposalFile(tempRoot, 'proposal-second-hot.json', {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'proposal-gated hot writer disjoint region' },
    proposalId: 'proposal-hot-second',
    taskId: hotDisjointTaskId,
    actorId: 'coordinator-2',
    targetFile: hotSharedFile,
    baseCommit: hotBaseCommitSha,
    fileBeforeHash: hotBaseHash,
    atomRefs: [{ atomId: 'atom-hot-disjoint', atomCid: 'cid-hot-disjoint', operation: 'modify' }],
    anchors: [{ kind: 'line-range', hint: 'second-region' }],
    intent: 'Replace the disjoint late-joiner bounded region through composer/steward.',
    patch: '@@ -20,3 +20,3 @@\n-    \'line-18\',\n-    \'line-19\',\n-    \'line-20\',\n+    \'line-18-second\',\n+    \'line-19-second\',\n+    \'line-20-second\',\n',
    validators: ['node --strip-types scripts/validate-team-brokered-write.ts --mode validate'],
    rollback: 'Restore the original broker hot fixture lines 18-20.'
  });

  const hotCompose = await runAtm([
    'broker', 'compose',
    '--proposal-file', firstProposalPath,
    '--proposal-file', secondProposalPath
  ], tempRoot);
  check(hotCompose.exitCode === 0 && hotCompose.parsed.ok === true, `proposal-gated compose must succeed for disjoint hot regions: ${JSON.stringify(hotCompose.parsed)}`);
  const hotMergePlan = (hotCompose.parsed.evidence as Record<string, unknown>)?.mergePlan as Record<string, unknown>;
  check(hotMergePlan?.verdict === 'parallel-safe', 'disjoint patch proposals must remain compose-mergeable');
  const hotMergePlanPath = path.join(tempRoot, 'hot-merge-plan.json');
  writeJson(hotMergePlanPath, hotMergePlan);

  const stewardEvidenceRelative = path.join('.atm', 'runtime', 'proposal-gated-hot-apply.json');
  const stewardApply = await runAtm([
    'broker', 'steward', 'apply',
    '--merge-plan-file', hotMergePlanPath,
    '--proposal-file', firstProposalPath,
    '--proposal-file', secondProposalPath,
    '--task', hotDisjointTaskId,
    '--actor', 'coordinator-2',
    '--scope-file', hotSharedFile,
    '--evidence-out', stewardEvidenceRelative
  ], tempRoot);
  check(stewardApply.exitCode === 0 && stewardApply.parsed.ok === true, `governed steward apply must succeed after proposal gating: ${JSON.stringify(stewardApply.parsed)}`);
  const stewardEvidence = (stewardApply.parsed.evidence as Record<string, unknown>)?.applyEvidence as Record<string, unknown>;
  const scopedWriteExecution = (stewardApply.parsed.evidence as Record<string, unknown>)?.scopedWriteExecution as Record<string, unknown>;
  check(scopedWriteExecution?.verdict === 'applied', 'scoped governed write execution must end in applied state');
  check((scopedWriteExecution?.handshake as Record<string, unknown>)?.brokerLane, 'scoped execution must keep broker lane handshake evidence');
  check(Array.isArray((stewardEvidence?.appliedFiles as unknown[])) && (stewardEvidence.appliedFiles as string[]).includes(hotSharedFile), 'steward apply evidence must record applied hot file');
  check(readFileSync(path.join(tempRoot, hotSharedFile), 'utf8').includes('line-19-second'), 'governed steward apply must mutate the disjoint second region');
  check(readFileSync(path.join(tempRoot, hotSharedFile), 'utf8').includes('line-03-first'), 'governed steward apply must preserve the first writer region update');

  const composeDirect = composeBrokerProposals([
    JSON.parse(readFileSync(firstProposalPath, 'utf8')),
    JSON.parse(readFileSync(secondProposalPath, 'utf8'))
  ]);
  check(composeDirect.ok === true && composeDirect.mergePlan.verdict === 'parallel-safe', 'direct compose helper must agree with CLI compose for disjoint hot regions');

  const applyEvidencePath = path.join(tempRoot, stewardEvidenceRelative);
  const applyEvidenceJson = JSON.parse(readFileSync(applyEvidencePath, 'utf8')) as Record<string, unknown>;
  const brokerOperationRun = applyEvidenceJson.brokerOperationRun as Record<string, unknown>;
  const proposalRunDir = path.join(tempRoot, 'proposal-gated-runs');
  mkdirSync(proposalRunDir, { recursive: true });
  writeJson(path.join(proposalRunDir, 'proposal-gated-hot-run.json'), brokerOperationRun);

  const collectOutputDir = path.join(tempRoot, 'proposal-gated-evidence-bundle');
  const collectResult = spawnSync(
    process.execPath,
    [
      '--strip-types',
      path.join(root, 'scripts', 'collect-broker-evidence.ts'),
      '--run-dir', proposalRunDir,
      '--team-run-dir', path.join(tempRoot, '.atm', 'runtime', 'team-runs'),
      '--output-dir', collectOutputDir,
      '--atm-root', tempRoot,
      '--task-ids', `${hotFirstTaskId},${hotDisjointTaskId}`
    ],
    { encoding: 'utf8' }
  );
  check(collectResult.status === 0, `collect-broker-evidence must succeed for proposal-gated flow: ${collectResult.stderr || collectResult.stdout}`);
  const collectedJson = JSON.parse(readFileSync(path.join(collectOutputDir, 'broker-evidence-bundle.json'), 'utf8')) as { runs?: Array<Record<string, unknown>> };
  const collectedRows = collectedJson.runs ?? [];
  check(collectedRows.some((row) => String(row.tasks ?? '').includes(hotDisjointTaskId) && String(row.lane ?? '').includes('composer-routed')), 'collect-broker-evidence must report composer-routed state for the governed second writer');
  check(collectedRows.some((row) => String(row.tasks ?? '').includes(hotFirstTaskId) && String(row.lane ?? '').includes('proposal-submitted')), 'collect-broker-evidence must report proposal-submitted state for the first hot writer');

  if (retainedArtifactsDir) {
    rmSync(retainedArtifactsDir, { recursive: true, force: true });
    mkdirSync(retainedArtifactsDir, { recursive: true });
    cpSync(collectOutputDir, path.join(retainedArtifactsDir, 'broker-evidence-bundle'), { recursive: true });
    cpSync(proposalRunDir, path.join(retainedArtifactsDir, 'broker-runs'), { recursive: true });
    cpSync(path.join(tempRoot, '.atm', 'runtime', 'team-runs'), path.join(retainedArtifactsDir, 'team-runs'), { recursive: true });
    cpSync(applyEvidencePath, path.join(retainedArtifactsDir, 'proposal-gated-hot-apply.json'));
    writeJson(path.join(retainedArtifactsDir, 'proposal-gated-summary.json'), {
      schemaId: 'atm.proposalGatedWriteAdmissionDogfood.v1',
      generatedAt: new Date().toISOString(),
      mode,
      hotFile: hotSharedFile,
      traces: {
        firstWriterAdmission: firstWriterAdmission ?? null,
        disjointLane: hotDisjointLane.evidence.admission,
        blockedLane: hotOverlapLane.evidence.admission,
        parkedLane: parkJoinLane.evidence.admission,
        sameOwnerPositiveLane: sameOwnerJoinLane.evidence.admission,
        sameOwnerNegativeLane: sameOwnerBlockLane.evidence.admission,
        sameOwnerNegativeSplitSuggestion: sameOwnerBlockLane.evidence.decision.decompositionRequest ?? null,
        scopedWriteVerdict: scopedWriteExecution?.verdict ?? null
      },
      commands: [
        'node --strip-types scripts/validate-team-brokered-write.ts --mode validate',
        'npm run validate:team-agents -- --case capture-broker-evidence',
        'node --strip-types scripts/collect-broker-evidence.ts --run-dir <bundle>/broker-runs --team-run-dir <bundle>/team-runs --output-dir <dir> --atm-root <fixture-root>'
      ],
      artifactPaths: {
        brokerEvidenceBundle: 'broker-evidence-bundle/broker-evidence-bundle.json',
        brokerEvidenceReport: 'broker-evidence-bundle/broker-evidence-bundle.md',
        brokerRunsDir: 'broker-runs',
        teamRunsDir: 'team-runs',
        applyEvidence: 'proposal-gated-hot-apply.json'
      }
    });
  }
}
