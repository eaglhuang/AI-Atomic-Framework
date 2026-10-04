const laneSessionFlags = new Set(['--lane-session', '--lane-session-id']);
// These commands already parse the flag themselves; they still get the env.
const commandsOwningFlag = new Set(['lane', 'write-ticket', 'telemetry']);

/**
 * `--lane-session <id>` is the per-invocation form of ATM_LANE_SESSION_ID.
 * Agents usually run every command in a fresh shell, so an exported lane id
 * from `next --claim` is lost before commit, evidence or close. The flag sets
 * the same environment value for this invocation only; lane capability checks
 * still verify the id against the live claim exactly as for the env var.
 */
export function applyLaneSessionFlagFromArgv(argv: readonly string[]): string[] {
  const [commandName] = argv;
  const keepFlag = commandsOwningFlag.has(commandName ?? '');
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const inline = arg.match(/^(--lane-session(?:-id)?)=(.+)$/);
    const value = inline ? inline[2] : laneSessionFlags.has(arg) ? argv[index + 1] : undefined;
    if (value === undefined || value.startsWith('-')) {
      result.push(arg);
      continue;
    }
    process.env.ATM_LANE_SESSION_ID = value.trim();
    if (keepFlag) {
      result.push(arg);
      if (!inline) result.push(argv[index + 1]);
    }
    if (!inline) index += 1;
  }
  return result;
}
