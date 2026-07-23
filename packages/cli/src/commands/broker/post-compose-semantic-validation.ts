import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from '../shared.ts';
import {
  evaluatePostComposeSemanticValidation,
  toStewardSemanticAuthorizationReceipt,
  type PostComposeSemanticCandidate,
  type SemanticValidatorReceipt
} from '../../../../core/src/broker/post-compose-semantic-validation-policy.ts';

export type PostComposeCandidateDocument = PostComposeSemanticCandidate & {
  readonly executeCommands?: readonly DeclaredValidatorCommand[];
};

export interface DeclaredValidatorCommand {
  readonly validatorId: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
}

/**
 * CLI side-effect adapter for post-compose semantic validation.
 * Selects and (optionally) executes declared validators, then applies the pure
 * core policy. Core stays side-effect free; this module owns command execution.
 */
export function runPostComposeSemanticValidation(input: {
  readonly cwd: string;
  readonly candidateFile?: string | null;
  readonly candidate?: PostComposeCandidateDocument | null;
}) {
  const loaded = resolveCandidate(input);
  const candidate = maybeExecuteDeclaredValidators(input.cwd, loaded);
  const decision = evaluatePostComposeSemanticValidation(candidate);
  const stewardAuthorization = toStewardSemanticAuthorizationReceipt({
    candidateDigest: candidate.candidateDigest,
    decision
  });
  const ok = decision.verdict === 'pass' && stewardAuthorization.ok;
  if (!ok && decision.code) {
    throw new CliError(decision.code, summarizeDecision(decision), {
      exitCode: 1,
      details: {
        decision,
        stewardAuthorization,
        recoveryCommand: decision.recoveryCommand,
        canonicalWriteAuthorized: false,
        canonicalWriteCount: 0
      }
    });
  }
  return makeResult({
    ok: true,
    command: 'broker',
    cwd: input.cwd,
    messages: [message('info', 'ATM_BROKER_POST_COMPOSE_SEMANTIC_VALIDATION_PASSED', 'Post-compose semantic validation passed; canonical write may proceed.')],
    evidence: {
      decision,
      stewardAuthorization,
      canonicalWriteAuthorized: true,
      canonicalWriteCount: 0
    }
  });
}

export function inspectPostComposeSemanticValidation(input: {
  readonly cwd: string;
  readonly candidateFile?: string | null;
  readonly candidate?: PostComposeCandidateDocument | null;
}) {
  const loaded = resolveCandidate(input);
  const candidate = maybeExecuteDeclaredValidators(input.cwd, loaded);
  const decision = evaluatePostComposeSemanticValidation(candidate);
  const stewardAuthorization = toStewardSemanticAuthorizationReceipt({
    candidateDigest: candidate.candidateDigest,
    decision
  });
  return makeResult({
    ok: decision.verdict === 'pass' && stewardAuthorization.ok,
    command: 'broker',
    cwd: input.cwd,
    messages: [
      message(
        decision.verdict === 'pass' ? 'info' : 'error',
        decision.code ?? 'ATM_BROKER_POST_COMPOSE_SEMANTIC_VALIDATION_PASSED',
        summarizeDecision(decision)
      )
    ],
    evidence: { decision, stewardAuthorization, canonicalWriteCount: 0 }
  });
}

function resolveCandidate(input: {
  readonly cwd: string;
  readonly candidateFile?: string | null;
  readonly candidate?: PostComposeCandidateDocument | null;
}): PostComposeCandidateDocument {
  if (input.candidate) return input.candidate;
  if (!input.candidateFile) {
    throw new CliError('ATM_CLI_USAGE', 'broker post-compose-semantic-validation requires --candidate-file <path>', { exitCode: 2 });
  }
  const absolute = path.resolve(input.cwd, input.candidateFile);
  try {
    return JSON.parse(readFileSync(absolute, 'utf8')) as PostComposeCandidateDocument;
  } catch (error) {
    throw new CliError(
      'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE',
      `Unable to read command-backed post-compose candidate file: ${absolute}`,
      {
        exitCode: 1,
        details: {
          candidateFile: absolute,
          cause: error instanceof Error ? error.message : String(error),
          recoveryCommand: 'node atm.mjs broker post-compose-semantic-validation --candidate-file <path> --json',
          canonicalWriteCount: 0
        }
      }
    );
  }
}

function maybeExecuteDeclaredValidators(
  cwd: string,
  candidate: PostComposeCandidateDocument
): PostComposeSemanticCandidate {
  const existing = candidate.validatorReceipts ?? [];
  const commands = candidate.executeCommands ?? [];
  if (commands.length === 0) {
    return candidate;
  }
  const covered = new Set(existing.map((receipt) => receipt.validatorId));
  const executed: SemanticValidatorReceipt[] = [...existing];
  for (const command of commands) {
    if (covered.has(command.validatorId)) continue;
    executed.push(runOneDeclaredValidator(cwd, command));
    covered.add(command.validatorId);
  }
  return {
    ...candidate,
    validatorReceipts: executed
  };
}

function runOneDeclaredValidator(cwd: string, command: DeclaredValidatorCommand): SemanticValidatorReceipt {
  const workCwd = path.resolve(cwd, command.cwd ?? '.');
  const result = spawnSync(command.executable, [...command.argv], {
    cwd: workCwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
  if (result.error) {
    return {
      validatorId: command.validatorId,
      outcome: 'unavailable',
      commandBacked: false
    };
  }
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  return {
    validatorId: command.validatorId,
    outcome: exitCode === 0 ? 'pass' : 'fail',
    commandBacked: true,
    executable: command.executable,
    argv: command.argv,
    cwd: command.cwd ?? '.',
    exitCode,
    stdoutDigest: digestText(result.stdout ?? ''),
    stderrDigest: digestText(result.stderr ?? '')
  };
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function summarizeDecision(decision: ReturnType<typeof evaluatePostComposeSemanticValidation>): string {
  if (decision.verdict === 'pass') {
    return 'Post-compose semantic validation passed with command-backed validator receipts.';
  }
  if (decision.code === 'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED') {
    return `Post-compose semantic validation failed for validator(s): ${decision.failedValidatorIds.join(', ') || 'unknown'}. Canonical write is prohibited.`;
  }
  return `Post-compose semantic validation unavailable for validator(s): ${[...decision.unavailableValidatorIds, ...decision.malformedValidatorIds].join(', ') || 'unknown'}. Canonical write is prohibited.`;
}
