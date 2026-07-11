export interface TaskLedgerInvariantResult {
  readonly schemaId: 'atm.taskLedgerInvariantResult.v1';
  readonly ok: boolean;
  readonly code: string;
  readonly summary: string;
  readonly details: Record<string, unknown>;
}

export interface TaskLedgerInvariantEntry {
  readonly id: string;
  readonly description: string;
  readonly run: (ctx: { tempRoot: string }) => Promise<TaskLedgerInvariantResult>;
}

export const taskLedgerInvariantRegistry: readonly TaskLedgerInvariantEntry[] = [
  {
    id: 'sandbox-diagnostics-actionable',
    description: 'assertSandboxDiagnosticsAreActionable',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/sandbox-diagnostics-actionable.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'sandbox-diagnostics-actionable passed', details: {} };
    }
  },
  {
    id: 'tasks-roster-update-contract',
    description: 'assertTasksRosterUpdateContract',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/tasks-roster-update-contract.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'tasks-roster-update-contract passed', details: {} };
    }
  },
  {
    id: 'tasks-new-rejects-root-output',
    description: 'assertTasksNewRejectsRootOutput',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/tasks-new-rejects-root-output.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'tasks-new-rejects-root-output passed', details: {} };
    }
  },
  {
    id: 'taskflow-host-opener-fallback',
    description: 'assertTaskflowHostOpenerFallbackContract',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/taskflow-host-opener-fallback.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'taskflow-host-opener-fallback passed', details: {} };
    }
  },
  {
    id: 'ledger-readers-atomization',
    description: 'validateTaskLedgerReadersAtomization',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/ledger-readers-atomization.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'ledger-readers-atomization passed', details: {} };
    }
  },
  {
    id: 'planning-only-audit-boundary',
    description: 'validatePlanningOnlyLedgerAuditBoundary',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/planning-only-audit-boundary.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'planning-only-audit-boundary passed', details: {} };
    }
  },
  {
    id: 'closure-packet-dirty-tree-hygiene',
    description: 'validateClosurePacketDirtyTreeHygieneGuard',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/closure-packet-dirty-tree-hygiene.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'closure-packet-dirty-tree-hygiene passed', details: {} };
    }
  },
  {
    id: 'task-import-dispatch-metadata',
    description: 'validateTaskImportDispatchMetadataPreservation',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/task-import-dispatch-metadata.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'task-import-dispatch-metadata passed', details: {} };
    }
  },
  {
    id: 'task-import-refresh-claim-preservation',
    description: 'validateTaskImportRefreshClaimPreservation',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/task-import-refresh-claim-preservation.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'task-import-refresh-claim-preservation passed', details: {} };
    }
  },
  {
    id: 'residue-classification',
    description: 'validateTaskResidueClassification',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/residue-classification.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'residue-classification passed', details: {} };
    }
  },
  {
    id: 'taskflow-close-orchestration',
    description: 'validateTaskflowCloseOrchestration',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/taskflow-close-orchestration.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'taskflow-close-orchestration passed', details: {} };
    }
  },
  {
    id: 'emergency-use-pre-commit-audit',
    description: 'validateEmergencyUsePreCommitAudit',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/emergency-use-pre-commit-audit.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'emergency-use-pre-commit-audit passed', details: {} };
    }
  },
  {
    id: 'last-transition-hash',
    description: 'assertLastTransitionHashMatchesDisk',
    run: async (ctx) => {
      const mod = await import('../validators/task-ledger/last-transition-hash.ts');
      await mod.run(ctx.tempRoot);
      return { schemaId: 'atm.taskLedgerInvariantResult.v1', ok: true, code: 'OK', summary: 'last-transition-hash passed', details: {} };
    }
  }
];

export function listTaskLedgerInvariantIds(): readonly string[] {
  return [...taskLedgerInvariantRegistry.map((e) => e.id)].sort((a, b) => a.localeCompare(b));
}
