import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCrossTaskMutation } from '../cross-task-mutation-guard.js';
/**
 * ATM-GOV-0369 amendment 1 (absorbing ATM-GOV-0397) — ACC-2 amended and ACC-5.
 *
 * The task-history surface used to derive ownership from the task id embedded
 * in the file name: any task that had ever existed owned its own history files
 * forever. The records a close generates therefore had no governed writer at
 * all, and the refusal claimed the owner was "active" without ever reading its
 * status, claim state, or lock state.
 *
 * Ownership here now resolves through the same authority snapshot used for
 * source paths. When that snapshot says the owner is terminal, the path is
 * still not freely writable — it opens only to a writer that a governed
 * admission actually granted it to.
 */
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-terminal-entitlement-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function stage(relativePath, contents) {
    const absolute = path.join(repo, relativePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
    execFileSync('git', ['add', '--', relativePath], { cwd: repo, stdio: 'ignore' });
}
function writeTask(taskId, options) {
    writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
        workItemId: taskId,
        status: options.status,
        claim: options.claimState
            ? { actorId: 'owner-actor', state: options.claimState, files: [`.atm/history/evidence/${taskId}.*`] }
            : null
    });
}
function writeLock(workItemId, options) {
    const now = new Date().toISOString();
    writeJson(path.join(repo, '.atm', 'runtime', 'locks', `${workItemId}.lock.json`), {
        schemaId: 'atm.governanceScopeLock',
        workItemId,
        actorId: 'writer-actor',
        lockedBy: 'writer-actor',
        lockedAt: now,
        heartbeatAt: now,
        ttlSeconds: 1800,
        released: options.released,
        status: options.released ? 'released' : 'active',
        linkedTaskId: options.linkedTaskId ?? null,
        files: [...options.files]
    });
}
const OWNER = 'ATM-GOV-9001';
const RESIDUE = `.atm/history/evidence/${OWNER}.bundle-manifest.json`;
const WRITER = 'ATM-FRAMEWORK-TEMP-writer-actor-lane-lane-9999';
const SUCCESSOR = 'ATM-GOV-9002';
writeTask(SUCCESSOR, { status: 'running', claimState: 'active' });
stage(RESIDUE, '{"seed":true}\n');
// caseId: test_atm_gov_0369_foreign_task_history_still_blocks
// An owner with live write authority keeps its history protected. This is the
// half of the original contract that must not regress.
{
    writeTask(OWNER, { status: 'running', claimState: 'active' });
    writeLock(OWNER, { released: false, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(WRITER, { released: false, files: [RESIDUE], linkedTaskId: SUCCESSOR });
    const block = detectCrossTaskMutation(repo, WRITER, 'pre-commit');
    assert(block, 'a live owner must still block another writer');
    assert.equal(block.conflictTaskId, OWNER);
    const conflict = block.conflicts.find((entry) => entry.surface === 'task-history');
    assert(conflict, 'the block must be reported on the task-history surface');
    assert.equal(conflict.ownershipState, 'live', 'a refusal may describe ownership only as what the authority snapshot actually reported');
}
// caseId: test_atm_gov_0369_terminal_history_needs_reconciliation_entitlement
// A terminal owner plus a writer with no admitted scope for the path: still
// blocked. Terminal must not mean freely writable.
{
    writeTask(OWNER, { status: 'done', claimState: 'released' });
    writeLock(OWNER, { released: true, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(WRITER, { released: false, files: ['packages/core/src/unrelated.ts'], linkedTaskId: SUCCESSOR });
    const block = detectCrossTaskMutation(repo, WRITER, 'pre-commit');
    assert(block, 'a terminal owner must still block a writer holding no entitlement');
    const conflict = block.conflicts.find((entry) => entry.surface === 'task-history');
    assert(conflict, 'the refusal must still name the task-history surface');
    assert.equal(conflict.ownershipState, 'terminal-unentitled', 'the refusal must say the owner is terminal and the writer unentitled, not that the owner is active');
}
// The entitled successor is admitted: its own governed admission covers the
// exact path and declares the card it is answering for.
{
    writeTask(OWNER, { status: 'done', claimState: 'released' });
    writeLock(OWNER, { released: true, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(WRITER, { released: false, files: [RESIDUE], linkedTaskId: SUCCESSOR });
    assert.equal(detectCrossTaskMutation(repo, WRITER, 'pre-commit'), null, 'a writer admitted for this exact path and bound to a live successor card must be let through');
}
// Entitlement is a governed grant, not a resemblance. A blanket scope must not
// confer it, or every framework claim would silently own every closed task.
{
    writeTask(OWNER, { status: 'done', claimState: 'released' });
    writeLock(OWNER, { released: true, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(WRITER, { released: false, files: ['.atm/**'], linkedTaskId: SUCCESSOR });
    const block = detectCrossTaskMutation(repo, WRITER, 'pre-commit');
    assert(block, 'an unbounded scope must not be read as an entitlement to a terminal task history');
}
// A writer whose own claim is dead carries no entitlement, however well its
// scope matches.
{
    writeTask(OWNER, { status: 'done', claimState: 'released' });
    writeLock(OWNER, { released: true, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(WRITER, { released: true, files: [RESIDUE], linkedTaskId: SUCCESSOR });
    assert(detectCrossTaskMutation(repo, WRITER, 'pre-commit'), 'a released writer claim cannot entitle anything');
}
// The declared successor must itself be a live card. A reconciliation answers
// to something; pointing at a closed card answers to nothing.
{
    writeTask(OWNER, { status: 'done', claimState: 'released' });
    writeTask('ATM-GOV-9003', { status: 'done', claimState: 'released' });
    writeLock(OWNER, { released: true, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(WRITER, { released: false, files: [RESIDUE], linkedTaskId: 'ATM-GOV-9003' });
    assert(detectCrossTaskMutation(repo, WRITER, 'pre-commit'), 'an entitlement bound to a terminal successor card must not be honoured');
}
/**
 * The three cases below separate what the entitlement rule must keep apart. A
 * proposal reviewed on 2026-08-16 would have short-circuited the rule to admit
 * any writer whose own work-item id names a live card, on the reasoning that
 * such a card is already its own review surface. These cases pin the contract
 * ACC-5 actually states — admitted paths *and* a declared answerable task — so
 * that adopting that reasoning has to be a recorded amendment rather than a
 * silent relaxation.
 */
// caseId: test_atm_gov_0369_live_card_writer_still_declares_its_reconciliation
// A writer that is itself a live card, admitted for the exact bounded path, but
// declaring nothing. Scope admission proves which bytes were considered; it
// does not record on whose behalf they are being rewritten. Being live is not
// the same as being answerable, so this stays blocked.
{
    const LIVE_CARD_WRITER = 'ATM-GOV-9004';
    writeTask(OWNER, { status: 'done', claimState: 'released' });
    writeTask(LIVE_CARD_WRITER, { status: 'running', claimState: 'active' });
    writeLock(OWNER, { released: true, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(LIVE_CARD_WRITER, { released: false, files: [RESIDUE], linkedTaskId: null });
    const block = detectCrossTaskMutation(repo, LIVE_CARD_WRITER, 'pre-commit');
    assert(block, 'a live card admitted for the path but declaring no reconciliation target must not be entitled by its own liveness');
    const conflict = block.conflicts.find((entry) => entry.surface === 'task-history');
    assert(conflict, 'the refusal must name the task-history surface');
    assert.equal(conflict.ownershipState, 'terminal-unentitled', 'the owner is terminal and the writer unentitled; the refusal may not describe either state it did not read');
}
// caseId: test_atm_gov_0369_framework_writer_without_linkage_blocks
// The same omission from a framework temporary claim. A framework work item can
// never resemble a card id, so this path is the one that made the old rule
// unsatisfiable; it must open on a declared linkage, and on nothing else.
{
    writeTask(OWNER, { status: 'done', claimState: 'released' });
    writeLock(OWNER, { released: true, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(WRITER, { released: false, files: [RESIDUE], linkedTaskId: null });
    assert(detectCrossTaskMutation(repo, WRITER, 'pre-commit'), 'a live framework claim admitted for the path but linked to no card carries no entitlement');
}
// caseId: test_atm_gov_0369_declared_successor_reconciliation_admitted
// The lawful shape, stated once more against a live card writer so the previous
// two cases fail for the reason claimed — the missing declaration — rather than
// because a live card writer is refused on principle.
{
    const LIVE_CARD_WRITER = 'ATM-GOV-9004';
    writeTask(OWNER, { status: 'done', claimState: 'released' });
    writeTask(LIVE_CARD_WRITER, { status: 'running', claimState: 'active' });
    writeLock(OWNER, { released: true, files: [`.atm/history/evidence/${OWNER}.*`] });
    writeLock(LIVE_CARD_WRITER, { released: false, files: [RESIDUE], linkedTaskId: SUCCESSOR });
    assert.equal(detectCrossTaskMutation(repo, LIVE_CARD_WRITER, 'pre-commit'), null, 'admitted for the exact path and declaring a live card to answer for it is the entitled shape');
}
console.log('[cross-task-mutation-terminal-entitlement] ok');
