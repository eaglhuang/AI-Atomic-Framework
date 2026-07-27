#!/usr/bin/env node
const payload = {
  ok: false,
  evidence: {
    verdict: 'remain-open',
    blockers: ['sealed-failure-class-exposed'],
    faultCounters: {
      staleAuthorizationCount: 1,
      dimensionMismatchedAuthorizationCount: 1
    }
  }
};
process.stdout.write(JSON.stringify(payload));
process.exit(1);
