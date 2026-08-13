// ATM-GOV-0354 — locate what a source contract actually governs.
//
// Contract anchors assert that a token still exists in the code that owns a
// behaviour. Pinning that assertion to a literal file list makes a validator go
// red when the owning module is split, and — worse — makes it stay green if the
// behaviour is deleted while a comment keeps mentioning the token elsewhere.
//
// This module answers "where does this contract live" once: callers declare the
// owning surface, and get back both the text to search and the files that text
// came from. Returning the file list is what lets a caller fail closed on an
// empty subject; a bare string cannot tell "no match" apart from "nothing read".

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const VALIDATOR_CONTRACT_SUBJECT_SCHEMA_ID = 'atm.validatorContractSubject.v1';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

export interface ValidatorContractSubject {
  readonly schemaId: typeof VALIDATOR_CONTRACT_SUBJECT_SCHEMA_ID;
  readonly declaredRoots: readonly string[];
  readonly files: readonly string[];
  readonly text: string;
}

function listSourceFilesUnder(absoluteDir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const absolute = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFilesUnder(absolute));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      found.push(absolute);
    }
  }
  return found;
}

/**
 * Resolve the source text a contract is asserted against.
 *
 * `declaredRoots` are repository-relative files or directories naming the
 * surface that owns the behaviour — not the whole repository. A token found in
 * an unrelated module is not evidence that this module still honours its
 * contract, so the caller stays responsible for declaring a tight surface.
 *
 * Throws when a declared root is missing or yields no readable source, so a
 * mistyped or deleted subject can never reduce to an empty string that
 * satisfies every anchor.
 */
export function resolveValidatorContractSubject(
  repositoryRoot: string,
  declaredRoots: readonly string[]
): ValidatorContractSubject {
  if (declaredRoots.length === 0) {
    throw new Error('validator contract subject requires at least one declared root');
  }
  const files: string[] = [];
  for (const declared of declaredRoots) {
    const absolute = path.resolve(repositoryRoot, declared);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      throw new Error(`validator contract subject root is missing: ${declared}`);
    }
    const resolved = stats.isDirectory() ? listSourceFilesUnder(absolute) : [absolute];
    if (resolved.length === 0) {
      throw new Error(`validator contract subject root contains no readable source: ${declared}`);
    }
    files.push(...resolved);
  }
  const unique = [...new Set(files)].sort();
  const text = unique.map((file) => readFileSync(file, 'utf8')).join('\n');
  if (!text.trim()) {
    throw new Error(`validator contract subject resolved to empty text: ${declaredRoots.join(', ')}`);
  }
  return {
    schemaId: VALIDATOR_CONTRACT_SUBJECT_SCHEMA_ID,
    declaredRoots: [...declaredRoots],
    files: unique.map((file) => path.relative(repositoryRoot, file).replace(/\\/g, '/')),
    text
  };
}

export interface ContractAnchor {
  /** Literal substring the contract must contain. */
  readonly token?: string;
  /** Pattern form, for contracts whose spelling is formatter-dependent (quote style, spacing). */
  readonly pattern?: RegExp;
  readonly detail: string;
}

/**
 * Report the anchors a subject does not satisfy.
 *
 * `pattern` exists because a literal like `schemaId: 'x'` also pins the quote
 * style, so a formatter run reads as a deleted contract. It is not a licence to
 * loosen an anchor: the pattern must still require the same contract, only
 * tolerate the spellings a formatter can produce.
 */
export function collectMissingContractAnchors(
  subject: ValidatorContractSubject,
  anchors: readonly ContractAnchor[]
): readonly string[] {
  return anchors
    .filter((anchor) => {
      if (anchor.pattern) return !anchor.pattern.test(subject.text);
      if (anchor.token) return !subject.text.includes(anchor.token);
      throw new Error(`contract anchor must declare a token or a pattern: ${anchor.detail}`);
    })
    .map((anchor) => anchor.detail);
}

export interface WorkflowStepLocation {
  readonly name: string;
  readonly index: number;
}

/**
 * Locate a workflow step by the command it runs rather than by its display name.
 *
 * Step names are prose and get reworded; the command is the contract. Returns
 * null when no step runs a matching command so the caller can fail closed
 * instead of comparing against a -1 that silently satisfies an ordering check.
 */
export function locateWorkflowStepByCommand(
  workflowText: string,
  commandPattern: RegExp
): WorkflowStepLocation | null {
  const stepPattern = /^\s*-\s+name:\s*(.+?)\s*$/gm;
  const steps: Array<{ name: string; index: number }> = [];
  for (const match of workflowText.matchAll(stepPattern)) {
    steps.push({ name: match[1] ?? '', index: match.index ?? 0 });
  }
  for (let position = 0; position < steps.length; position += 1) {
    const start = steps[position]!.index;
    const end = position + 1 < steps.length ? steps[position + 1]!.index : workflowText.length;
    if (commandPattern.test(workflowText.slice(start, end))) {
      return { name: steps[position]!.name, index: start };
    }
  }
  return null;
}
