// Run loop for one mode. Each agent is an independent async worker (Promise.all);
// there is no central scheduler: agents only share a wall clock (t0) and the seeded intent list.
// Contention emerges from timing; the broker (atm) or the filesystem (control) resolves it.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { MockBroker } from './mock-broker.mjs';
import { RealAtmBroker } from './real-broker.mjs';
import { BareAdmitBroker } from './bare-admit-broker.mjs';
import { ControlWriter } from './control-writer.mjs';
import { agentForSlot, scenarioHash } from './scenario.mjs';
import { applyEditSync, insertIntoRegion, jsonlSink, markerFor, sleep, slug, tsTaipei, writeText } from './util.mjs';
import { ComposeWindowManager, initWorktreeGit, makeMarkerProposal, readBaseCommit, resolveExpectedCount } from './steward-writer.mjs';
import { GitThreeWayManager } from './git-three-way.mjs';
import { buildExpectedEffects, runOracle, writeExpectedEffects, writeOracleArtifacts, ORACLE_VERSION } from './oracle.mjs';
import { armEventFields, resolveArm, FileLockTable } from './arms.mjs';

export const CLI_VERSION = '0.3.0-latency';

const r2 = (x) => Math.round(x * 100) / 100;

export class AtmGateway {
  constructor(broker, worktree, artifactsDir, opts = {}) {
    this.broker = broker; this.worktree = worktree; this.artifactsDir = artifactsDir;
    // atm_writer: 'sync'      = read-modify-write at apply time (in-process atomic) = idealised composer/rebase
    //             'stale'     = read base right after admission, write base+edit after hold (like control) = NO composer apply
    //             'steward'   = PatchProposal -> compose window -> neutral steward apply (proposers never write)
    //             'file_lock' = D1: ATM admit, then per-file async mutex covering hold+RMW (no composer)
    //             'occ'       = D2: hold without file lock; on version drift rebuild+retry (bounded)
    //             'git_three_way' = D3: compose window + pairwise git merge-file fold (n-way disclosed)
    //             'bare_composer' = D4: same steward compose+apply; BareAdmitBroker bypasses ATM admit
    this.writer = opts.atm_writer ?? 'sync';
    this.compose_window_ms = opts.compose_window_ms ?? 80;
    this.occ_max_retries = opts.occ_max_retries ?? 8;
    this.baseCommit = opts.baseCommit ?? null;
    this.stewardWindows = opts.stewardWindows ?? null;
    this.fileLocks = opts.fileLocks ?? (this.writer === 'file_lock' ? new FileLockTable() : null);
    this.gitThreeWay = opts.gitThreeWay ?? null;
    if ((this.writer === 'steward' || this.writer === 'bare_composer') && !this.stewardWindows) {
      this.stewardWindows = new ComposeWindowManager({
        cwd: worktree,
        artifactsDir,
        compose_window_ms: this.compose_window_ms,
        onApplied: (path) => this.broker.bump(path),
        onBatchClose: opts.onBatchClose ?? null,
      });
    }
    if (this.writer === 'git_three_way' && !this.gitThreeWay) {
      this.gitThreeWay = new GitThreeWayManager({
        cwd: worktree,
        artifactsDir,
        compose_window_ms: this.compose_window_ms,
        onApplied: (path) => this.broker.bump(path),
        onBatchClose: opts.onBatchClose ?? null,
      });
    }
  }
  async execute(intent, agent, emit) {
    // Timing (performance.now, ms, 2dp):
    //   admission_ms / broker_ms / hold_ms / apply_ms as before
    //   lock_wait_ms = queue time for per-file mutex (file_lock arm only)
    const abs = join(this.worktree, intent.path);
    const tSubmit = performance.now();
    const ticket = await this.broker.admit(intent, agent, {
      onEnqueue: (q) => emit({ event: 'enqueue', decision: 'cold_queue', reason_code: q.overlay || 'cold_enqueued', wait_ms: 0, ...q }),
      onDequeue: (q) => emit({ event: 'dequeue', decision: 'cold_queue', reason_code: `cold_dequeue_${q.outcome}`, wait_ms: q.wait_ms, overlay: q.overlay }),
    });
    const tDecided = performance.now();
    const admission_ms = tDecided - tSubmit;
    const common = {
      decision: ticket.decision, reason_code: ticket.reason_code, wait_ms: ticket.wait_ms,
      serialized: ticket.serialized, composer: ticket.composer, blocked_by: ticket.blocked_by, cowriters: ticket.cowriters,
      atm_disposition: ticket.atm_disposition, atm_verdict: ticket.atm_verdict, atm_lane: ticket.atm_lane,
      atm_reason: ticket.atm_reason, atm_admission_state: ticket.atm_admission_state,
      atm_ticket_state: ticket.atm_ticket_state, atm_write_intent_task: ticket.atm_write_intent_task,
      overlay: ticket.overlay, atm_first_disposition: ticket.atm_first_disposition, queue_rounds: ticket.queue_rounds, timed_out: ticket.timed_out,
    };
    const timing = (extra = {}) => ({
      admission_ms: r2(admission_ms),
      broker_ms: r2(Math.max(0, admission_ms - (ticket.wait_ms || 0))),
      hold_ms: 0, promotion_wait_ms: 0, apply_ms: 0, lock_wait_ms: 0, ...extra,
    });
    if (ticket.decision === 'reject' || ticket.decision === 'cold_block') return { ...common, ...timing(), outcome: 'reject' };
    if (ticket.timed_out) return { ...common, ...timing(), outcome: 'timeout' };
    let res;
    let tApply0 = null;
    let hold_ms = 0, promotion_wait_ms = 0, lock_wait_ms = 0;
    try {
      const line = `${markerFor(intent.intent_id)} by ${agent.agent_id}`;
      let wait_ms = ticket.wait_ms;
      let artifact;

      if (this.writer === 'git_three_way') {
        // D3: hold unlocked; submit independent patch vs shared batch base; pairwise git merge-file fold.
        const tH = performance.now();
        await sleep(intent.hold_ms);
        hold_ms = performance.now() - tH;
        if (ticket.promotion) {
          const tP = performance.now();
          mkdirSync(join(this.artifactsDir, 'provisional'), { recursive: true });
          artifact = `provisional/${slug(intent.intent_id)}.patch`;
          writeFileSync(join(this.artifactsDir, artifact), `${intent.path}#${intent.region}\n+ ${line}\n`);
          wait_ms += await ticket.promotion;
          promotion_wait_ms = performance.now() - tP;
        }
        tApply0 = performance.now();
        const cas_retry = this.broker.version(intent.path) !== ticket.base_version ? 1 : 0;
        // D3: always timeout-collect peers (unless window=0) so concurrent same-file
        // patches actually enter one fold batch — contrast steward's cowriter/timeout path.
        const { expectedCount, expected_source } = this.compose_window_ms === 0
          ? { expectedCount: 1, expected_source: 'window_zero' }
          : { expectedCount: Number.POSITIVE_INFINITY, expected_source: 'git_timeout_only' };
        mkdirSync(join(this.artifactsDir, 'git_merge'), { recursive: true });
        artifact = artifact || `git_merge/pending-${slug(intent.intent_id)}.txt`;
        const gitRes = await this.gitThreeWay.submit({
          targetFile: intent.path,
          absPath: abs,
          region: intent.region,
          line,
          intent_id: intent.intent_id,
          logical_id: intent.logical_id ?? intent.intent_id,
          expectedCount,
          expected_source,
          reason_code_base: ticket.reason_code,
        });
        res = {
          ...common, wait_ms, cas_retry, artifact,
          ...gitRes,
          reason_code: gitRes.outcome === 'commit'
            ? (cas_retry && ticket.decision !== 'cold_queue'
              ? `${ticket.reason_code}+cas_rebase`
              : gitRes.reason_code)
            : gitRes.reason_code,
        };
      } else if (this.writer === 'occ') {

        // D2 OCC: hold WITHOUT per-file exclusive lock (contrast D1). Then CAS loop:
        // read version V + current bytes -> build insert -> yield -> if version still V, write+bump;
        // else rebuild and retry until occ_max_retries, then blocked.
        const admitBase = ticket.base_version;
        const tH = performance.now();
        await sleep(intent.hold_ms);
        hold_ms = performance.now() - tH;
        if (ticket.promotion) {
          const tP = performance.now();
          mkdirSync(join(this.artifactsDir, 'provisional'), { recursive: true });
          artifact = `provisional/${slug(intent.intent_id)}.patch`;
          writeFileSync(join(this.artifactsDir, artifact), `${intent.path}#${intent.region}\n+ ${line}\n`);
          wait_ms += await ticket.promotion;
          promotion_wait_ms = performance.now() - tP;
        }
        tApply0 = performance.now();
        const maxRetries = this.occ_max_retries;
        let cas_retry = 0;
        let planned = admitBase; // version we last planned against (admit or last rebuild)
        let committed = false;
        while (true) {
          const v = this.broker.version(intent.path);
          if (v !== planned) {
            // Drift vs planned base → rebuild marker insert on current bytes (count as CAS retry).
            cas_retry += 1;
            if (cas_retry > maxRetries) break;
            planned = v;
          }
          const content = readFileSync(abs, 'utf8');
          const next = insertIntoRegion(content, intent.region, line);
          // Yield so concurrent agents can interleave (otherwise single-threaded RMW never loses CAS).
          await sleep(0);
          if (this.broker.version(intent.path) !== v) {
            // Lost race during yield; next loop counts another rebuild if still drifted.
            continue;
          }
          writeText(abs, next);
          this.broker.bump(intent.path);
          committed = true;
          break;
        }
        if (!committed) {
          res = {
            ...common, wait_ms, cas_retry, artifact, atm_writer: 'occ',
            serialized: false, composer: false,
            repropose_rounds: cas_retry,
            reason_code: 'occ_retries_exhausted',
            outcome: 'blocked',
            admit_base_version: admitBase,
            occ_max_retries: maxRetries,
          };
        } else {
          res = {
            ...common, wait_ms, cas_retry, artifact, atm_writer: 'occ',
            serialized: false, composer: false,
            repropose_rounds: cas_retry,
            reason_code: cas_retry > 0
              ? `${ticket.reason_code || 'occ'}+cas_retry_${cas_retry}`
              : (ticket.reason_code || 'occ_commit'),
            outcome: 'commit',
            admit_base_version: admitBase,
            occ_max_retries: maxRetries,
          };
        }
      } else if (this.writer === 'file_lock') {

        // D1: ATM admit (above); no composer. Per-file mutex covers hold + RMW = conservative serial cost.
        const { result: body, lock_wait_ms: lw } = await this.fileLocks.runExclusive(intent.path, async () => {
          const tH = performance.now();
          await sleep(intent.hold_ms);
          const hold = performance.now() - tH;
          let promoWait = 0;
          let art;
          let waitExtra = 0;
          if (ticket.promotion) {
            const tP = performance.now();
            mkdirSync(join(this.artifactsDir, 'provisional'), { recursive: true });
            art = `provisional/${slug(intent.intent_id)}.patch`;
            writeFileSync(join(this.artifactsDir, art), `${intent.path}#${intent.region}\n+ ${line}\n`);
            waitExtra = await ticket.promotion;
            promoWait = performance.now() - tP;
          }
          const tA = performance.now();
          const cas = this.broker.version(intent.path) !== ticket.base_version ? 1 : 0;
          applyEditSync(abs, intent.region, line);
          this.broker.bump(intent.path);
          return { hold, promoWait, waitExtra, art, tApply0: tA, cas };
        });
        lock_wait_ms = lw;
        hold_ms = body.hold;
        promotion_wait_ms = body.promoWait;
        wait_ms += body.waitExtra;
        artifact = body.art;
        tApply0 = body.tApply0;
        res = {
          ...common, wait_ms, cas_retry: body.cas, artifact, atm_writer: 'file_lock',
          serialized: true, composer: false,
          reason_code: body.cas && ticket.decision !== 'cold_queue'
            ? `${ticket.reason_code}+cas_rebase`
            : (ticket.reason_code || 'file_lock_serial'),
          outcome: 'commit',
        };
      } else {
        let staleBase = null, staleBaseVersion = null;
        if (this.writer === 'stale') { staleBase = readFileSync(abs, 'utf8'); staleBaseVersion = this.broker.version(intent.path); }
        const tH = performance.now();
        await sleep(intent.hold_ms);
        hold_ms = performance.now() - tH;
        if (ticket.promotion) {
          const tP = performance.now();
          mkdirSync(join(this.artifactsDir, 'provisional'), { recursive: true });
          artifact = `provisional/${slug(intent.intent_id)}.patch`;
          writeFileSync(join(this.artifactsDir, artifact), `${intent.path}#${intent.region}\n+ ${line}\n`);
          wait_ms += await ticket.promotion;
          promotion_wait_ms = performance.now() - tP;
        }
        tApply0 = performance.now();
        let cas_retry = 0;
        if (this.broker.version(intent.path) !== ticket.base_version) cas_retry = 1;

        if (this.writer === 'steward' || this.writer === 'bare_composer') {
          const content = readFileSync(abs, 'utf8');
          const baseCommit = this.baseCommit ?? await readBaseCommit(this.worktree);
          const proposal = makeMarkerProposal({
            proposalId: `prop-${intent.intent_id}`,
            taskId: ticket.task_id || ticket.atm_write_intent_task || `TASK-${intent.intent_id}`,
            actorId: agent.agent_id,
            targetFile: intent.path,
            region: intent.region,
            content,
            baseCommit,
            intentId: intent.intent_id,
          });
          mkdirSync(join(this.artifactsDir, 'proposals'), { recursive: true });
          artifact = `proposals/${slug(intent.intent_id)}.json`;
          writeFileSync(join(this.artifactsDir, artifact), JSON.stringify(proposal, null, 2) + '\n');
          const { expectedCount, expected_source } = resolveExpectedCount(ticket, this.compose_window_ms);
          const stewardRes = await this.stewardWindows.submit({
            targetFile: intent.path,
            proposal,
            expectedCount,
            expected_source,
            intent_id: intent.intent_id,
            logical_id: intent.logical_id ?? intent.intent_id,
            attempt_id: `att-${intent.intent_id}-r0`,
            repropose_rounds: 0,
            reason_code_base: ticket.reason_code,
          });
          res = {
            ...common, wait_ms, cas_retry, artifact,
            ...stewardRes,
            atm_writer: this.writer,
            admission_bypassed: this.writer === 'bare_composer' || !!ticket.admission_bypassed,
            reason_code: stewardRes.steward_verdict === 'applied'
              ? (cas_retry && ticket.decision !== 'cold_queue'
                ? `${ticket.reason_code}+cas_rebase`
                : (this.writer === 'bare_composer' ? 'bare_composer_applied' : ticket.reason_code))
              : stewardRes.reason_code,
          };
        } else {
          let racy = false;
          const doApply = () => {
            if (this.writer === 'stale') {
              racy = this.broker.version(intent.path) !== staleBaseVersion;
              writeText(abs, insertIntoRegion(staleBase, intent.region, line));
            } else {
              applyEditSync(abs, intent.region, line);
            }
          };
          if (this.broker.withApplyLock) this.broker.withApplyLock(intent.path, doApply); else doApply();
          this.broker.bump(intent.path);
          res = {
            ...common, wait_ms, cas_retry, artifact, atm_writer: this.writer, ...(this.writer === 'stale' ? { racy } : {}),
            reason_code: cas_retry && ticket.decision !== 'cold_queue' ? `${ticket.reason_code}+cas_rebase` : ticket.reason_code,
            outcome: 'commit',
          };
        }
      }
    } catch (e) {
      res = { ...common, outcome: 'error', reason_code: e.code || 'io_error', error: String(e.message), atm_writer: this.writer };
    } finally {
      ticket.release();
    }
    const apply_ms = tApply0 == null ? 0 : performance.now() - tApply0;
    return { ...res, ...timing({ hold_ms: r2(hold_ms), promotion_wait_ms: r2(promotion_wait_ms), apply_ms: r2(apply_ms), lock_wait_ms: r2(lock_wait_ms) }) };
  }
}

