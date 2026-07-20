export function renderMarkdown(result: any): string {
  const serial = result.waves.find((wave: any) => wave.label === 'serial-baseline-rft-0020-0025');
  const parallel = result.waves.find((wave: any) => wave.label === 'parallel-wave-rft-0030-0082');
  const laneDogfood = result.waves.find((wave: any) => wave.label === 'lane-dogfood-hard-overlap-0204-0001-0002-0003-0010');
  const interpretation = parallel && parallel.maxConcurrency >= 2
    ? 'The task-event ledger contains overlapping active claim windows, so it directly supports task-level captain parallelism for this wave.'
    : 'The task-event ledger does not show overlapping active claim windows for the main RFT wave. This supports the safety story, especially zero repair-closure, but it does not yet prove task-level makespan acceleration.';
  const rows = result.waves.map((wave: any) => [wave.label, String(wave.taskCount), String(wave.actorCount), formatMs(wave.makespanMs), formatMs(wave.activeWindowMs), formatNumber(wave.throughputTasksPerHour), formatNumber(wave.throughputTasksPerActiveHour), formatPct(wave.overlapRatio), formatNumber(wave.averageConcurrency), String(wave.maxConcurrency), String(wave.repairClosureCount)]);
  const report = result.planPerformanceReport;
  return [
    '# Captain Parallel Ledger Analysis',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    'This report mines `.atm/history/task-events` as a read-only ledger to measure task-level captain parallelism. It deliberately measures inter-task concurrency, not intra-task Team worker fan-out.',
    '',
    '| Wave | Tasks | Actors | Makespan | Active window | Tasks/hour | Tasks/active hour | Overlap ratio | Avg concurrency | Max concurrency | Repair closures |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map((row: readonly string[]) => `| ${row.join(' | ')} |`),
    '',
    '## Interpretation',
    '',
    interpretation,
    '',
    serial && parallel ? `Serial baseline repair closures: ${serial.repairClosureCount}; RFT parallel-era repair closures: ${parallel.repairClosureCount}.` : '',
    '',
    '## Comparison',
    '',
    `- Throughput ratio, parallel wave vs serial baseline: ${formatNullable(result.comparison.throughputRatio)}x`,
    `- Active-time throughput ratio: ${formatNullable(result.comparison.activeTimeThroughputRatio)}x`,
    `- Active work density ratio: ${formatNullable(result.comparison.activeWorkDensityRatio)}x`,
    `- Repair-closure delta: ${result.comparison.repairClosureDelta}`,
    '',
    '## Lane Session Evidence',
    '',
    `- Session event root: \`${result.laneEvidence.eventRoot}\``,
    `- Lane events: ${result.laneEvidence.eventCount}; lanes: ${result.laneEvidence.laneCount}; actors: ${result.laneEvidence.actorCount}; task-linked events: ${result.laneEvidence.taskCount}.`,
    `- Lane-session event overlap concurrency: max ${result.laneEvidence.maxConcurrency}, overlap ${formatMs(result.laneEvidence.overlapMs)}, active window ${formatMs(result.laneEvidence.activeWindowMs)}.`,
    `- Event actions: ${Object.entries(result.laneEvidence.actions).map(([action, count]) => `${action}=${count}`).join(', ') || 'none'}.`,
    laneDogfood ? `- Dogfood overlap sample \`TASK-CODEX-0204\` + \`TASK-LANE-0001/0002/0003/0010\`: max concurrency ${laneDogfood.maxConcurrency}, overlap ${formatMs(laneDogfood.overlapMs)}.` : '',
    '',
    '## Observability Gaps',
    '',
    '## Auto-Batch Pipeline',
    '',
    `- Broker tickets: ${result.autoBatchPipeline.evidenceSources.brokerTickets}; wave tickets: ${result.autoBatchPipeline.evidenceSources.waveTickets}; waitedMs p50/p95: ${formatNullable(result.autoBatchPipeline.metrics.waitedMs.p50)} / ${formatNullable(result.autoBatchPipeline.metrics.waitedMs.p95)}; batchRate: ${result.autoBatchPipeline.metrics.batchRate === null ? 'n/a' : formatPct(result.autoBatchPipeline.metrics.batchRate)}; build/projection/commit signals: ${result.autoBatchPipeline.metrics.buildsPerWave}/${result.autoBatchPipeline.metrics.projectionsPerWave}/${result.autoBatchPipeline.metrics.commitsPerWave}; rollout verdict: ${result.autoBatchPipeline.rolloutVerdict.verdict} (${result.autoBatchPipeline.rolloutVerdict.reason}).`,
    `- Failure matrix: ${result.autoBatchPipeline.failureMatrix.map((entry: { scenario: string; status: string }) => `${entry.scenario}=${entry.status}`).join(', ')}.`,
    '',
    '## Plan Performance Report v3',
    '',
    `- Schema: \`${report.schemaId}\`; role: ${report.analyzerRole}; config digest: ${report.nextConfigDigest}.`,
    `- Matched cohorts: control=${report.matchedCohorts.controlCount}, treatment=${report.matchedCohorts.treatmentCount}, pairs=${report.matchedCohorts.pairCount}; verdict=${report.matchedCohorts.verdict} (${report.matchedCohorts.reason}).`,
    `- Broker correctness: tickets=${report.brokerDecisionAnalysis.ticketCount}, correctness samples=${report.brokerDecisionAnalysis.correctnessSampleCount}, parallel admission=${formatNullablePct(report.brokerDecisionAnalysis.parallelAdmissionRate)}, compose acceptance=${formatNullablePct(report.brokerDecisionAnalysis.composeAcceptanceRate)}, escaped conflicts=${report.brokerDecisionAnalysis.escapedConflictCount}; verdict=${report.brokerDecisionAnalysis.verdict} (${report.brokerDecisionAnalysis.reason}).`,
    `- Gate effectiveness: historicalReplay=${report.gateEffectiveness.historicalReplay.verdict}, shadowMode=${report.gateEffectiveness.shadowMode.verdict}, canonicalParity=${report.gateEffectiveness.canonicalParity.verdict}, matchedBatchA/B=${report.gateEffectiveness.matchedBatchAb.verdict}.`,
    `- Retirement proposal: ${report.gateEffectiveness.retirementProposal.proposedRetirements.length ? report.gateEffectiveness.retirementProposal.proposedRetirements.join(', ') : 'none'}; verdict=${report.gateEffectiveness.retirementProposal.verdict} (${report.gateEffectiveness.retirementProposal.reason}).`,
    `- Telemetry self-governance: decisions=${report.telemetrySelfGovernance.telemetryDecisionCount}; verdict=${report.telemetrySelfGovernance.verdict}; recommendation=${report.telemetrySelfGovernance.recommendation}`,
    `- Rollout verdict: speed=${report.rolloutVerdict.speed}, cost=${report.rolloutVerdict.cost}, safety=${report.rolloutVerdict.safety}, observability=${report.rolloutVerdict.observability}, overall=${report.rolloutVerdict.overall}.`,
    `- Coverage limitations: ${report.coverageLimitations.join('; ') || 'none'}.`,
    `- Data-driven decision: changedStrategy=${report.dataDrivenDecision.changedImplementationStrategy}; stopAndDiscussRequired=${report.dataDrivenDecision.stopAndDiscussRequired}; missing=${report.dataDrivenDecision.missingData.join(', ') || 'none'}.`,
    '',
    '## Real Paired AB v4',
    '',
    `- Benchmark config digest: ${report.realPairedAbV4.benchmarkConfigDigest ?? 'missing'}; verdict=${report.realPairedAbV4.verdict} (${report.realPairedAbV4.reason}).`,
    `- Cross-card consumption: consumed=${report.realPairedAbV4.crossCardConsumption.consumedTaskCount}/${report.realPairedAbV4.crossCardConsumption.requiredTaskCount}; missing=${report.realPairedAbV4.crossCardConsumption.missingTasks.join(', ') || 'none'}; digestMismatch=${report.realPairedAbV4.crossCardConsumption.digestMismatchTasks.join(', ') || 'none'}.`,
    `- Arms: ${report.realPairedAbV4.arms.map((arm: any) => `${arm.arm}: sufficient=${arm.sufficientCellCount}, insufficient=${arm.insufficientCellCount}, missing=${arm.missingCellCount}, verdict=${arm.verdict}`).join('; ')}.`,
    `- Validation methods: ${report.realPairedAbV4.validationMethods.map((method: any) => `${method.method}=${method.verdict}@${method.sourceDigest ?? 'missing-digest'}`).join('; ')}.`,
    `- Dimensions: speed=${report.realPairedAbV4.rolloutDimensions.speed}, cost=${report.realPairedAbV4.rolloutDimensions.cost}, safety=${report.realPairedAbV4.rolloutDimensions.safety}, observability=${report.realPairedAbV4.rolloutDimensions.observability}, broker=${report.realPairedAbV4.rolloutDimensions.broker}, runner=${report.realPairedAbV4.rolloutDimensions.runner}.`,
    `- Git isolation: disposableRepo=${report.realPairedAbV4.gitArmIsolation.disposableRepo}; liveFrameworkWorktree=${report.realPairedAbV4.gitArmIsolation.liveFrameworkWorktree}; brokerBypass=${report.realPairedAbV4.gitArmIsolation.brokerBypass}; verdict=${report.realPairedAbV4.gitArmIsolation.verdict}.`,
    `- Rollback receipt: verified=${report.realPairedAbV4.rollbackReceipt.verified}; command=${report.realPairedAbV4.rollbackReceipt.recoveryCommand ?? 'missing'}; digest=${report.realPairedAbV4.rollbackReceipt.receiptDigest ?? 'missing'}; verdict=${report.realPairedAbV4.rollbackReceipt.verdict}.`,
    `- Supplemental sampling proposal: ${report.realPairedAbV4.supplementalSamplingProposal.join('; ') || 'none'}.`,
    '',
    `- Framework temp claims: ${result.runtimeFrameworkLockSnapshot.lockCount} retained runtime lock files observed; ${result.runtimeFrameworkLockSnapshot.freshLockCount} fresh, ${result.runtimeFrameworkLockSnapshot.staleLockCount} stale. ${result.runtimeFrameworkLockSnapshot.caveat}`,
    ...result.observabilityGaps.map((gap: any) => `- ${gap.lane}: ${gap.status}. ${gap.impact}`),
    '',
    '## Method',
    '',
    '- Active window: first `claim` transition to first `close` / `toStatus: done` transition per task.',
    '- Serial baseline: `TASK-RFT-0020` through `TASK-RFT-0025`.',
    '- Parallel wave: `TASK-RFT-0030` through `TASK-RFT-0082`.',
    '- Repair closure is counted separately and excluded from active window duration.',
    '- Active-time normalized throughput uses the union of active claim windows and removes idle gaps with no active claim.',
    '- Framework temp locks are reported as an observability snapshot only; they are not used as historical task-level overlap evidence.',
    ''
  ].join('\n');
}

function formatMs(ms: number): string { return `${formatNumber(ms / 3_600_000)}h`; }
function formatPct(value: number): string { return `${formatNumber(value * 100)}%`; }
function formatNullable(value: number | null): string { return value === null ? 'n/a' : formatNumber(value); }
function formatNullablePct(value: number | null): string { return value === null ? 'n/a' : formatPct(value); }
function formatNumber(value: number): string { return value.toFixed(2); }
