// D4 bare composer: stub broker that **bypasses RealAtmBroker.admit** (no registry leases,
// no hot/cold routing, no queue waits). Every intent is admitted straight to the compose path
// as `composer_merge`. Synthesis + guarded apply still use ATM `composeBrokerProposals` /
// `applyStewardPlan` via ComposeWindowManager (same as steward arm).
//
// Documented choice: stub broker (not wrapping RealATM and skipping admit mid-call), so
// admission_ms ≈ 0 and rejects/waits from ATM governance never appear — isolates composition.

export const BARE_ADMIT_REASON = 'bare_composer_bypass';
export const BARE_ADMIT_DECISION = 'composer_merge';

export class BareAdmitBroker {
  constructor(opts = {}) {
    this.opts = opts;
    this.versions = new Map();
    this.decisions = [];
    this._active = 0;
  }

  capability() {
    return {
      backend: 'bare_admit',
      admission_bypassed: true,
      admission_bypass_mode: 'stub_always_composer_merge',
      cold_behaviour: 'bypassed',
      composer: true,
      provisional: false,
      note: 'D4: no RealAtmBroker.admit / registry leases; compose+steward apply still use ATM pin APIs',
    };
  }

  async init() { return this; }

  version(path) { return this.versions.get(path) ?? 0; }
  bump(path) { this.versions.set(path, this.version(path) + 1); }

  activeIntentCount() { return this._active; }

  record(intent, agent, d) {
    this.decisions.push({
      intent_id: intent.intent_id,
      agent_id: agent.agent_id,
      path: intent.path,
      region: intent.region,
      temperature: intent.hot_or_cold_hint,
      decision: d.decision,
      reason_code: d.reason_code,
      wait_ms: d.wait_ms ?? 0,
      at_ms: Date.now(),
    });
  }

  /**
   * Always admit to composer_merge with wait_ms=0. No ATM evaluate / leases.
   */
  async admit(intent, agent, _hooks = {}) {
    this._active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this._active = Math.max(0, this._active - 1);
    };
    const ticket = {
      decision: BARE_ADMIT_DECISION,
      reason_code: BARE_ADMIT_REASON,
      wait_ms: 0,
      serialized: false,
      composer: true,
      blocked_by: null,
      cowriters: null,
      base_version: this.version(intent.path),
      task_id: `BARE-${intent.intent_id}`,
      atm_write_intent_task: `BARE-${intent.intent_id}`,
      atm_disposition: 'bare_bypass',
      atm_verdict: 'compose',
      atm_lane: 'bare_composer',
      atm_reason: BARE_ADMIT_REASON,
      atm_admission_state: 'bypassed',
      atm_ticket_state: 'bare_open',
      overlay: null,
      atm_first_disposition: 'bare_bypass',
      queue_rounds: 0,
      timed_out: false,
      admission_bypassed: true,
      release,
    };
    this.record(intent, agent, ticket);
    return ticket;
  }
}