export function modeDirs(runDir, mode) {
  const base = join(runDir, mode);
  return {
    base, scenarios: join(base, 'scenarios'), events: join(base, 'events'),
    artifacts: join(base, 'artifacts'), worktree: join(base, 'worktree'),
  };
}

export async function runMode({ runDir, run_id, mode, meta, scenarios, fixtureDir, log = console.log }) {
  const p = meta.params;
  const backend = mode === 'atm' ? (meta.atm_backend || 'mock') : null;
  const armDef = resolveArm({
    arm: meta.arm ?? p.arm,
    mode,
    atm_writer: mode === 'atm' ? (p.atm_writer ?? 'sync') : null,
  });
  const armFields = armEventFields(armDef);
  const d = modeDirs(runDir, mode);
  if (existsSync(d.events)) rmSync(d.base, { recursive: true, force: true });
  for (const k of ['scenarios', 'events', 'artifacts']) mkdirSync(d[k], { recursive: true });
  cpSync(fixtureDir, d.worktree, { recursive: true, filter: (src) => !src.endsWith('manifest.json') });
  writeFileSync(join(d.scenarios, 'scenarios.json'), JSON.stringify(scenarios, null, 2));
  writeFileSync(join(d.scenarios, 'sha256.txt'), scenarioHash(scenarios) + '\n');
  // C3: pre-register effects (eligible independent of method under test)
  const expectedEffects = buildExpectedEffects(scenarios);
  writeExpectedEffects(join(d.scenarios, 'expected_effects.json'), expectedEffects, {
    run_id, mode, fixture_comment_prefix: '//',
  });

  let gateway, capability = null;
  let broker = null;
  let baseCommit = null;
  // Steward / git_three_way need a git worktree (baseCommit / merge-file receipts).
  if (mode === 'atm' && (p.atm_writer === 'steward' || p.atm_writer === 'git_three_way' || p.atm_writer === 'bare_composer')) {
    baseCommit = initWorktreeGit(d.worktree);
    writeFileSync(join(d.artifacts, 'steward_base_commit.txt'), baseCommit + '\n');
  }
  if (mode === 'atm') {
    // D4: bare_composer always uses BareAdmitBroker (bypass RealATM/Mock admit), even if --atm-backend real.
    // Compose+apply still load ATM pin APIs inside ComposeWindowManager.
    if (p.atm_writer === 'bare_composer') {
      broker = new BareAdmitBroker(p);
      await broker.init();
      capability = broker.capability();
      writeFileSync(join(d.artifacts, 'atm_capability.json'), JSON.stringify(capability, null, 2));
      writeFileSync(join(d.artifacts, 'admission_bypass.json'), JSON.stringify({
        arm: 'bare_composer',
        mode: 'stub_always_composer_merge',
        skipped: 'RealAtmBroker.admit / MockBroker.admit / registry leases',
        retained: 'composeBrokerProposals + applyStewardPlan (ATM pin)',
      }, null, 2) + '\n');
    } else if (backend === 'real') {
      broker = new RealAtmBroker(d.worktree, { ...p, ...(baseCommit ? { baseCommit } : {}) });
      await broker.init();
      capability = broker.capability();
      // persist capability snapshot for evidence
      writeFileSync(join(d.artifacts, 'atm_capability.json'), JSON.stringify(capability, null, 2));
    } else {
      broker = new MockBroker(p);
      capability = broker.capability();
    }
    const batchSink = (p.atm_writer === 'steward' || p.atm_writer === 'git_three_way' || p.atm_writer === 'bare_composer')
      ? jsonlSink(join(d.events, 'compose_batches.jsonl'))
      : null;
    const fileLocks = p.atm_writer === 'file_lock' ? new FileLockTable() : null;
    gateway = new AtmGateway(broker, d.worktree, d.artifacts, {
      atm_writer: p.atm_writer,
      compose_window_ms: p.compose_window_ms ?? 80,
      occ_max_retries: p.occ_max_retries ?? 8,
      baseCommit,
      fileLocks,
      onBatchClose: batchSink
        ? (ev) => batchSink.write({ run_id, mode, atm_backend: backend, ...ev })
        : null,
    });
  } else {
    gateway = new ControlWriter(d.worktree);
  }

  const intents = scenarios.flatMap((s) => s.intents.map((i) => ({ ...i, scenario_id: s.scenario_id })));
  const agents = Array.from({ length: p.n_agents }, (_, s) => agentForSlot(s));
  const stopFile = join(d.base, 'STOP');
  const terminals = new Map(); // intent_id → { outcome, emit, steward_verdict, batch_id, ... }
  const t0 = Date.now() + 25;
  const perfT0 = performance.now() + (t0 - Date.now());
  const started_at = tsTaipei();
  let firstSubmit = Infinity, lastDecision = -Infinity;
  let trialCounter = 0;

  async function agentLoop(agent) {
    const sink = jsonlSink(join(d.events, `${slug(agent.agent_id)}.jsonl`));
    const mine = intents.filter((i) => i.agent_slot === agent.slot).sort((a, b) => a.trial_index - b.trial_index);
    for (const intent of mine) {
      if (existsSync(stopFile)) break;
      await sleep(t0 + intent.trial_index * p.tick_interval_ms + intent.jitter_ms - Date.now());
      const baseEvt = {
        run_id, mode, trial_id: intent.trial_id, scenario_id: intent.scenario_id, intent_id: intent.intent_id,
        agent_id: agent.agent_id, vendor: agent.vendor, path: intent.path, region: intent.region,
        temperature: intent.hot_or_cold_hint,
        expected_class: mode === 'atm' ? intent.expected_class : intent.expected_class_control,
        atm_capability: capability, atm_backend: backend,
        ...armFields,
      };
      const emit = (e) => sink.write({ ts: tsTaipei(), ...baseEvt, ...e });
      const scheduled = intent.trial_index * p.tick_interval_ms + intent.jitter_ms;
      const tSub = performance.now();
      firstSubmit = Math.min(firstSubmit, tSub);
      emit({
        t_submit_ms: r2(tSub - perfT0), schedule_lag_ms: r2(tSub - perfT0 - scheduled),
        event: 'submit', decision: null, wait_ms: 0, outcome: null, reason_code: 'intent_submitted',
        active_intents: broker ? broker.activeIntentCount() : null,
      });
      const r = await gateway.execute(intent, agent, emit);
      const tEnd = performance.now();
      lastDecision = Math.max(lastDecision, tEnd);
      const total_ms = tEnd - tSub;
      emit({
        event: 'decision', serialized: false, composer: false, ...r,
        t_submit_ms: r2(tSub - perfT0), t_done_ms: r2(tEnd - perfT0),
        schedule_lag_ms: r2(tSub - perfT0 - scheduled),
        // latency_ms = submit -> decision available (ATM admission; control has no admission step)
        latency_ms: r.admission_ms,
        total_ms: r2(total_ms),
        // overhead_ms = everything except the simulated think time (hold) — the part ATM can slow down
        overhead_ms: r2(total_ms - (r.hold_ms || 0)),
      });
      trialCounter++;
      terminals.set(intent.intent_id, {
        outcome: r.outcome,
        emit,
        intent,
        steward_verdict: r.steward_verdict ?? null,
        batch_id: r.batch_id ?? null,
        decision: r.decision,
      });
    }
  }

  await Promise.all(agents.map(agentLoop));

  // C3 independent oracle: effect_id + final file bytes (not steward_verdict; not marker-only).
  const { results: oracleResults, summary: oracleSummary, file_digests } = runOracle({
    worktree: d.worktree,
    effects: expectedEffects,
    terminals,
  });
  writeOracleArtifacts(d.artifacts, { results: oracleResults, summary: oracleSummary, file_digests });
  for (const row of oracleResults) {
    const term = terminals.get(row.intent_id);
    const emit = term?.emit;
    if (!emit) continue; // unresolved / never submitted — still in oracle_results.jsonl
    emit({
      event: 'oracle',
      decision: null,
      wait_ms: 0,
      // backward-compatible mapping
      outcome: row.outcome,
      reason_code: row.reason_code,
      // C3 richer fields
      oracle_version: ORACLE_VERSION,
      oracle_verdict: row.oracle_verdict,
      effect_id: row.effect_id,
      logical_id: row.logical_id,
      occurrence_count: row.occurrence_count,
      matched_via: row.matched_via,
      region_loc: row.region_loc,
      output_digest: row.output_digest,
      eligible: row.eligible,
      terminal_outcome: row.terminal_outcome,
      ...(row.steward_verdict_diag != null ? { steward_verdict_diag: row.steward_verdict_diag } : {}),
      ...(row.batch_id != null ? { batch_id: row.batch_id } : {}),
    });
  }
  const committedCount = [...terminals.values()].filter((t) => t.outcome === 'commit').length;
  const blockedCount = [...terminals.values()].filter((t) => t.outcome === 'blocked').length;
  if (broker) {
    writeFileSync(
      join(d.artifacts, 'broker_decisions.jsonl'),
      broker.decisions.map((x) => JSON.stringify(x)).join('\n') + '\n'
    );
  }
  const finished_at = tsTaipei();
  const duration_ms = Date.now() - t0;
  const wall_clock_ms = r2(lastDecision - firstSubmit);
  log(`[${mode}] arm=${armDef?.arm ?? 'n/a'} role=${armDef?.arm_role ?? 'n/a'} diagnostic=${armDef?.diagnostic ?? false} backend=${backend ?? 'n/a'} intents=${trialCounter} committed=${committedCount} blocked=${blockedCount} oracle_correct=${oracleSummary.correct} oracle_lost=${oracleSummary.lost} duration_ms=${duration_ms} wall_clock_ms=${wall_clock_ms}`);
  return {
    mode, started_at, finished_at, duration_ms, wall_clock_ms,
    oracle_summary: oracleSummary,
    ...armFields,
    arm_label: armDef?.label ?? null,
    throughput_intents_per_s: wall_clock_ms > 0 ? r2(trialCounter / (wall_clock_ms / 1000)) : null,
    timing_clock: 'performance.now() (monotonic, same process); wall_clock_ms = first submit -> last decision',
    timing_caveats: [
      'single Node process: all agents share one event loop; sync fs work (ATM registry save, file edits) delays other agents (shows up as hold_ms/schedule_lag_ms inflation)',
      'hold_ms is simulated think time (sleep), not LLM latency; wall clock is pacing-bound when tick_interval_ms>0',
      'control latency_ms (admission) is ~0 by construction: control has no admission step',
      `writer=mock (in-process marker edits; atm_writer=${p.atm_writer ?? 'sync'}), atm_backend=${backend ?? 'none'}`,
      ...(p.atm_writer === 'steward' || p.atm_writer === 'bare_composer'
        ? [
          p.atm_writer === 'bare_composer'
            ? 'atm_writer=bare_composer: BareAdmitBroker always composer_merge (admission bypassed); same ComposeWindowManager+steward apply as steward'
            : 'atm_writer=steward: ComposeWindowManager owns batch close (harness); late joiner → new batch',
          'compose_batch events in events/compose_batches.jsonl; repropose_rounds stubbed at 0 (P1-3 / C2-out)',
          'multi-process compose window does not span OS processes',
        ]
        : []),
      `oracle=${ORACLE_VERSION}: effect_id + final bytes; expected_effects.json pre-registered; steward_verdict is diagnostic only`,
      ...(armDef?.diagnostic
        ? [`arm=${armDef.arm} is DIAGNOSTIC (${armDef.arm_role}); not a correctness competitor — only steward is`]
        : armDef?.arm === 'steward'
          ? ['arm=steward is the MAIN correctness method']
          : armDef?.arm === 'file_lock'
            ? ['arm=file_lock is BASELINE serial foil (per-file mutex+RMW, no composer); conservative correct cost']
            : armDef?.arm === 'occ'
              ? ['arm=occ is BASELINE OCC foil (CAS+bounded retry/rebuild, no composer); hold is unlocked']
              : armDef?.arm === 'git_three_way'
                ? ['arm=git_three_way is BASELINE git foil: pairwise git merge-file left-fold (n-way disclosed as fold, not true multi-parent)']
                : armDef?.arm === 'bare_composer'
                  ? ['arm=bare_composer is BASELINE ablation: compose+steward apply with BareAdmitBroker (no ATM admit/leases)']
                  : []),
    ],
    intents_processed: trialCounter, atm_capability: capability,
    rss_mb_end: Math.round(process.memoryUsage().rss / 1048576), registry_active_end: broker?.activeIntentCount?.() ?? null,
    agents: agents.map((a) => ({ agent_id: a.agent_id, vendor: a.vendor, joined_at: started_at, mode })),
  };
}
