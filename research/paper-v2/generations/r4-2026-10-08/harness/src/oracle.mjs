// C3 — Independent oracle: effect_id + final file bytes (not marker-substring alone,
// and never ATM steward_verdict as the correctness judge).
// Spec: METRIC_DEFINITIONS.md §1.5 correct completion; §0 logical_id.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { agentForSlot } from './scenario.mjs';
import { markerFor } from './util.mjs';

export const ORACLE_VERSION = 'c3-effect-bytes-v1';

/** sha256 of file bytes (utf8 text files in the fixture). */
export function digestText(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Pre-register expected effects from generated scenarios (method-independent).
 * effect_id is stable; token is the unique payload substring; exact_line is the
 * full inserted comment line agents write under current harness writers.
 */
export function buildExpectedEffects(scenarios, opts = {}) {
  const prefix = opts.comment_prefix ?? '//';
  const effects = [];
  for (const s of scenarios) {
    for (const it of s.intents) {
      const agent = agentForSlot(it.agent_slot);
      const token = markerFor(it.intent_id); // e.g. "atm-edit s42-t000-i0" (payload still keyed by intent_id)
      const exact_line = `${prefix} ${token} by ${agent.agent_id}`;
      const logical_id = it.logical_id ?? it.intent_id; // prefer pre-registered logical_id
      effects.push({
        logical_id,
        intent_id: it.intent_id,
        path: it.path,
        region: it.region,
        effect_id: `eff:${it.intent_id}`,
        token,
        exact_line,
        agent_id: agent.agent_id,
        agent_slot: it.agent_slot,
        eligible: true, // pre-registered; not derived from ATM accept/reject
        trial_id: it.trial_id,
        scenario_id: s.scenario_id,
        temperature: it.hot_or_cold_hint,
      });
    }
  }
  return effects;
}

export function writeExpectedEffects(filePath, effects, meta = {}) {
  mkdirSync(dirname(filePath), { recursive: true });
  const doc = {
    schema: 'atm-bench.expected_effects.v1',
    oracle_version: ORACLE_VERSION,
    ...meta,
    n_effects: effects.length,
    effects,
  };
  writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

export function loadExpectedEffects(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  while (from < haystack.length) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    n += 1;
    from = i + needle.length;
  }
  return n;
}

/**
 * Optional region check: effect line should sit between // <region:R> and // </region:R>.
 * Returns 'inside' | 'outside' | 'region_missing' | 'absent'.
 */
export function locateInRegion(content, region, exact_line, prefix = '//') {
  if (!content.includes(exact_line) && !content.includes(exact_line.trimEnd())) {
    // also allow token-only locate
    return 'absent';
  }
  const open = `${prefix} <region:${region}>`;
  const close = `${prefix} </region:${region}>`;
  const o = content.indexOf(open);
  const c = content.indexOf(close);
  if (o < 0 || c < 0 || c < o) return 'region_missing';
  const idx = content.indexOf(exact_line);
  if (idx < 0) return 'absent';
  if (idx > o && idx < c) return 'inside';
  return 'outside';
}

/**
 * Classify one logical effect against final worktree bytes + terminal harness outcome.
 *
 * oracle_verdict:
 *   correct | lost | duplicate | misplaced | blocked_absent | blocked_leak |
 *   unexpected_write | absent_uncommitted | unresolved
 *
 * Does NOT consult ATM steward_verdict for correctness (pass as diagnostic only).
 */
export function classifyEffect({ effect, content, terminal_outcome, comment_prefix = '//' }) {
  const exactCount = countOccurrences(content, effect.exact_line);
  // Token is unique per intent; prefer exact_line, fall back to token if writers diverge on agent suffix.
  const tokenCount = countOccurrences(content, effect.token);
  const count = exactCount > 0 ? exactCount : tokenCount;
  const matched_via = exactCount > 0 ? 'exact_line' : (tokenCount > 0 ? 'token' : 'absent');
  const region_loc = count > 0
    ? locateInRegion(content, effect.region, exactCount > 0 ? effect.exact_line : effect.token, comment_prefix)
    : 'absent';

  const committed = terminal_outcome === 'commit';
  const blocked = terminal_outcome === 'blocked';
  const uncommitted = !committed; // reject|timeout|error|blocked|missing

  let oracle_verdict;
  let reason_code;
  let outcome; // backward-compat test_pass | test_fail

  if (terminal_outcome == null) {
    oracle_verdict = 'unresolved';
    reason_code = 'no_terminal_decision';
    outcome = 'test_fail';
  } else if (committed) {
    if (count === 1 && (region_loc === 'inside' || region_loc === 'region_missing')) {
      // region_missing: still correct on presence/uniqueness; region tags absent is fixture bug
      oracle_verdict = 'correct';
      reason_code = region_loc === 'inside' ? 'effect_present_in_region' : 'effect_present';
      outcome = 'test_pass';
    } else if (count === 1 && region_loc === 'outside') {
      oracle_verdict = 'misplaced';
      reason_code = 'effect_outside_region';
      outcome = 'test_fail';
    } else if (count === 0) {
      oracle_verdict = 'lost';
      reason_code = 'lost_update';
      outcome = 'test_fail';
    } else {
      oracle_verdict = 'duplicate';
      reason_code = 'effect_duplicate';
      outcome = 'test_fail';
    }
  } else if (blocked) {
    if (count === 0) {
      oracle_verdict = 'blocked_absent';
      reason_code = 'steward_blocked_absent';
      outcome = 'test_pass'; // fail-closed: correct absence
    } else {
      oracle_verdict = 'blocked_leak';
      reason_code = 'blocked_but_effect_present';
      outcome = 'test_fail';
    }
  } else {
    // reject / timeout / error — should not have written
    if (count === 0) {
      oracle_verdict = 'absent_uncommitted';
      reason_code = `absent_after_${terminal_outcome}`;
      outcome = 'test_pass';
    } else {
      oracle_verdict = 'unexpected_write';
      reason_code = `write_after_${terminal_outcome}`;
      outcome = 'test_fail';
    }
  }

  return {
    logical_id: effect.logical_id,
    intent_id: effect.intent_id,
    effect_id: effect.effect_id,
    path: effect.path,
    region: effect.region,
    eligible: effect.eligible !== false,
    terminal_outcome: terminal_outcome ?? null,
    occurrence_count: count,
    matched_via,
    region_loc,
    oracle_verdict,
    reason_code,
    outcome,
    // diagnostics only — not used for verdict:
    exact_line: effect.exact_line,
    token: effect.token,
  };
}

/**
 * Run oracle over all pre-registered effects against the final worktree.
 *
 * @param {object} input
 * @param {string} input.worktree
 * @param {object[]} input.effects  from buildExpectedEffects / expected_effects.json
 * @param {Map|Record} input.terminals  intent_id → { outcome, ...optional diagnostics }
 * @returns {{ results, summary, file_digests }}
 */
export function runOracle(input) {
  const prefix = input.comment_prefix ?? '//';
  const terminals = input.terminals instanceof Map
    ? input.terminals
    : new Map(Object.entries(input.terminals || {}));
  const fileCache = new Map();
  const file_digests = {};
  const read = (rel) => {
    if (fileCache.has(rel)) return fileCache.get(rel);
    const abs = join(input.worktree, rel);
    const text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    fileCache.set(rel, text);
    file_digests[rel] = digestText(text);
    return text;
  };

  const results = [];
  for (const effect of input.effects) {
    const content = read(effect.path);
    const term = terminals.get(effect.intent_id);
    const terminal_outcome = term?.outcome ?? null;
    const row = classifyEffect({
      effect,
      content,
      terminal_outcome,
      comment_prefix: prefix,
    });
    row.output_digest = file_digests[effect.path];
    // Attach steward diagnostics if present — never as correctness input.
    if (term?.steward_verdict != null) row.steward_verdict_diag = term.steward_verdict;
    if (term?.batch_id != null) row.batch_id = term.batch_id;
    results.push(row);
  }

  const summary = {
    oracle_version: ORACLE_VERSION,
    n_effects: results.length,
    n_eligible: results.filter((r) => r.eligible).length,
    by_verdict: {},
    correct: 0,
    lost: 0,
    blocked_absent: 0,
    duplicate: 0,
    misplaced: 0,
    blocked_leak: 0,
    unexpected_write: 0,
    absent_uncommitted: 0,
    unresolved: 0,
    test_pass: 0,
    test_fail: 0,
  };
  for (const r of results) {
    summary.by_verdict[r.oracle_verdict] = (summary.by_verdict[r.oracle_verdict] || 0) + 1;
    if (summary[r.oracle_verdict] != null) summary[r.oracle_verdict] += 1;
    if (r.outcome === 'test_pass') summary.test_pass += 1;
    else summary.test_fail += 1;
  }
  return { results, summary, file_digests };
}

/** Persist oracle summary + per-effect rows under artifacts/. */
export function writeOracleArtifacts(artifactsDir, { results, summary, file_digests }) {
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(join(artifactsDir, 'oracle_summary.json'), JSON.stringify({ summary, file_digests }, null, 2) + '\n');
  writeFileSync(
    join(artifactsDir, 'oracle_results.jsonl'),
    results.map((r) => JSON.stringify(r)).join('\n') + (results.length ? '\n' : ''),
  );
}
