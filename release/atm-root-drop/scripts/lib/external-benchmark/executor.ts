import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ArmDriver, ArmOutcome } from './arm-driver.ts';
import {
  SIMULATED_PROVIDER,
  createPairedPacket,
  digest,
  type BenchmarkArm,
  type BenchmarkStage,
  type PairedPacket,
  type PairedRun,
} from './paired-executor.ts';

export interface TrialPlan {
  readonly schemaId: 'atm.benchmarkTrialPlan.v1';
  readonly planId: string;
  readonly stage: BenchmarkStage;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
  /** Optional sealed package version; null is retained as an explicit unavailable value. */
  readonly packageVersion?: string | null;
  readonly budget: { readonly maxTokens: number | null; readonly maxCostUsd: number | null; readonly maxWallClockMs: number | null };
  readonly repositories: ReadonlyArray<{ readonly name: string; readonly repositoryUrl: string; readonly commitSha: string }>;
  readonly scenarios: ReadonlyArray<{ readonly scenarioId: string; readonly promptDigest: string }>;
  /** Replicates per repository x scenario; even replicates run AB (atm first), odd run BA. */
  readonly pairsPerScenario: number;
}

export interface ExecuteOptions {
  readonly plan: TrialPlan;
  readonly driver: ArmDriver;
  readonly workspaceRoot: string;
  readonly sinkDir: string;
  readonly frameworkRoot: string;
}

export interface ExecutionSummary {
  readonly schemaId: 'atm.benchmarkExecutionSummary.v1';
  readonly planId: string;
  readonly stage: BenchmarkStage;
  readonly driverId: string;
  readonly synthetic: boolean;
  readonly packets: PairedPacket[];
  readonly packetRefs: string[];
  readonly cleanup: Array<{ workspace: string; removed: boolean }>;
  readonly usage: { tokens: number; costUsd: number; wallClockMs: number };
  readonly interrupted: { reason: string; pairId: string; arm: BenchmarkArm } | null;
  readonly summaryRef: string;
}

