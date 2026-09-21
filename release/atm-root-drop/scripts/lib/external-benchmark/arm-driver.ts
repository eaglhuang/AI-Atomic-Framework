import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BenchmarkArm, PairedRun } from './paired-executor.ts';

export interface ArmRequest {
  readonly planId: string;
  readonly pairId: string;
  readonly arm: BenchmarkArm;
  readonly order: number;
  readonly seed: string;
  /** Disposable checkout of the pinned repository commit; outside the framework repository. */
  readonly workspaceDir: string;
  readonly repository: { readonly name: string; readonly repositoryUrl: string; readonly commitSha: string };
  /** The driver resolves the sealed prompt itself; the executor only carries its digest. */
  readonly scenario: { readonly scenarioId: string; readonly promptDigest: string };
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
}

export interface ArmOutcome {
  readonly status: PairedRun['status'];
  readonly sessionId: string;
  readonly command: string;
  /** Measured usage. `null` means the driver could not measure it. */
  readonly tokens: number | null;
  readonly costUsd: number | null;
  readonly rawEvidence: Record<string, unknown>;
}

export interface ArmDriver {
  readonly id: string;
  /** Synthetic drivers never produce evidence; their packets only verify under the dry-run stage. */
  readonly synthetic: boolean;
  runArm(request: ArmRequest): Promise<ArmOutcome>;
}

export const SIMULATED_CHANGE_FILE = 'ATM_BENCHMARK_SIMULATED.txt';

/** Deterministic, cost-free driver for exercising the executor pipeline end to end. */
export function createSimulatedDriver(): ArmDriver {
  return {
    id: 'simulated',
    synthetic: true,
    async runArm(request) {
      writeFileSync(path.join(request.workspaceDir, SIMULATED_CHANGE_FILE), `${request.arm}\n${request.seed}\n`, 'utf8');
      return {
        status: 'completed',
        sessionId: `simulated-${request.seed}-${request.arm}`,
        command: `simulated:${request.arm}`,
        tokens: 0,
        costUsd: 0,
        rawEvidence: { simulated: true },
      };
    },
  };
}
