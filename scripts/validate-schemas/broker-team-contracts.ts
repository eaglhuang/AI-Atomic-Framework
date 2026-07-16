import { ajv, fail, formatErrors } from './context.ts';

export function validateBrokerAndTeamContracts() {
  const brokerMutationRequestSchema = ajv.getSchema('broker-mutation-request');
  if (!brokerMutationRequestSchema) {
    fail('broker mutation request schema must be registered');
  } else {
    const transactionLinkedRequest = {
      schemaId: 'atm.mutationRequest.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'schema transaction linkage fixture' },
      requestId: 'req-schema-transaction-link',
      actorId: 'schema-validator',
      taskId: 'TASK-TEAM-SCHEMA-TXN',
      transactionId: 'txn-schema-single',
      transactionIds: ['txn-schema-camel'],
      transaction_ids: ['txn-schema-snake'],
      filePath: 'docs/broker-transaction-link.md',
      op: 'append',
      target: 'EOF',
      value: 'schema transaction linkage'
    };
    if (!brokerMutationRequestSchema(transactionLinkedRequest)) {
      fail(`broker mutation request must accept transaction linkage fields: ${formatErrors(brokerMutationRequestSchema.errors)}`);
    }
  }
  
  const teamBrokerWriteTransactionSchema = ajv.getSchema('team-broker-write-transaction');
  const teamBrokerLaneSchema = ajv.getSchema('team-broker-lane');
  const teamBrokerRuntimeActivationSchema = ajv.getSchema('team-broker-runtime-activation');
  const teamRuntimeContractSchema = ajv.getSchema('team-runtime-contract');
  const cliResultSchema = ajv.getSchema('cli-result');
  if (!cliResultSchema) {
    fail('cli result schema must be registered');
  } else {
    const cliResultEvidence = {
      ok: false,
      command: 'next',
      mode: 'standalone',
      cwd: 'C:/workspace/schema',
      messages: [
        {
          level: 'error',
          code: 'ATM_NEXT_CLAIM_BLOCKED',
          text: 'schema blocker',
          data: {}
        }
      ],
      evidence: {
        nextAction: {
          status: 'blocked',
          allowedCommands: ['node atm.mjs next --json'],
          blockedCommands: ['node atm.mjs next --claim --json']
        }
      },
      nextAction: {
        status: 'blocked'
      },
      userNotice: null,
      runnerMode: {
        schemaId: 'atm.runnerMode.v1',
        mode: 'source-first'
      },
      allowedCommands: ['node atm.mjs next --json'],
      blockedCommands: ['node atm.mjs next --claim --json'],
      skillGrowth: {
        schemaId: 'atm.skillGrowthHints.v1',
        categories: ['tooling-mismatch'],
        durableRule: 'Diagnose runner skew before retrying lifecycle routes.'
      },
      severity: 'blocked',
      exitCode: 1,
      blocking: true,
      diagnostics: {
        errorCodes: ['ATM_NEXT_CLAIM_BLOCKED'],
        warningCodes: [],
        infoCodes: []
      }
    };
    if (!cliResultSchema(cliResultEvidence)) {
      fail(`cli result schema must accept bridge-facing projection fields: ${formatErrors(cliResultSchema.errors)}`);
    }
  }
  if (!teamBrokerWriteTransactionSchema) {
    fail('team broker write transaction schema must be registered');
  } else {
    const transactionEvidence = {
      schemaId: 'atm.teamBrokerWriteTransaction.v1',
      transactionId: 'txn-schema-write-transaction',
      taskId: 'TASK-TEAM-SCHEMA-WRITE-TXN',
      principalId: 'schema-principal',
      actorId: 'schema-actor',
      sessionId: 'schema-session',
      instanceId: 'schema-actor@local',
      worktreeId: 'C:/workspace/schema',
      branchRef: 'main',
      baseHead: 'abc123schemahead',
      leaseEpoch: 1,
      allowedFiles: ['src/schema-target.ts'],
      readSet: ['src/schema-target.ts'],
      writeSet: ['src/schema-target.ts'],
      fileHashesBefore: {
        'src/schema-target.ts': 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      },
      brokerDecision: {
        verdict: 'parallel-safe',
        lane: 'direct-brokered',
        intentId: 'intent-schema-write-transaction',
        parallelSafetyReason: 'no-known-textual-or-resource-conflict'
      },
      admissionState: 'write-admitted',
      startedAt: '2026-06-19T00:00:00.000Z',
      expiresAt: '2026-06-19T00:30:00.000Z',
      heartbeatAt: '2026-06-19T00:00:00.000Z'
    };
    if (!teamBrokerWriteTransactionSchema(transactionEvidence)) {
      fail(`team broker write transaction schema must accept the milestone-required fields: ${formatErrors(teamBrokerWriteTransactionSchema.errors)}`);
    }
  
    if (!teamBrokerLaneSchema) {
      fail('team broker lane schema must be registered');
    } else if (!teamBrokerRuntimeActivationSchema) {
      fail('team broker runtime activation schema must be registered');
    } else {
      const brokerLaneEvidence = {
        schemaId: 'atm.teamBrokerLaneEvidence.v1',
        specVersion: '0.1.0',
        taskId: 'TASK-TEAM-SCHEMA-RUNTIME',
        actorId: 'schema-actor',
        registryPath: '.atm/runtime/write-broker.registry.json',
        writeIntent: {
          schemaId: 'atm.writeIntent.v1',
          specVersion: '0.1.0',
          migration: { strategy: 'none', fromVersion: null, notes: 'schema broker lane fixture' },
          taskId: 'TASK-TEAM-SCHEMA-RUNTIME',
          actorId: 'schema-actor',
          baseCommit: 'abc123schemahead',
          targetFiles: ['src/schema-target.ts'],
          atomRefs: [],
          sharedSurfaces: {
            generators: [],
            projections: [],
            registries: [],
            validators: [],
            artifacts: []
          },
          requestedLane: 'auto'
        },
        writeTransaction: transactionEvidence,
        decision: {
          verdict: 'parallel-safe',
          lane: 'direct-brokered',
          reason: 'schema broker lane fixture',
          conflicts: []
        },
        admission: {
          trigger: 'not-required',
          state: 'write-admitted',
          requiresProposal: false,
          summarySubmitted: true,
          hotFiles: [],
          boundedRegions: [],
          rearbitrationRequired: false,
          reason: 'schema broker lane fixture'
        },
        virtualAtomInUseRegistry: {
          schemaId: 'atm.virtualAtomInUseRegistry.v1',
          specVersion: '0.1.0',
          activeVirtualAtoms: []
        },
        chosenLane: 'direct-brokered',
        stewardId: null,
        composerPath: null,
        safeToStart: true,
        blockedReasons: []
      };
      if (!teamBrokerLaneSchema(brokerLaneEvidence)) {
        fail(`team broker lane schema must accept broker decision and write transaction evidence: ${formatErrors(teamBrokerLaneSchema.errors)}`);
      }
      const runtimeActivationEvidence = {
        schemaId: 'atm.teamBrokerRuntimeActivationHandshake.v1',
        specVersion: '0.1.0',
        taskId: 'TASK-TEAM-SCHEMA-RUNTIME',
        actorId: 'schema-actor',
        registryPath: '.atm/runtime/write-broker.registry.json',
        brokerLane: brokerLaneEvidence,
        activationState: 'activated',
        scopedWriteExecution: {
          approved: true,
          allowedFiles: ['src/schema-target.ts'],
          evidencePath: null,
          acceptedInputs: ['PatchProposal', 'MergePlan', 'StewardPlan']
        },
        runtimeBoundary: {
          gitWrite: false,
          taskLifecycle: false,
          selfClose: false
        },
        blockedReasons: []
      };
      if (!teamBrokerRuntimeActivationSchema(runtimeActivationEvidence)) {
        fail(`team broker runtime activation schema must accept broker lane and scoped boundary evidence: ${formatErrors(teamBrokerRuntimeActivationSchema.errors)}`);
      }
    }
  
    if (!teamRuntimeContractSchema) {
      fail('team runtime contract schema must be registered');
    } else {
      const runtimeContractEvidence = {
        schemaId: 'atm.teamRuntimeContract.v1',
        runtimeMode: 'broker-only',
        runtimeLanguage: 'node',
        runtimeAdapterId: 'atm.node.broker-only-fallback',
        providerId: 'local',
        sdkId: 'nodejs',
        modelId: 'provider-selected',
        agentsSpawned: false,
        executionSurface: 'broker-governance',
        selectionReason: 'broker-only selected by schema fixture',
        workerAdapter: {
          schemaId: 'atm.teamWorkerAdapterContract.v1',
          authorityBoundary: {
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false
          }
        },
        artifactHandoff: {
          schemaId: 'atm.teamArtifactHandoffContract.v1'
        },
        retryBudget: {
          schemaId: 'atm.teamRetryBudgetContract.v1',
          status: 'within-budget'
        },
        commitLane: {
          schemaId: 'atm.teamCommitLaneContract.v1',
          ownerRole: 'coordinator',
          ownerPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
          workerGitWrite: false,
          serializedBy: 'branch-commit-queue',
          lockSchemaId: 'atm.branchCommitQueueLock.v1',
          retryableCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']
        },
        brokerSubagent: {
          schemaId: 'atm.teamBrokerSubagentContract.v1',
          enabled: true,
          subagentId: 'team-broker-subagent',
          lifecycleOwner: 'atm',
          decisionSurface: 'brokerLane',
          governs: ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'],
          stewardId: 'neutral-write-steward',
          evidenceRequired: ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'],
          authorityBoundary: {
            fileWrite: false,
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false
          },
          escalationTarget: 'coordinator'
        },
        editorSubagentBridge: {
          schemaId: 'atm.teamEditorSubagentBridgeContract.v1'
        }
      };
      if (!teamRuntimeContractSchema(runtimeContractEvidence)) {
        fail(`team runtime contract schema must accept broker subagent and serialized commit lane evidence: ${formatErrors(teamRuntimeContractSchema.errors)}`);
      }
    }
  }
}
