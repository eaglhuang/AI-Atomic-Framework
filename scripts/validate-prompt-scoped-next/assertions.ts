import { spawnSync } from 'node:child_process';

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  assert(result.status === 0, `git ${args.join(' ')} must succeed\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  return result;
}

export function assertDecisionTrail(action: any, expectedStatus: string) {
  const trail = action?.decisionTrail;
  assert(Array.isArray(trail) && trail.length > 0, `${expectedStatus} route must expose nextAction.decisionTrail`);
  assert(trail[0]?.check === 'route-status', `${expectedStatus} decisionTrail must start with route-status`);
  assert(trail[0]?.reason && typeof trail[0].reason === 'string', `${expectedStatus} decisionTrail route-status needs a public reason`);
  assert(!JSON.stringify(trail).toLowerCase().includes('chain-of-thought'), `${expectedStatus} decisionTrail must not expose private reasoning labels`);
  return trail as Array<{
    check: string;
    result: string;
    reason: string;
    evidencePath?: string;
    nextCommand?: string;
  }>;
}

export function assertRunnerMode(result: any) {
  const runnerMode = result?.evidence?.nextAction?.runnerMode;
  assert(runnerMode?.schemaId === 'atm.runnerMode.v1', 'nextAction must expose atm.runnerMode.v1');
  assert(result?.evidence?.runnerMode?.schemaId === 'atm.runnerMode.v1', 'next evidence must expose runnerMode');
  assert(runnerMode.normalGovernanceCommand === 'node atm.mjs ...', 'runner mode must point normal governance to node atm.mjs');
  assert(runnerMode.sourceFirstCommand === 'node atm.dev.mjs ...', 'runner mode must point source validation to node atm.dev.mjs');
  assert(runnerMode.syncCommand === 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build', 'runner mode must expose the retained frozen-runner sync command');
  assert(['frozen', 'source-first', 'source-import'].includes(runnerMode.mode), 'runner mode must classify known ATM entrypoints');
  assert(String(runnerMode.sourceFirstOnlyWhen).includes('explicit source-first framework validation'), 'runner mode must restrict source-first guidance to explicit validation');
}

export function assertTeamRecommendation(action: any, expectedChannel: string, expectedTaskId?: string) {
  const recommendation = action?.teamRecommendation;
  assert(recommendation?.schemaId === 'atm.teamRecommendation.v1', 'nextAction must expose atm.teamRecommendation.v1');
  assert(recommendation?.required === false, 'teamRecommendation must stay advisory');
  assert(typeof recommendation?.reason === 'string' && recommendation.reason.length > 0, 'teamRecommendation must include reason');
  assert(String(recommendation?.plan).includes('team plan'), 'teamRecommendation.plan must suggest team plan');
  assert(String(recommendation?.start).includes('team start'), 'teamRecommendation.start must suggest team start');
  assert(String(recommendation?.status).includes('team status'), 'teamRecommendation.status must suggest team status');
  assert(recommendation?.channel === expectedChannel, `teamRecommendation channel must be ${expectedChannel}`);
  assert(recommendation?.knowledgeSummary?.schemaId === 'atm.teamKnowledgeSummary.v1', 'teamRecommendation must expose compact knowledgeSummary');
  assert(recommendation?.knowledgeSummary?.advisoryOnly === true, 'knowledgeSummary must stay advisory-only');
  assert(typeof recommendation?.knowledgeSummary?.followUpCommand === 'string' && recommendation.knowledgeSummary.followUpCommand.includes('team knowledge query'), 'knowledgeSummary must include an inspect follow-up command');
  assert(recommendation?.knowledgeSummary?.indexStatus === 'missing' || Array.isArray(recommendation?.knowledgeSummary?.hits), 'knowledgeSummary must be stable when no knowledge index exists');
  if (expectedTaskId) {
    assert(recommendation?.taskId === expectedTaskId, `teamRecommendation taskId must be ${expectedTaskId}`);
  }
  assert(action?.playbook?.teamRecommendation?.schemaId === 'atm.teamRecommendation.v1', 'playbook must embed teamRecommendation');
}
