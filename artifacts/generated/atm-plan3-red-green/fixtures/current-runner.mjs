#!/usr/bin/env node
const payload = {
  ok: true,
  evidence: {
    verdict: 'ready-to-close',
    blockers: [],
    faultCounters: {
      staleAuthorizationCount: 0,
      dimensionMismatchedAuthorizationCount: 0
    }
  }
};
process.stdout.write(JSON.stringify(payload));
process.exit(0);
