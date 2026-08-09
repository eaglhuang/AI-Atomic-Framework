/**
 * Governed repair for an imported planning-source seal whose card was
 * untracked at import time and was later committed without content changes.
 * This surface repairs storage identity only; all other drift fails closed.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, type CommandResult } from '../shared.ts';
import { resolvePlanAbsoluteFromStored } from '../planning-repo-root.ts';
import { buildPlanningSourceSeal, type PlanningSourceSeal } from './import-task.ts';
import { classifyPlanningSourceSeal, type PlanningSourceSealClassification } from './planning-source-seal-policy.ts';
import { taskPathFor } from './task-file-io-helpers.ts';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.ts';

export type SealPlanSourceOptions = { readonly cwd: string; readonly taskId: string; readonly dryRun: boolean; readonly write: boolean; readonly actorId: string | null };
export type SealPlanSourceProposal = { readonly taskId: string; readonly taskPath: string; readonly planPath: string; readonly previousPlanningCommitSha: string | null; readonly nextPlanningCommitSha: string | null; readonly classification: PlanningSourceSealClassification | null; readonly decision: 'seal' | 'skip-no-seal' | 'skip-no-change' | 'refuse-drift' | 'refuse-source-missing'; readonly reason: string };

function parseOptions(argv: readonly string[]): SealPlanSourceOptions {
  let cwd = process.cwd(); let taskId: string | null = null; let dryRun = false; let write = false; let actorId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--cwd') { cwd = path.resolve(argv[++index] ?? cwd); continue; }
    if (token === '--task') { taskId = String(argv[++index] ?? '').trim() || null; continue; }
    if (token === '--dry-run') { dryRun = true; continue; }
    if (token === '--write') { write = true; continue; }
    if (token === '--actor') { actorId = String(argv[++index] ?? '').trim() || null; continue; }
    if (token === '--json') continue;
    if (token === '--help' || token === '-h') throw new CliError('ATM_CLI_USAGE', 'tasks seal-plan-source --task <id> [--dry-run|--write] [--actor <id>] [--json]', { exitCode: 2 });
    throw new CliError('ATM_CLI_USAGE', `tasks seal-plan-source unrecognized argument: ${token}`, { exitCode: 2 });
  }
  if (!taskId) throw new CliError('ATM_CLI_USAGE', 'tasks seal-plan-source requires --task <id>.', { exitCode: 2 });
  if (dryRun === write) throw new CliError('ATM_CLI_USAGE', 'tasks seal-plan-source requires exactly one of --dry-run or --write.', { exitCode: 2 });
  if (write && !(actorId ?? process.env.ATM_ACTOR_ID?.trim())) throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks seal-plan-source --write requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
  return { cwd, taskId, dryRun, write, actorId: actorId ?? process.env.ATM_ACTOR_ID?.trim() ?? null };
}

function readSeal(document: Record<string, unknown>): PlanningSourceSeal | null {
  const source = document.source;
  const raw = source && typeof source === 'object' && !Array.isArray(source) ? (source as Record<string, unknown>).planningSourceSeal : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.schemaId !== 'atm.planningSourceSeal.v1' || typeof value.repoIdentity !== 'string' || typeof value.repoRoot !== 'string' || typeof value.taskCardPath !== 'string' || typeof value.contentDigest !== 'string' || typeof value.sealedAt !== 'string') return null;
  return { schemaId: 'atm.planningSourceSeal.v1', repoIdentity: value.repoIdentity, repoRoot: value.repoRoot, taskCardPath: value.taskCardPath, planningCommitSha: typeof value.planningCommitSha === 'string' ? value.planningCommitSha : null, contentDigest: value.contentDigest, amendmentEpoch: Number(value.amendmentEpoch ?? 0), sealedAt: value.sealedAt };
}

function buildProposal(options: SealPlanSourceOptions): { readonly taskPath: string; readonly taskDocument: Record<string, unknown>; readonly proposal: SealPlanSourceProposal } {
  const taskPath = taskPathFor(options.cwd, options.taskId);
  if (!existsSync(taskPath)) throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, { exitCode: 2, details: { taskId: options.taskId, taskPath } });
  const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
  const seal = readSeal(taskDocument);
  if (!seal) return { taskPath, taskDocument, proposal: { taskId: options.taskId, taskPath, planPath: '', previousPlanningCommitSha: null, nextPlanningCommitSha: null, classification: null, decision: 'skip-no-seal', reason: 'task has no readable planning-source seal' } };
  const source = taskDocument.source as Record<string, unknown>;
  const planPath = typeof source.planPath === 'string' ? source.planPath : seal.taskCardPath;
  const planAbsolute = resolvePlanAbsoluteFromStored(options.cwd, planPath);
  if (!existsSync(planAbsolute)) return { taskPath, taskDocument, proposal: { taskId: options.taskId, taskPath, planPath, previousPlanningCommitSha: seal.planningCommitSha, nextPlanningCommitSha: null, classification: null, decision: 'refuse-source-missing', reason: `planning source does not exist: ${planAbsolute}` } };
  const current = buildPlanningSourceSeal({ cwd: options.cwd, planAbsolute, sealedAt: seal.sealedAt });
  const classification = classifyPlanningSourceSeal({ sealed: seal, current, sourcePlanPath: planPath });
  const decision = classification.status === 'benign-seal-upgrade' ? 'seal' : classification.status === 'match' ? 'skip-no-change' : 'refuse-drift';
  return { taskPath, taskDocument, proposal: { taskId: options.taskId, taskPath, planPath, previousPlanningCommitSha: seal.planningCommitSha, nextPlanningCommitSha: current.planningCommitSha, classification, decision, reason: classification.status === 'benign-seal-upgrade' ? 'content and planning identity match; only the missing commit identity is being sealed' : classification.diagnostics.messages.join(' ') } };
}

export async function runTasksSealPlanSource(argv: string[]): Promise<CommandResult> {
  const options = parseOptions(argv); const { taskPath, taskDocument, proposal } = buildProposal(options);
  if (options.write && proposal.decision === 'refuse-drift') throw new CliError('ATM_PLANNING_SOURCE_SEAL_REPAIR_REFUSED', `tasks seal-plan-source refused ${options.taskId}: ${proposal.reason}`, { exitCode: 1, details: { proposal } });
  if (options.write && proposal.decision === 'refuse-source-missing') throw new CliError('ATM_PLANNING_SOURCE_SEAL_REPAIR_SOURCE_MISSING', proposal.reason, { exitCode: 1, details: { proposal } });
  if (options.dryRun || proposal.decision !== 'seal') return makeResult({ ok: true, command: 'tasks seal-plan-source', cwd: options.cwd, messages: [message(proposal.decision === 'refuse-drift' ? 'warn' : 'info', 'ATM_TASKS_SEAL_PLAN_SOURCE_DRY_RUN', `Planning-source seal proposal for ${options.taskId}: ${proposal.decision}.`)], evidence: { action: 'seal-plan-source', dryRun: options.dryRun, proposal } });
  const source = taskDocument.source as Record<string, unknown>; const seal = source.planningSourceSeal as Record<string, unknown>; source.planningSourceSeal = { ...seal, planningCommitSha: proposal.nextPlanningCommitSha };
  writeTaskDocumentWithTransition({ cwd: options.cwd, taskPath, taskId: options.taskId, taskDocument, action: 'seal-plan-source', actorId: options.actorId, previousStatus: typeof taskDocument.status === 'string' ? taskDocument.status : null, command: `node atm.mjs tasks seal-plan-source --task ${options.taskId} --write` });
  return makeResult({ ok: true, command: 'tasks seal-plan-source', cwd: options.cwd, messages: [message('info', 'ATM_TASKS_SEAL_PLAN_SOURCE_WRITTEN', `Planning-source commit identity sealed for ${options.taskId}.`)], evidence: { action: 'seal-plan-source', dryRun: false, proposal, updated: { planningCommitSha: proposal.nextPlanningCommitSha }, protectedFields: ['status', 'claim', 'owner', 'scopePaths', 'amendmentEpoch'] } });
}
