#!/bin/sh
# ATM arm integration. NOT VERIFIED: this is the placeholder that marks the ATM arm `status: unverified`.
# Intended path (to be proven in a bootstrapped scratch repo before the formal run):
#   node "$AB_ATM_ROOT/atm.mjs" broker proposal create ...   (per writer, from its worktree)
#   node "$AB_ATM_ROOT/atm.mjs" broker compose ...           (merge plan over the proposals)
#   node "$AB_ATM_ROOT/atm.mjs" broker steward apply ...     (apply into the integration worktree)
# Until those flags are verified, this script refuses to run and writes an explicit failure report.
echo "atm-integrate.sh is unverified; refusing to run" >&2
printf '%s\n' '{"conflicts":0,"lost":["atm-integrate-unverified"],"note":"placeholder, not measured"}' > "$1"
exit 2
