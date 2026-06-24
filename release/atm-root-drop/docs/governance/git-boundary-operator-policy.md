# Git Boundary Operator Policy

This note defines the MVP operator policy for ATM's Git-boundary admission lane.

## Scope

- ATM can evaluate semantic admission before push.
- ATM can install or verify a local `pre-push` hook.
- ATM can record governed `git commit --no-verify` use when a human-approved
  emergency lease authorizes `backend.gitHookBypass`.

This is an operator policy note, not a tamper-proof enforcement guarantee.

## Local Hook Reality

Local Git hooks are a convenience and evidence surface, not a trusted boundary.

- A local operator can skip hooks with `git commit --no-verify` or by disabling
  the local hook file.
- ATM must document that bypass risk explicitly.
- ATM should record governed bypasses when the ATM wrapper is used, but it
  cannot guarantee capture of native Git commands run outside ATM.

## Emergency Hook Bypass

`node atm.mjs git commit --no-verify` is allowed only as an emergency lane.

Required conditions:

- the operator must provide `--emergency-approval <leaseId>`;
- the lease must authorize `backend.gitHookBypass`;
- the operator must provide a human-readable `--reason`;
- the resulting governed commit should retain the normal ATM trailers.

Expected operator behavior:

- prefer fixing the hook failure and retrying without `--no-verify`;
- use bypass only when the hook failure is understood and delaying the fix would
  block recovery or governed closeback;
- treat bypass as a risk-bearing action that deserves later follow-up.

## Hook Verification

The current detectable states are local and best-effort:

- `integration hooks verify git-pre-push` can report the hook as missing;
- the same command can report drift when the hook file no longer points at the
  ATM CLI entrypoint or no longer writes the expected JSON report;
- drifted local hook state should be treated as effectively disabled for MVP
  operator guidance, because ATM can no longer trust that the expected local
  check will run.

## Protected Branches And Server-Side Policy

Protected branches, branch protection, CI gates, and server-side enforcement are
future deployment policy layers, not MVP guarantees of this card.

- ATM should name them as the durable enforcement direction.
- ATM should not claim that local hook installation alone prevents bypass.
- This card does not attempt to make hooks tamper-proof.

## Recommended Operator Guidance

When a push is sensitive:

1. verify the local hook with `node atm.mjs integration hooks verify git-pre-push --json`;
2. run `node atm.mjs git admit ...` or `node atm.mjs git recover-push-fail ...`
   as appropriate;
3. use `node atm.mjs git commit --no-verify` only with approved emergency
   authority;
4. rely on protected branches / CI as the long-term deployment enforcement
   layer, not on local hooks alone.
