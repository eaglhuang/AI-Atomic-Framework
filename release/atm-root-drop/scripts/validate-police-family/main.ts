import { createPoliceFamilyContext } from './context.ts';
import { runCoreScenarios } from './core-scenarios.ts';
import { runGateScenarios } from './gate-scenarios.ts';
import { runDecompositionEvolutionScenarios } from './decomposition-evolution-scenarios.ts';
import { runPolymorphRollbackScenarios } from './polymorph-rollback-scenarios.ts';
import { runFinalContractScenarios } from './final-contract-scenarios.ts';

export async function runPoliceFamilyValidator() {
  const ctx = createPoliceFamilyContext();
  const core = await runCoreScenarios(ctx);
  const gate = await runGateScenarios(ctx, core);

  await runDecompositionEvolutionScenarios(ctx, gate);
  await runPolymorphRollbackScenarios(ctx, gate);
  await runFinalContractScenarios(ctx, gate);

  if (!process.exitCode) {
    const totalFamilies = gate.positiveGateReport.families.length;
    const blockerCount = gate.blockerFamilies.length;
    const advisoryCount = gate.advisoryFamilies.length;
    const sharedGateCount = gate.positiveGateReport.sharedGates?.length ?? 0;
    console.log(
      `[police-family:${ctx.mode}] ok (${totalFamilies} families: ${blockerCount} blocker, ${advisoryCount} advisory, ${sharedGateCount} shared gates; ` +
      `named scanners (incl. decomposition / evolution / polymorph / rollback), ` +
      `shared gates (evidence-integrity / reversibility / noise-control), ` +
      `contract-drift + adopter-neutrality inside registry-consistency, ` +
      `advisory-only hardening (mutation + auto-approval denial), ` +
      `validator profile naming contract, gate report producer, ` +
      `ReviewAdvisory bridge, dry-run guards, suppression/stale-base/daily-cap safeguards, ` +
      `and negative fixtures verified)`
    );
  }
}