const STAGES: readonly BenchmarkStage[] = ['dry-run', 'pilot', 'formal', 'replication', 'product'];
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function positive(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validatePlan(plan: TrialPlan, driver: ArmDriver): void {
  if (plan?.schemaId !== 'atm.benchmarkTrialPlan.v1') throw new Error('trial plan must be atm.benchmarkTrialPlan.v1');
  for (const field of ['planId', 'provider', 'model', 'reasoning'] as const) {
    if (typeof plan[field] !== 'string' || plan[field].trim().length === 0) throw new Error(`trial plan ${field} is required`);
  }
  if (!STAGES.includes(plan.stage)) throw new Error(`unsupported stage ${plan.stage}`);
  if (driver.synthetic && plan.stage !== 'dry-run') throw new Error('a synthetic driver may only run the dry-run stage');
  if (!driver.synthetic && plan.stage === 'dry-run') throw new Error('the dry-run stage is reserved for synthetic drivers');
  if (!positive(plan.budget?.maxCostUsd)) throw new Error('trial plan budget.maxCostUsd must be positive');
  if (!driver.synthetic && !(positive(plan.budget.maxTokens) && positive(plan.budget.maxWallClockMs))) {
    throw new Error('a real driver requires maxTokens, maxCostUsd and maxWallClockMs');
  }
  if (!Array.isArray(plan.repositories) || plan.repositories.length === 0) throw new Error('trial plan needs at least one repository');
  for (const repository of plan.repositories) {
    if (!COMMIT.test(repository.commitSha)) throw new Error(`repository ${repository.name} must pin a full commit sha`);
  }
  if (!Array.isArray(plan.scenarios) || plan.scenarios.length === 0) throw new Error('trial plan needs at least one scenario');
  for (const scenario of plan.scenarios) {
    if (!SHA256.test(scenario.promptDigest)) throw new Error(`scenario ${scenario.scenarioId} promptDigest must be a sha256 digest`);
  }
  if (!Number.isSafeInteger(plan.pairsPerScenario) || plan.pairsPerScenario < 1) throw new Error('pairsPerScenario must be a positive integer');
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function checkout(repository: TrialPlan['repositories'][number], workspaceDir: string): string {
  try {
    execFileSync('git', ['clone', '--quiet', '--no-checkout', repository.repositoryUrl, workspaceDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    git(workspaceDir, ['checkout', '--quiet', '--detach', repository.commitSha]);
  } catch (error) {
    rmSync(workspaceDir, { recursive: true, force: true });
    throw new Error(`repository ${repository.name} commit ${repository.commitSha} could not be checked out: ${String(error).slice(0, 200)}`);
  }
  return git(workspaceDir, ['rev-parse', 'HEAD']);
}

function exceededCap(plan: TrialPlan, usage: ExecutionSummary['usage']): string | null {
  if (positive(plan.budget.maxTokens) && usage.tokens > plan.budget.maxTokens) return 'budget-exceeded:tokens';
  if (positive(plan.budget.maxCostUsd) && usage.costUsd > plan.budget.maxCostUsd) return 'budget-exceeded:costUsd';
  if (positive(plan.budget.maxWallClockMs) && usage.wallClockMs > plan.budget.maxWallClockMs) return 'budget-exceeded:wallClockMs';
  return null;
}

export async function executeTrialPlan(options: ExecuteOptions): Promise<ExecutionSummary> {
  const { plan, driver, frameworkRoot } = options;
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const sinkDir = path.resolve(options.sinkDir);
  if (isInside(frameworkRoot, workspaceRoot)) throw new Error('workspaceRoot must be outside the framework repository');
  if (isInside(frameworkRoot, sinkDir)) throw new Error('sinkDir must be outside the framework repository');
  validatePlan(plan, driver);

  // Logical identifiers can be supplied by an external preregistration and
  // are not bounded by the host filesystem. Keep the sink directory compact;
  // the full planId remains in every JSON record and summary.
  const planDir = `plan-${digest(plan.planId).slice('sha256:'.length, 'sha256:'.length + 16)}`;
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(path.join(sinkDir, planDir), { recursive: true });
  const writeSink = (relative: string, value: unknown): string => {
    const target = path.join(sinkDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return `sink:${relative.split(path.sep).join('/')}`;
  };

  const packets: PairedPacket[] = [];
  const packetRefs: string[] = [];
  const cleanup: ExecutionSummary['cleanup'] = [];
  const usage = { tokens: 0, costUsd: 0, wallClockMs: 0 };
  let interrupted: ExecutionSummary['interrupted'] = null;
  let pairOrdinal = 0;

  outer:
  for (const repository of plan.repositories) {
    for (const scenario of plan.scenarios) {
      for (let replicate = 0; replicate < plan.pairsPerScenario; replicate += 1) {
        const pairId = `${plan.planId}:${repository.name}:${scenario.scenarioId}:${replicate}`;
        const compactPairId = pairOrdinal;
        pairOrdinal += 1;
        const pairDir = path.join(planDir, `pair-${compactPairId}`);
        const seed = digest(`${plan.planId}|${pairId}`).slice('sha256:'.length, 'sha256:'.length + 16);
        const arms: BenchmarkArm[] = replicate % 2 === 0 ? ['atm', 'baseline'] : ['baseline', 'atm'];
        const runs: PairedRun[] = [];
        for (const [index, arm] of arms.entries()) {
          const order = index + 1;
          // Keep transient checkout paths short on Windows. The full pair ID
          // remains in the raw sink record and packet refs; it must not be
          // encoded into a filesystem path where long plan/repository names
          // can exceed MAX_PATH before the arm even starts.
          const workspaceDir = path.join(workspaceRoot, `pair-${compactPairId}-${arm}`);
          if (existsSync(workspaceDir)) throw new Error(`workspace ${workspaceDir} already exists; refusing to reuse state`);
          const headSha = checkout(repository, workspaceDir);
          const startedAt = new Date().toISOString();
          const started = performance.now();
          let outcome: ArmOutcome | null = null;
          let driverError: string | null = null;
          let gitStatus = '';
          let gitDiffStat = '';
          try {
            outcome = await driver.runArm({
              planId: plan.planId, pairId, arm, order, seed, workspaceDir, repository, scenario,
              provider: plan.provider, model: plan.model, reasoning: plan.reasoning,
            });
            gitStatus = git(workspaceDir, ['status', '--porcelain', '--untracked-files=all']);
            gitDiffStat = git(workspaceDir, ['diff', '--stat']);
          } catch (error) {
            driverError = String(error).slice(0, 500);
          } finally {
            rmSync(workspaceDir, { recursive: true, force: true });
            cleanup.push({ workspace: workspaceDir, removed: !existsSync(workspaceDir) });
          }
          const wallClockMs = Math.round(performance.now() - started);
          usage.wallClockMs += wallClockMs;
          if (!outcome) {
            interrupted = { reason: `driver-error:${driverError}`, pairId, arm };
            break outer;
          }
          const telemetry = outcome.telemetry ?? {
            completion: null,
            completionEvidence: null,
            humanMinutes: null,
            humanIntervals: null,
            retries: null,
            repairTimeMs: null,
            repairTimestamps: null,
            unavailableReasons: ['driver-did-not-supply-canonical-telemetry'],
          };
          const unavailableReasons = [
            ...telemetry.unavailableReasons,
            ...(plan.packageVersion == null ? ['package-version-unavailable'] : []),
          ];
          const rawRef = writeSink(path.join(pairDir, `${arm}.json`), {
            schemaId: 'atm.benchmarkArmRawEvidence.v1',
            planId: plan.planId, pairId, arm, order, seed, driverId: driver.id, synthetic: driver.synthetic,
            workspaceDir, repositoryUrl: repository.repositoryUrl, commitSha: repository.commitSha, headSha,
            gitStatus, gitDiffStat, startedAt, completedAt: new Date().toISOString(), wallClockMs,
            status: outcome.status, sessionId: outcome.sessionId, command: outcome.command,
            provider: plan.provider, model: plan.model, reasoning: plan.reasoning,
            packageVersion: plan.packageVersion ?? null, promptDigest: scenario.promptDigest,
            tokens: outcome.tokens, costUsd: outcome.costUsd,
            telemetry: { ...telemetry, unavailableReasons },
            driverEvidence: outcome.rawEvidence,
          });
          runs.push({
            pairId,
            runId: `${pairId}:${arm}`,
            arm,
            order,
            seed,
            provider: driver.synthetic ? SIMULATED_PROVIDER : plan.provider,
            model: plan.model,
            reasoning: plan.reasoning,
            budget: plan.budget.maxCostUsd as number,
            promptDigest: scenario.promptDigest,
            repoDigest: digest({ repositoryUrl: repository.repositoryUrl, commitSha: repository.commitSha }),
            sessionId: outcome.sessionId,
            command: outcome.command,
            rawRef,
            status: outcome.status,
            ...(driver.synthetic ? { synthetic: true } : {}),
          });
          if (!driver.synthetic && (outcome.tokens === null || outcome.costUsd === null)) {
            interrupted = { reason: 'usage-unmeasured', pairId, arm };
            break outer;
          }
          usage.tokens += outcome.tokens ?? 0;
          usage.costUsd += outcome.costUsd ?? 0;
          const exceeded = exceededCap(plan, usage);
          if (exceeded) {
            interrupted = { reason: exceeded, pairId, arm };
            if (runs.length === 2) {
              const packet = createPairedPacket(plan.stage, runs);
              packets.push(packet);
              packetRefs.push(writeSink(path.join(pairDir, 'packet.json'), packet));
            }
            break outer;
          }
        }
        const packet = createPairedPacket(plan.stage, runs);
        packets.push(packet);
        packetRefs.push(writeSink(path.join(pairDir, 'packet.json'), packet));
      }
    }
  }

  const summaryBody = {
    schemaId: 'atm.benchmarkExecutionSummary.v1' as const,
    planId: plan.planId,
    stage: plan.stage,
    driverId: driver.id,
    synthetic: driver.synthetic,
    packetRefs,
    cleanup,
    usage,
    interrupted,
  };
  const summaryRef = writeSink(path.join(planDir, 'summary.json'), summaryBody);
  return { ...summaryBody, packets, summaryRef };
}
