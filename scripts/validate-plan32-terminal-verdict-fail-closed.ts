import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultReplayPath = path.join(root, 'docs/reports/plan-3-2-objective-replay.json');

function parseArgs(argv: string[]) {
  const options = { input: defaultReplayPath, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      options.input = path.resolve(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan32-terminal-verdict-fail-closed.ts [--input <json>] [--json]');
      process.exit(0);
    }
    throw new Error(`unsupported argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const replay = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];
  const denominator = Number(replay.denominator ?? 0);
  const verified = Number(replay.statusCounts?.verified ?? 0);
  const notComplete = Number(replay.statusCounts?.['not-complete'] ?? 0);

  if (replay.schemaId !== 'atm.planObjectiveReplay.v1') findings.push('schemaId mismatch');
  if (replay.planId !== '3.2') findings.push('planId mismatch');
  if (denominator !== 29) findings.push(`denominator mismatch: ${denominator}`);
  if (verified >= denominator) findings.push('fixture must represent an incomplete Plan 3.2 replay');
  if (verified + notComplete !== denominator) findings.push('status counts must sum to denominator');
  if (replay.verdict !== 'not-complete') findings.push('incomplete Plan 3.2 replay must keep terminal verdict not-complete');

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32TerminalVerdictFailClosedValidation.v1',
    ok,
    findings,
    denominator,
    verified,
    notComplete,
    verdict: replay.verdict,
    failClosed: replay.verdict === 'not-complete' && verified < denominator
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-terminal-verdict-fail-closed] ok verified=${verified}/${denominator} verdict=${replay.verdict}`);
  else console.error(`[validate-plan32-terminal-verdict-fail-closed] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
