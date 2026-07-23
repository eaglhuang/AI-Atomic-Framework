import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from '../shared.ts';
import {
  evaluatePostComposeSemanticValidation,
  type PostComposeSemanticCandidate
} from '../../../../core/src/broker/post-compose-semantic-validation-policy.ts';

export function runPostComposeSemanticValidation(input: {
  readonly cwd: string;
  readonly candidateFile?: string | null;
  readonly candidate?: PostComposeSemanticCandidate | null;
}) {
  const candidate = resolveCandidate(input);
  const decision = evaluatePostComposeSemanticValidation(candidate);
  const ok = decision.verdict === 'pass';
  if (!ok && decision.code) {
    throw new CliError(decision.code, summarizeDecision(decision), {
      exitCode: 1,
      details: {
        decision,
        recoveryCommand: decision.recoveryCommand,
        canonicalWriteAuthorized: false
      }
    });
  }
  return makeResult({
    ok: true,
    command: 'broker',
    cwd: input.cwd,
    messages: [message('info', 'ATM_BROKER_POST_COMPOSE_SEMANTIC_VALIDATION_PASSED', 'Post-compose semantic validation passed; canonical write may proceed.')],
    evidence: { decision }
  });
}

export function inspectPostComposeSemanticValidation(input: {
  readonly cwd: string;
  readonly candidateFile?: string | null;
  readonly candidate?: PostComposeSemanticCandidate | null;
}) {
  const candidate = resolveCandidate(input);
  const decision = evaluatePostComposeSemanticValidation(candidate);
  return makeResult({
    ok: decision.verdict === 'pass',
    command: 'broker',
    cwd: input.cwd,
    messages: [
      message(
        decision.verdict === 'pass' ? 'info' : 'error',
        decision.code ?? 'ATM_BROKER_POST_COMPOSE_SEMANTIC_VALIDATION_PASSED',
        summarizeDecision(decision)
      )
    ],
    evidence: { decision }
  });
}

function resolveCandidate(input: {
  readonly cwd: string;
  readonly candidateFile?: string | null;
  readonly candidate?: PostComposeSemanticCandidate | null;
}): PostComposeSemanticCandidate {
  if (input.candidate) return input.candidate;
  if (!input.candidateFile) {
    throw new CliError('ATM_CLI_USAGE', 'broker post-compose-semantic-validation requires --candidate-file <path>', { exitCode: 2 });
  }
  const absolute = path.resolve(input.cwd, input.candidateFile);
  try {
    const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as PostComposeSemanticCandidate;
    return parsed;
  } catch (error) {
    throw new CliError(
      'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE',
      `Unable to read command-backed post-compose candidate file: ${absolute}`,
      {
        exitCode: 1,
        details: {
          candidateFile: absolute,
          cause: error instanceof Error ? error.message : String(error),
          recoveryCommand: 'node atm.mjs broker post-compose-semantic-validation --candidate-file <path> --json'
        }
      }
    );
  }
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
