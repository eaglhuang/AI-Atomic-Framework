import { makeResult, message, parseOptions } from '../shared.ts';
import { buildResidueReconcileReport, buildResidueStatusReport } from '../residue.ts';

/**
 * Narrow cleanup facade.  It never invents an ownership policy: the existing
 * residue classifier remains the sole executor and only removes receipt-safe,
 * non-staged, non-active-owner paths.
 */
export function runCleanup(argv: string[]) {
  const { positional, options } = parseOptions(argv, 'cleanup');
  const action = positional[0] ?? 'diagnose';
  if (action === 'diagnose') {
    const report = buildResidueStatusReport(options.cwd);
    return makeResult({
      ok: true,
      command: 'cleanup',
      cwd: options.cwd,
      messages: [message('info', 'ATM_CLEANUP_DIAGNOSE_READY', 'Cleanup diagnosis is read-only; it preserves foreign and active-owner residue.', { totalCount: report.totalCount, buckets: report.buckets })],
      evidence: { action, report }
    });
  }
  if (action === 'apply') {
    const report = buildResidueReconcileReport(options.cwd, true);
    return makeResult({
      ok: true,
      command: 'cleanup',
      cwd: options.cwd,
      messages: [message('info', 'ATM_CLEANUP_APPLY_COMPLETE', 'Cleanup applied only receipt-classified, non-staged disposable residue.', { appliedCount: report.appliedCount, deferredCount: report.deferredCount })],
      evidence: { action, report }
    });
  }
  return makeResult({
    ok: false,
    command: 'cleanup',
    cwd: options.cwd,
    messages: [message('error', 'ATM_CLEANUP_UNKNOWN_ACTION', `Unknown cleanup action: ${action}`)],
    evidence: { allowedActions: ['diagnose', 'apply'] }
  });
}
